import { ConfidentialClientApplication } from '@azure/msal-node';

// Microsoft Graph client using client credentials (app-only, no user login)
let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Missing Azure credentials. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.');
    }

    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }
  return msalClient;
}

async function getAccessToken(): Promise<string> {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) {
    throw new Error('Failed to acquire access token');
  }
  return result.accessToken;
}

async function graphFetch(url: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// Types
export interface GraphEmail {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  sender: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
}

export interface ParsedOrder {
  vendor: string;
  description: string;
  order_number: string | null;
  order_date: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status: string;
  estimated_delivery: string | null;
  project: string | null;
  notes: string;
  created_by: string;
  // Cross-reference fields for merging
  po_number: string | null;
  raw_order_number: string | null;
  is_carrier_email: boolean;
}

// Fetch recent emails from the shipping shared mailbox
export async function fetchShippingEmails(sinceDate: string): Promise<GraphEmail[]> {
  const mailbox = process.env.SHIPPING_MAILBOX || 'shipping@evolutionava.com';
  const filter = `receivedDateTime ge ${sinceDate}`;
  const select = 'id,subject,bodyPreview,body,sender,receivedDateTime,hasAttachments';
  const url = `https://graph.microsoft.com/v1.0/users/${mailbox}/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=100&$orderby=receivedDateTime desc`;

  const allEmails: GraphEmail[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res = await graphFetch(nextUrl);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph API error: ${res.status} - ${err}`);
    }
    const data = await res.json();
    allEmails.push(...(data.value || []));
    nextUrl = data['@odata.nextLink'] || null;
  }

  return allEmails;
}

// Parse a shipping email into a structured order
export function parseShippingEmail(email: GraphEmail): ParsedOrder | null {
  const subject = email.subject || '';
  const sender = email.sender?.emailAddress?.address?.toLowerCase() || '';
  const body = email.bodyPreview || '';
  const fullBody = email.body?.content || '';
  const date = email.receivedDateTime?.split('T')[0] || null;

  // Determine vendor — check sender first, then fall back to subject/body keywords
  let vendor = 'Unknown';
  if (sender.includes('lutron.com')) vendor = 'Lutron';
  else if (sender.includes('ups.com')) vendor = 'UPS';
  else if (sender.includes('fedex.com')) vendor = 'FedEx';
  else if (sender.includes('crestron.com')) vendor = 'Crestron';
  else if (sender.includes('sonance.com')) vendor = 'Sonance';
  else if (sender.includes('legrand.com')) vendor = 'Legrand';
  else if (sender.includes('wesco')) vendor = 'Wesco';
  else if (sender.includes('synnex') || sender.includes('tdsynnex')) vendor = 'TD SYNNEX';
  else if (sender.includes('snapone') || sender.includes('snap-one')) vendor = 'SnapOne';
  else if (sender.includes('environmentallights')) vendor = 'Environmental Lights';

  // If sender didn't match, check subject and body for vendor names (handles forwarded emails)
  if (vendor === 'Unknown') {
    const combined = (subject + ' ' + body + ' ' + fullBody).toLowerCase();
    if (combined.includes('lutron')) vendor = 'Lutron';
    else if (combined.includes('crestron')) vendor = 'Crestron';
    else if (combined.includes('sonance')) vendor = 'Sonance';
    else if (combined.includes('legrand')) vendor = 'Legrand';
    else if (combined.includes('environmentallights')) vendor = 'Environmental Lights';
    else if (combined.includes('snapone') || combined.includes('snap one') || combined.includes('snap-one')) vendor = 'SnapOne';
    else if (combined.includes('wesco')) vendor = 'Wesco';
    else if (combined.includes('synnex') || combined.includes('td synnex')) vendor = 'TD SYNNEX';
  }

  // Skip non-shipping emails
  const lowerSubject = subject.toLowerCase();
  const isShipping = [
    'shipped', 'tracking', 'delivery', 'order confirm', 'shipment',
    'in transit', 'out for delivery', 'has been delivered'
  ].some(kw => lowerSubject.includes(kw) || body.toLowerCase().includes(kw));

  if (!isShipping && vendor === 'Unknown') return null;

  // Extract order number and PO from subject
  let orderNumber: string | null = null;
  let poNumber: string | null = null;
  let project: string | null = null;

  // Lutron: "Order Shipped | Order Number - 29177732 | PO# - GREENBERG4712"
  const lutronMatch = subject.match(/Order Number\s*-\s*(\d+)/i);
  if (lutronMatch) orderNumber = lutronMatch[1];

  const poMatch = subject.match(/PO#?\s*[-:]?\s*(.+?)(?:\s*\)|$)/i);
  if (poMatch) poNumber = poMatch[1].trim();

  // Crestron: "YOUR CRESTRON ORDER (PO# 4799 - Richter ) HAS SHIPPED"
  const crestronPoMatch = subject.match(/PO#\s*(\S+)\s*(?:-\s*(.+?)\s*\))?/i);
  if (crestronPoMatch) {
    poNumber = crestronPoMatch[1];
    if (crestronPoMatch[2]) project = crestronPoMatch[2].trim();
  }

  // Legrand: "Legrand | AV Order Confirmation 4149241 for PO: LARAE"
  const legrandMatch = subject.match(/(?:Confirmation|Notification)\s*#?(\d+)\s*for\s*PO:\s*(\S+)/i);
  if (legrandMatch) {
    orderNumber = legrandMatch[1];
    poNumber = legrandMatch[2];
  }

  // Sonance: "Sonance Shipping Confirmation 3030137103"
  const sonanceMatch = subject.match(/Sonance.*(?:Confirmation|Notification)\s*(\d+)/i);
  if (sonanceMatch) orderNumber = sonanceMatch[1];

  // FedEx: "FedEx Shipment 513745507897"
  const fedexMatch = subject.match(/FedEx\s+Shipment\s+(\d+)/i);

  // Extract tracking numbers
  let trackingNumber: string | null = null;
  let carrier: string | null = null;

  if (fedexMatch) {
    trackingNumber = fedexMatch[1];
    carrier = 'FedEx';
  }

  // UPS tracking from body: 1Z...
  const upsTrackingMatch = (body + ' ' + fullBody).match(/\b(1Z[A-Z0-9]{16,})\b/);
  if (upsTrackingMatch) {
    trackingNumber = upsTrackingMatch[1];
    carrier = 'UPS';
  }

  // FedEx tracking from body
  if (!trackingNumber) {
    const fedexBodyMatch = (body + ' ' + fullBody).match(/\b(\d{12,15})\b/);
    if (fedexBodyMatch && vendor === 'FedEx') {
      trackingNumber = fedexBodyMatch[1];
      carrier = 'FedEx';
    }
  }

  // Extract estimated delivery from UPS emails
  let estimatedDelivery: string | null = null;
  const deliveryDateMatch = fullBody.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (deliveryDateMatch && vendor === 'UPS') {
    const [m, d, y] = deliveryDateMatch[1].split('/');
    estimatedDelivery = `${y}-${m}-${d}`;
  }

  // Infer status
  let status = 'Shipped';
  if (lowerSubject.includes('delivered') || body.toLowerCase().includes('has been delivered')) status = 'Delivered';
  else if (lowerSubject.includes('out for delivery')) status = 'Out for Delivery';
  else if (lowerSubject.includes('in transit')) status = 'In Transit';
  else if (lowerSubject.includes('order confirm') || lowerSubject.includes('order acknowledgment')) status = 'Order Confirmed';
  else if (lowerSubject.includes('scheduled for delivery')) status = 'In Transit';

  // Extract project from PO number patterns
  if (!project && poNumber) {
    // "GREENBERG4712" -> Greenberg
    const nameNumMatch = poNumber.match(/^([A-Z]+)(\d+)$/i);
    if (nameNumMatch && nameNumMatch[1].length > 2) {
      project = nameNumMatch[1].charAt(0).toUpperCase() + nameNumMatch[1].slice(1).toLowerCase();
    }
    // "4850 ESKENAZI SHADES" -> Eskenazi
    const numNameMatch = poNumber.match(/^\d+\s+([A-Z]+)/i);
    if (numNameMatch) {
      project = numNameMatch[1].charAt(0).toUpperCase() + numNameMatch[1].slice(1).toLowerCase();
    }
    // "LUTRON - BROGLIO001" -> Broglio
    const dashMatch = poNumber.match(/(?:LUTRON\s*-\s*)?([A-Z]+)\d*/i);
    if (dashMatch && !project && dashMatch[1].length > 2 && dashMatch[1] !== 'LUTRON' && dashMatch[1] !== 'STOCK' && dashMatch[1] !== 'PO') {
      project = dashMatch[1].charAt(0).toUpperCase() + dashMatch[1].slice(1).toLowerCase();
    }
  }

  // Build description
  let description = subject
    .replace(/^(FW:|Fw:|RE:|Re:)\s*/gi, '')
    .replace(/Order Shipped \| Order Number - \d+ \| PO# - /, 'Lutron ')
    .replace(/YOUR CRESTRON ORDER \(/, 'Crestron ')
    .replace(/\) HAS SHIPPED.*/, '')
    .substring(0, 200);

  if (vendor === 'UPS') {
    const shipperMatch = fullBody.match(/From\s+<strong>(.+?)<\/strong>/i) || body.match(/From\s+(\S.+?)(?:\s+Estimated|\s*$)/);
    if (shipperMatch) description = `Package from ${shipperMatch[1]}`;
  }

  // For carrier emails (FedEx/UPS), try to extract PO or order references from the body
  // so we can match them to vendor orders later
  const isCarrierEmail = vendor === 'FedEx' || vendor === 'UPS';
  if (isCarrierEmail) {
    // Look for PO references in the body
    const bodyPoMatch = (body + ' ' + fullBody).match(/PO#?\s*[-:]?\s*([A-Z0-9]+)/i);
    if (bodyPoMatch && !poNumber) poNumber = bodyPoMatch[1].trim();

    // Look for order number references
    const bodyOrderMatch = (body + ' ' + fullBody).match(/(?:Order|Reference)\s*#?\s*[-:]?\s*(\d{6,})/i);
    if (bodyOrderMatch && !orderNumber) orderNumber = bodyOrderMatch[1];

    // Look for ship-to project name references
    const shipToMatch = fullBody.match(/(?:Ship\s*To|Deliver\s*To|Attention)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (shipToMatch && !project) {
      project = shipToMatch[1].trim();
    }

    // Look for shipper name that might be a vendor
    const shipperVendorMatch = fullBody.match(/(?:From|Shipper)[:\s]+(?:<[^>]*>)?\s*(Lutron|Crestron|Sonance|Legrand|Wesco|Synnex|SnapOne)/i);
    if (shipperVendorMatch) {
      // Store original vendor for the carrier, but note the actual shipper
      description = `${shipperVendorMatch[1]} shipment via ${vendor}`;
    }
  }

  // Rebuild order number string with any newly found data
  const orderNumStr = [orderNumber, poNumber ? `PO: ${poNumber}` : null].filter(Boolean).join(' / ') || null;

  // Extract project from PO if we still don't have one
  if (!project && poNumber) {
    const nameNumMatch2 = poNumber.match(/^([A-Z]+)(\d+)$/i);
    if (nameNumMatch2 && nameNumMatch2[1].length > 2) {
      project = nameNumMatch2[1].charAt(0).toUpperCase() + nameNumMatch2[1].slice(1).toLowerCase();
    }
  }

  return {
    vendor,
    description,
    order_number: orderNumStr,
    order_date: date,
    tracking_number: trackingNumber,
    carrier,
    status,
    estimated_delivery: estimatedDelivery,
    project,
    notes: `Imported from email: ${subject}`,
    created_by: 'System Import',
    po_number: poNumber,
    raw_order_number: orderNumber,
    is_carrier_email: isCarrierEmail,
  };
}

// Deduplicate: check if order already exists in DB
export function dedupeKey(order: ParsedOrder): string {
  // Primary key: tracking number
  if (order.tracking_number) return `tracking:${order.tracking_number}`;
  // Secondary: order number + vendor
  if (order.order_number) return `order:${order.vendor}:${order.order_number}`;
  // Fallback: vendor + date + description hash
  return `fallback:${order.vendor}:${order.order_date}:${order.description.substring(0, 50)}`;
}

// Helper: merge fields from source into target, filling in blanks
function mergeInto(target: ParsedOrder, source: ParsedOrder): void {
  if (!target.tracking_number && source.tracking_number) target.tracking_number = source.tracking_number;
  if (!target.carrier && source.carrier) target.carrier = source.carrier;
  if (!target.estimated_delivery && source.estimated_delivery) target.estimated_delivery = source.estimated_delivery;
  if (!target.project && source.project) target.project = source.project;
  if (!target.raw_order_number && source.raw_order_number) target.raw_order_number = source.raw_order_number;
  if (!target.po_number && source.po_number) target.po_number = source.po_number;
  if (!target.order_number && source.order_number) target.order_number = source.order_number;
  // Take the more complete order number string
  if (source.order_number && target.order_number && source.order_number.length > target.order_number.length) {
    target.order_number = source.order_number;
  }
  // Prefer known vendor over Unknown
  if (target.vendor === 'Unknown' && source.vendor !== 'Unknown') {
    target.vendor = source.vendor;
    target.description = source.description;
  }
  // Update status if source has more recent info
  const statusPriority: Record<string, number> = {
    'Order Confirmed': 1, 'Shipped': 2, 'In Transit': 3,
    'Out for Delivery': 4, 'Delivered': 5
  };
  if ((statusPriority[source.status] || 0) > (statusPriority[target.status] || 0)) {
    target.status = source.status;
  }
}

// Normalize a description for comparison (strip FW:/RE:, lowercase, trim whitespace)
function normalizeDescription(desc: string): string {
  return desc
    .replace(/^(FW:|Fw:|RE:|Re:)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Merge parsed orders from multiple emails about the same shipment into single entries.
// Catches: same tracking, same PO, same order number, same forwarded email (identical subject),
// and carrier emails (FedEx/UPS) that should merge into vendor orders.
export function mergeOrders(orders: ParsedOrder[]): ParsedOrder[] {
  const result: ParsedOrder[] = [];
  const merged = new Set<number>(); // indexes in orders[] that have been merged into another

  // Build indexes for fast lookup
  const byTracking = new Map<string, number>(); // tracking -> index in result
  const byPo = new Map<string, number>();
  const byOrderNum = new Map<string, number>();
  const byDescription = new Map<string, number>(); // normalized description -> index in result

  for (let i = 0; i < orders.length; i++) {
    if (merged.has(i)) continue;
    const order = orders[i];
    let matchIdx: number | undefined;

    // Try to find an existing result entry to merge into
    // 1. Match by tracking number
    if (order.tracking_number && byTracking.has(order.tracking_number)) {
      matchIdx = byTracking.get(order.tracking_number);
    }

    // 2. Match by PO number
    if (matchIdx === undefined && order.po_number) {
      matchIdx = byPo.get(order.po_number.toUpperCase());
    }

    // 3. Match by raw order number (within same vendor or if one is a carrier)
    if (matchIdx === undefined && order.raw_order_number) {
      matchIdx = byOrderNum.get(order.raw_order_number);
    }

    // 4. Match by normalized description (catches forwarded duplicates)
    if (matchIdx === undefined) {
      const normDesc = normalizeDescription(order.description);
      if (normDesc.length > 10) { // only match on meaningful descriptions
        matchIdx = byDescription.get(normDesc);
      }
    }

    if (matchIdx !== undefined) {
      // Merge into existing
      mergeInto(result[matchIdx], order);
      merged.add(i);

      // Update indexes with any new data
      const target = result[matchIdx];
      if (target.tracking_number) byTracking.set(target.tracking_number, matchIdx);
      if (target.po_number) byPo.set(target.po_number.toUpperCase(), matchIdx);
      if (target.raw_order_number) byOrderNum.set(target.raw_order_number, matchIdx);
    } else {
      // New unique order
      const idx = result.length;
      result.push(order);

      // Add to indexes
      if (order.tracking_number) byTracking.set(order.tracking_number, idx);
      if (order.po_number) byPo.set(order.po_number.toUpperCase(), idx);
      if (order.raw_order_number) byOrderNum.set(order.raw_order_number, idx);
      const normDesc = normalizeDescription(order.description);
      if (normDesc.length > 10) byDescription.set(normDesc, idx);
    }
  }

  return result;
}
