import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// POST /api/enrich-future-automation?secret=SYNC_SECRET
// Receives Future Automation dealer portal order data and enriches existing shipping tracker orders.
//
// For each Future Automation order:
//   1. Match by tracking number (carrier emails may already have the tracking)
//   2. Match by order number (Future Automation order ID)
//   3. Match by PO/SOP number
//   4. Match by order number appearing in description/subject
//   5. Match by vendor + project name
//   6. If no match found, insert as a new order

interface FutureAutomationOrder {
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
    const faOrders: FutureAutomationOrder[] = body.orders || [];

    if (faOrders.length === 0) {
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
    const dbByDescription = new Map<string, typeof existingOrders[0]>();

    for (const row of existingOrders) {
      if (row.tracking_number) {
        dbByTracking.set(row.tracking_number, row);
      }
      if (row.order_number) {
        const existing = dbByOrderNumber.get(row.order_number) || [];
        existing.push(row);
        dbByOrderNumber.set(row.order_number, existing);
      }
      if (row.description) {
        const normDesc = row.description.toLowerCase().replace(/\s+/g, ' ').trim();
        dbByDescription.set(normDesc, row);
      }
    }

    let enriched = 0;
    let inserted = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const faOrder of faOrders) {
      let matchedRow: typeof existingOrders[0] | undefined;
      let matchType = '';

      // Strategy 1: Match by tracking number
      if (faOrder.tracking_number && dbByTracking.has(faOrder.tracking_number)) {
        matchedRow = dbByTracking.get(faOrder.tracking_number);
        matchType = 'tracking';
      }

      // Strategy 2: Match by Future Automation order number in existing order_number field
      if (!matchedRow && faOrder.order_number) {
        const exactMatches = dbByOrderNumber.get(faOrder.order_number);
        if (exactMatches && exactMatches.length > 0) {
          matchedRow = exactMatches[0];
          matchType = 'order_number_exact';
        }

        if (!matchedRow) {
          for (const row of existingOrders) {
            if (row.order_number && row.order_number.includes(faOrder.order_number)) {
              matchedRow = row;
              matchType = 'order_number_partial';
              break;
            }
          }
        }
      }

      // Strategy 3: Match by PO/SOP number appearing in existing order data
      if (!matchedRow && faOrder.po_number) {
        for (const row of existingOrders) {
          const poLower = faOrder.po_number.toLowerCase();
          if (
            (row.order_number && row.order_number.toLowerCase().includes(poLower)) ||
            (row.description && row.description.toLowerCase().includes(poLower)) ||
            (row.notes && row.notes.toLowerCase().includes(poLower))
          ) {
            matchedRow = row;
            matchType = 'po_number';
            break;
          }
        }
      }

      // Strategy 4: Match by Future Automation order number appearing in description
      if (!matchedRow && faOrder.order_number) {
        for (const row of existingOrders) {
          if (row.description && row.description.includes(faOrder.order_number)) {
            matchedRow = row;
            matchType = 'description_order_num';
            break;
          }
        }
      }

      // Strategy 5: Match by vendor + similar project name
      if (!matchedRow && faOrder.project) {
        const projLower = faOrder.project.toLowerCase();
        for (const row of existingOrders) {
          if (
            row.vendor &&
            row.vendor.toLowerCase().includes('future') &&
            row.project &&
            row.project.toLowerCase().includes(projLower)
          ) {
            matchedRow = row;
            matchType = 'vendor_project';
            break;
          }
        }
      }

      if (matchedRow) {
        // Enrich the existing order with Future Automation data
        const newProject = faOrder.project && !matchedRow.project ? faOrder.project : null;
        const newTracking = faOrder.tracking_number && !matchedRow.tracking_number ? faOrder.tracking_number : null;
        const newCarrier = faOrder.carrier && !matchedRow.carrier ? faOrder.carrier : null;
        const newDelivery = faOrder.estimated_delivery && !matchedRow.estimated_delivery ? faOrder.estimated_delivery : null;
        const newVendor = matchedRow.vendor === 'Unknown' ? 'Future Automation' : null;

        if (newProject || newTracking || newCarrier || newDelivery || newVendor) {
          await sql`
            UPDATE orders SET
              project = COALESCE(${newProject ?? matchedRow.project}, project),
              tracking_number = COALESCE(${newTracking ?? matchedRow.tracking_number}, tracking_number),
              carrier = COALESCE(${newCarrier ?? matchedRow.carrier}, carrier),
              estimated_delivery = COALESCE(${newDelivery ?? matchedRow.estimated_delivery}, estimated_delivery),
              vendor = COALESCE(${newVendor ?? matchedRow.vendor}, vendor)
            WHERE id = ${matchedRow.id}
          `;

          const updates: string[] = [];
          if (newProject) updates.push(`project=${faOrder.project}`);
          if (newTracking) updates.push(`tracking=${faOrder.tracking_number}`);
          if (newCarrier) updates.push(`carrier=${faOrder.carrier}`);
          if (newDelivery) updates.push(`delivery=${faOrder.estimated_delivery}`);
          if (newVendor) updates.push('vendor=Future Automation');

          enriched++;
          details.push(`Enriched order #${matchedRow.id} (${matchType}): ${updates.join(', ')}`);
        } else {
          skipped++;
        }
      } else {
        // No match found — insert as new order
        const description = [
          faOrder.po_number ? `SOP: ${faOrder.po_number}` : '',
          faOrder.order_number ? `FA #${faOrder.order_number}` : '',
        ].filter(Boolean).join(' — ') || `Future Automation Order ${faOrder.order_number}`;

        // Map Future Automation status to shipping tracker status
        let trackerStatus = 'Order Confirmed';
        const statusLower = (faOrder.status || '').toLowerCase();
        if (statusLower === 'archive' || statusLower === 'archived') trackerStatus = 'Delivered';
        else if (statusLower === 'sample') trackerStatus = 'Processing';
        else if (statusLower === 'production') trackerStatus = 'Processing';
        else if (statusLower === 'shipping') trackerStatus = 'Shipped';

        const insertResult = await sql`
          INSERT INTO orders (vendor, description, order_number, order_date, tracking_number,
                             carrier, status, estimated_delivery, project, notes, created_by)
          VALUES (
            'Future Automation',
            ${description},
            ${faOrder.order_number},
            ${faOrder.order_date || null},
            ${faOrder.tracking_number},
            ${faOrder.carrier},
            ${trackerStatus},
            ${faOrder.estimated_delivery},
            ${faOrder.project},
            ${`Source: Future Automation Portal | SOP: ${faOrder.po_number || 'N/A'}`},
            'future-automation-sync'
          )
          RETURNING id, order_number, tracking_number, vendor, carrier,
                    estimated_delivery, project, status, description, notes
        `;

        // Add newly inserted row to lookup indexes to avoid duplicate inserts
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
        details.push(`Inserted new: FA #${faOrder.order_number} (${faOrder.project || 'no project'})`);
      }
    }

    const summary = {
      timestamp: new Date().toISOString(),
      totalReceived: faOrders.length,
      enriched,
      inserted,
      skipped,
      details: details.slice(0, 50),
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Future Automation enrichment error:', error);
    return NextResponse.json(
      { error: 'Enrichment failed', details: String(error) },
      { status: 500 }
    );
  }
}
