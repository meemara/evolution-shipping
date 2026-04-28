import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// POST /api/enrich-ubiquiti?secret=SYNC_SECRET
// Receives Ubiquiti store order data and enriches existing shipping tracker orders.
//
// For each Ubiquiti order:
//   1. Match by tracking number (carrier emails may already have the tracking)
//   2. Match by order number (Ubiquiti order ID like US5245086)
//   3. Match by order number appearing in description/notes
//   4. Match by vendor + similar description
//   5. If no match found, insert as a new order

interface UbiquitiOrder {
  vendor: string;
  order_number: string;
  po_number: string;
  project: string;
  order_date: string;
  status: string;
  tracking_number: string | null;
  carrier: string | null;
  estimated_delivery: string | null;
  source: string;
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.SYNC_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const ubiOrders: UbiquitiOrder[] = body.orders || [];

    if (ubiOrders.length === 0) {
      return NextResponse.json({ message: 'No orders to process', enriched: 0, inserted: 0 });
    }

    // Get all existing orders from DB
    const { rows: existingOrders } = await sql`
      SELECT id, order_number, tracking_number, vendor, carrier, estimated_delivery,
             project, status, description, notes
      FROM orders
    `;

    // Build lookup indexes
    const dbByTracking = new Map<string, typeof existingOrders[0]>();
    const dbByOrderNumber = new Map<string, typeof existingOrders[0][]>();

    for (const row of existingOrders) {
      if (row.tracking_number) {
        dbByTracking.set(row.tracking_number, row);
      }
      if (row.order_number) {
        const existing = dbByOrderNumber.get(row.order_number) || [];
        existing.push(row);
        dbByOrderNumber.set(row.order_number, existing);
      }
    }

    let enriched = 0;
    let inserted = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const uOrder of ubiOrders) {
      let matchedRow: typeof existingOrders[0] | undefined;
      let matchType = '';

      // Strategy 1: Match by tracking number
      if (uOrder.tracking_number && dbByTracking.has(uOrder.tracking_number)) {
        matchedRow = dbByTracking.get(uOrder.tracking_number);
        matchType = 'tracking';
      }

      // Strategy 2: Match by order number
      if (!matchedRow && uOrder.order_number) {
        const exactMatches = dbByOrderNumber.get(uOrder.order_number);
        if (exactMatches && exactMatches.length > 0) {
          matchedRow = exactMatches[0];
          matchType = 'order_number_exact';
        }

        if (!matchedRow) {
          for (const row of existingOrders) {
            if (row.order_number && row.order_number.includes(uOrder.order_number)) {
              matchedRow = row;
              matchType = 'order_number_partial';
              break;
            }
          }
        }
      }

      // Strategy 3: Match by order number in description/notes
      if (!matchedRow && uOrder.order_number) {
        for (const row of existingOrders) {
          if (
            (row.description && row.description.includes(uOrder.order_number)) ||
            (row.notes && row.notes.includes(uOrder.order_number))
          ) {
            matchedRow = row;
            matchType = 'description_order_num';
            break;
          }
        }
      }

      // Strategy 4: Match by vendor + tracking prefix (UPS 1Z orders)
      if (!matchedRow && uOrder.tracking_number) {
        for (const row of existingOrders) {
          if (
            row.vendor &&
            (row.vendor.toLowerCase().includes('ubiquiti') || row.vendor.toLowerCase().includes('ui.com')) &&
            row.tracking_number &&
            row.tracking_number === uOrder.tracking_number
          ) {
            matchedRow = row;
            matchType = 'vendor_tracking';
            break;
          }
        }
      }

      if (matchedRow) {
        const newTracking = uOrder.tracking_number && !matchedRow.tracking_number ? uOrder.tracking_number : null;
        const newCarrier = uOrder.carrier && !matchedRow.carrier ? uOrder.carrier : null;
        const newDelivery = uOrder.estimated_delivery && !matchedRow.estimated_delivery ? uOrder.estimated_delivery : null;
        const newVendor = matchedRow.vendor === 'Unknown' ? 'Ubiquiti' : null;

        if (newTracking || newCarrier || newDelivery || newVendor) {
          await sql`
            UPDATE orders SET
              tracking_number = COALESCE(${newTracking ?? matchedRow.tracking_number}, tracking_number),
              carrier = COALESCE(${newCarrier ?? matchedRow.carrier}, carrier),
              estimated_delivery = COALESCE(${newDelivery ?? matchedRow.estimated_delivery}, estimated_delivery),
              vendor = COALESCE(${newVendor ?? matchedRow.vendor}, vendor)
            WHERE id = ${matchedRow.id}
          `;

          const updates: string[] = [];
          if (newTracking) updates.push(`tracking=${uOrder.tracking_number}`);
          if (newCarrier) updates.push(`carrier=${uOrder.carrier}`);
          if (newDelivery) updates.push(`delivery=${uOrder.estimated_delivery}`);
          if (newVendor) updates.push('vendor=Ubiquiti');

          enriched++;
          details.push(`Enriched order #${matchedRow.id} (${matchType}): ${updates.join(', ')}`);
        } else {
          skipped++;
        }
      } else {
        // No match — insert as new order
        const description = uOrder.order_number
          ? `Ubiquiti #${uOrder.order_number}`
          : 'Ubiquiti Order';

        // Map Ubiquiti status to shipping tracker status
        let trackerStatus = 'Order Confirmed';
        const statusLower = (uOrder.status || '').toLowerCase();
        if (statusLower === 'delivered') trackerStatus = 'Delivered';
        else if (statusLower === 'shipped') trackerStatus = 'Shipped';
        else if (statusLower === 'processing') trackerStatus = 'Processing';
        else if (statusLower === 'payment received') trackerStatus = 'Order Confirmed';
        else if (statusLower === 'order received') trackerStatus = 'Order Confirmed';

        const insertResult = await sql`
          INSERT INTO orders (vendor, description, order_number, order_date, tracking_number,
                             carrier, status, estimated_delivery, project, notes, created_by)
          VALUES (
            'Ubiquiti',
            ${description},
            ${uOrder.order_number},
            ${uOrder.order_date || null},
            ${uOrder.tracking_number},
            ${uOrder.carrier},
            ${trackerStatus},
            ${uOrder.estimated_delivery},
            ${uOrder.project || null},
            ${`Source: Ubiquiti Store | ${uOrder.order_number}`},
            'ubiquiti-sync'
          )
          RETURNING id, order_number, tracking_number, vendor, carrier,
                    estimated_delivery, project, status, description, notes
        `;

        if (insertResult.rows.length > 0) {
          const newRow = insertResult.rows[0];
          existingOrders.push(newRow);
          if (newRow.tracking_number) {
            dbByTracking.set(newRow.tracking_number, newRow);
          }
          if (newRow.order_number) {
            const existing = dbByOrderNumber.get(newRow.order_number) || [];
            existing.push(newRow);
            dbByOrderNumber.set(newRow.order_number, existing);
          }
        }
        inserted++;
        details.push(`Inserted new: Ubiquiti #${uOrder.order_number}`);
      }
    }

    const summary = {
      timestamp: new Date().toISOString(),
      totalReceived: ubiOrders.length,
      enriched,
      inserted,
      skipped,
      details: details.slice(0, 50),
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Ubiquiti enrichment error:', error);
    return NextResponse.json(
      { error: 'Enrichment failed', details: String(error) },
      { status: 500 }
    );
  }
}
