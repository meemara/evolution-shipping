import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { fetchShippingEmails, parseShippingEmail, mergeOrders } from '@/lib/graph';

// Vercel Cron calls this endpoint on schedule
// Also callable manually: POST /api/sync?days=7

export async function POST(request: Request) {
  try {
    // Auth check: require a secret to prevent unauthorized calls
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.SYNC_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const days = parseInt(searchParams.get('days') || '2');
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceDateStr = sinceDate.toISOString();

    // Fetch emails from shipping mailbox
    const emails = await fetchShippingEmails(sinceDateStr);

    // Parse each email into order data
    const parsed = emails
      .map(parseShippingEmail)
      .filter((o): o is NonNullable<typeof o> => o !== null);

    // Merge related orders (e.g., FedEx tracking email + Lutron order email = one order)
    const merged = mergeOrders(parsed);

    // Get all existing orders from DB for matching
    const { rows: existingOrders } = await sql`
      SELECT id, order_number, tracking_number, vendor, carrier, estimated_delivery, project, status, description FROM orders
    `;

    // Build lookup indexes for existing orders
    const dbByTracking = new Map<string, typeof existingOrders[0]>();
    const dbByOrderVendor = new Map<string, typeof existingOrders[0]>();

    for (const row of existingOrders) {
      if (row.tracking_number) dbByTracking.set(row.tracking_number, row);
      if (row.order_number && row.vendor) {
        dbByOrderVendor.set(`${row.vendor}:${row.order_number}`, row);
      }
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const order of merged) {
      // Try to find an existing DB row that matches this order
      let existingRow: typeof existingOrders[0] | undefined;

      // Match by tracking number
      if (order.tracking_number) {
        existingRow = dbByTracking.get(order.tracking_number);
      }

      // Match by order number + vendor
      if (!existingRow && order.order_number && order.vendor) {
        existingRow = dbByOrderVendor.get(`${order.vendor}:${order.order_number}`);
      }

      // Match by PO number appearing in order_number field
      if (!existingRow && order.po_number) {
        for (const row of existingOrders) {
          if (row.order_number && row.order_number.includes(order.po_number)) {
            existingRow = row;
            break;
          }
        }
      }

      // Match by similar description (catches forwarded duplicates already in DB)
      if (!existingRow && order.description) {
        const normDesc = order.description
          .replace(/^(FW:|Fw:|RE:|Re:)\s*/gi, '')
          .replace(/\s+/g, ' ').trim().toLowerCase();
        if (normDesc.length > 10) {
          for (const row of existingOrders) {
            const rowDesc = (row.description || '')
              .replace(/^(FW:|Fw:|RE:|Re:)\s*/gi, '')
              .replace(/\s+/g, ' ').trim().toLowerCase();
            if (rowDesc === normDesc) {
              existingRow = row;
              break;
            }
          }
        }
      }

      if (existingRow) {
        // Check if we have new info to add
        const hasNewTracking = order.tracking_number && !existingRow.tracking_number;
        const hasNewCarrier = order.carrier && !existingRow.carrier;
        const hasNewDelivery = order.estimated_delivery && !existingRow.estimated_delivery;
        const hasNewProject = order.project && !existingRow.project;
        const hasNewerStatus = order.status && order.status !== existingRow.status;

        // Status priority for determining if new status is more recent
        const statusPriority: Record<string, number> = {
          'Order Confirmed': 1, 'Shipped': 2, 'In Transit': 3,
          'Out for Delivery': 4, 'Delivered': 5
        };
        const isNewerStatus = hasNewerStatus &&
          (statusPriority[order.status] || 0) > (statusPriority[existingRow.status] || 0);

        if (hasNewTracking || hasNewCarrier || hasNewDelivery || hasNewProject || isNewerStatus) {
          await sql`
            UPDATE orders SET
              tracking_number = COALESCE(${order.tracking_number ?? existingRow.tracking_number}, tracking_number),
              carrier = COALESCE(${order.carrier ?? existingRow.carrier}, carrier),
              estimated_delivery = COALESCE(${order.estimated_delivery ?? existingRow.estimated_delivery}, estimated_delivery),
              project = COALESCE(${order.project ?? existingRow.project}, project),
              status = ${isNewerStatus ? order.status : existingRow.status}
            WHERE id = ${existingRow.id}
          `;
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Insert new order
        await sql`
          INSERT INTO orders (vendor, description, order_number, order_date, tracking_number, carrier, status, estimated_delivery, project, notes, created_by)
          VALUES (${order.vendor}, ${order.description}, ${order.order_number}, ${order.order_date}, ${order.tracking_number}, ${order.carrier}, ${order.status}, ${order.estimated_delivery}, ${order.project}, ${order.notes}, ${order.created_by})
        `;

        // Add to lookup indexes for rest of this batch
        if (order.tracking_number) dbByTracking.set(order.tracking_number, { id: -1, ...order } as any);
        if (order.order_number && order.vendor) {
          dbByOrderVendor.set(`${order.vendor}:${order.order_number}`, { id: -1, ...order } as any);
        }

        inserted++;
      }
    }

    // Log the sync
    const summary = {
      timestamp: new Date().toISOString(),
      emailsFetched: emails.length,
      emailsParsed: parsed.length,
      mergedOrders: merged.length,
      inserted,
      updated,
      skipped,
      sinceDateStr,
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Vercel Cron handler
export async function GET(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'SYNC_SECRET not configured' }, { status: 500 });
  }

  // Call our own POST handler
  const url = new URL(request.url);
  const syncUrl = `${url.origin}/api/sync?secret=${secret}&days=2`;
  const res = await fetch(syncUrl, { method: 'POST' });
  const data = await res.json();
  return NextResponse.json(data);
}
