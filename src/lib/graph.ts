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

  // Determine vendor
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

// Merge parsed orders from multiple emails about the same shipment into single entries.
// A carrier email (FedEx/UPS) should merge into a vendor order if they share a PO, order number, or tracking number.
export function mergeOrders(orders: ParsedOrder[]): ParsedOrder[] {
  // Separate vendor orders from carrier-only emails
  const vendorOrders: ParsedOrder[] = [];
  const carrierOrders: ParsedOrder[] = [];

  for (const order of orders) {
    if (order.is_carrier_email) {
      carrierOrders.push(order);
    } else {
      vendorOrders.push(order);
    }
  }

  // Build lookup indexes for vendor orders
  const byTracking = new Map<string, number>(); // tracking -> index in vendorOrders
  const byPo = new Map<string, number>(); // PO number -> index
  const byOrderNum = new Map<string, number>(); // raw order number -> index

  for (let i = 0; i < vendorOrders.length; i++) {
    const o = vendorOrders[i];
    if (o.tracking_number) byTracking.set(o.tracking_number, i);
    if (o.po_number) byPo.set(o.po_number.toUpperCase(), i);
    if (o.raw_order_number) byOrderNum.set(o.raw_order_number, i);
  }

  // Try to merge each carrier email into a matching vendor order
  const unmatchedCarrier: ParsedOrder[] = [];

  for (const carrier of carrierOrders) {
    let matchIdx: number | undefined;

    // Match by tracking number
    if (carrier.tracking_number && byTracking.has(carrier.tracking_number)) {
      matchIdx = byTracking.get(carrier.tracking_number);
    }

    // Match by PO number
    if (matchIdx === undefined && carrier.po_number) {
      matchIdx = byPo.get(carrier.po_number.toUpperCase());
    }

    // Match by raw order number
    if (matchIdx === undefined && carrier.raw_order_number) {
      matchIdx = byOrderNum.get(carrier.raw_order_number);
    }

    if (matchIdx !== undefined) {
      // Merge: fill in missing fields on the vendor order with carrier data
      const target = vendorOrders[matchIdx];
      if (!target.tracking_number && carrier.tracking_number) {
        target.tracking_number = carrier.tracking_number;
      }
      if (!target.carrier && carrier.carrier) {
        target.carrier = carrier.carrier;
      }
      if (!target.estimated_delivery && carrier.estimated_delivery) {
        target.estimated_delivery = carrier.estimated_delivery;
      }
      if (!target.project && carrier.project) {
        target.project = carrier.project;
      }
      // Update status if carrier has more recent info
      const statusPriority: Record<string, number> = {
        'Order Confirmed': 1, 'Shipped': 2, 'In Transit': 3,
        'Out for Delivery': 4, 'Delivered': 5
      };
      const carrierPriority = statusPriority[carrier.status] || 0;
      const targetPriority = statusPriority[target.status] || 0;
      if (carrierPriority > targetPriority) {
        target.status = carrier.status;
      }
      // Update the tracking index so future carrier emails can also match
      if (target.tracking_number) {
        byTracking.set(target.tracking_number, matchIdx);
      }
    } else {
      unmatchedCarrier.push(carrier);
    }
  }

  // Also merge vendor orders that share the same PO number (e.g., Lutron order + Lutron shipment)
  const finalOrders: ParsedOrder[] = [];
  const mergedVendorIndexes = new Set<number>();

  for (let i = 0; i < vendorOrders.length; i++) {
    if (mergedVendorIndexes.has(i)) continue;

    const order = vendorOrders[i];

    // Look for other vendor orders with the same PO
    if (order.po_number) {
      for (let j = i + 1; j < vendorOrders.length; j++) {
        if (mergedVendorIndexes.has(j)) continue;
        const other = vendorOrders[j];
        if (other.po_number && other.po_number.toUpperCase() === order.po_number.toUpperCase()) {
          // Merge other into order
          if (!order.tracking_number && other.tracking_number) order.tracking_number = other.tracking_number;
          if (!order.carrier && other.carrier) order.carrier = other.carrier;
          if (!order.estimated_delivery && other.estimated_delivery) order.estimated_delivery = other.estimated_delivery;
          if (!order.project && other.project) order.project = other.project;
          if (!order.raw_order_number && other.raw_order_number) order.raw_order_number = other.raw_order_number;
          if (!order.order_number && other.order_number) order.order_number = other.order_number;
          // Take the more complete order number string
          if (other.order_number && order.order_number && other.order_number.length > order.order_number.length) {
            order.order_number = other.order_number;
          }
          // Take the better description (prefer vendor over generic)
          if (order.vendor === 'Unknown' && other.vendor !== 'Unknown') {
            order.vendor = other.vendor;
            order.description = other.description;
          }
          const statusPriority: Record<string, number> = {
            'Order Confirmed': 1, 'Shipped': 2, 'In Transit': 3,
            'Out for Delivery': 4, 'Delivered': 5
          };
          if ((statusPriority[other.status] || 0) > (statusPriority[order.status] || 0)) {
            order.status = other.status;
          }
          mergedVendorIndexes.add(j);
        }
      }
    }

    // Also check if any vendor orders share the same tracking number
    if (order.tracking_number) {
      for (let j = i + 1; j < vendorOrders.length; j++) {
        if (mergedVendorIndexes.has(j)) continue;
        const other = vendorOrders[j];
        if (other.tracking_number === order.tracking_number) {
          if (!order.po_number && other.po_number) order.po_number = other.po_number;
          if (!order.project && other.project) order.project = other.project;
          if (!order.order_number && other.order_number) order.order_number = other.order_number;
          if (order.vendor === 'Unknown' && other.vendor !== 'Unknown') {
            order.vendor = other.vendor;
            order.description = other.description;
          }
          mergedVendorIndexes.add(j);
        }
      }
    }

    finalOrders.push(order);
  }

  // Add unmatched carrier emails as their own entries
  finalOrders.push(...unmatchedCarrier);

  return finalOrders;
}
