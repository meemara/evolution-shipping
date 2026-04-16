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

  // Build order number string
  const orderNumStr = [orderNumber, poNumber ? `PO: ${poNumber}` : null].filter(Boolean).join(' / ') || null;

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
