import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// POST /api/enrich-james?secret=SYNC_SECRET
// Receives James portal order data and enriches existing shipping tracker orders.
//
// For each James order:
//   1. Match by tracking number (carrier emails from FedEx may already have the tracking)
//   2. Match by order number (James order # may appear in email subjects)
//   3. Match by PO number (PO # from James matches PO # parsed from emails)
//   4. Match by James order number appearing in description/subject
//   5. Match by vendor + similar project name
//   6. If no match found but order has tracking, insert as a new order
//
// Enrichment adds: project name, carrier, tracking number, estimated delivery, vendor confirmation

interface JamesOrder {
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
    const jamesOrders: JamesOrder[] = body.orders || [];

    if (jamesOrders.length === 0) {
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

    for (const sOrder of jamesOrders) {
      let matchedRow: typeof existingOrders[0] | undefined;
      let matchType = '';

      // Strategy 1: Match by tracking number
      if (sOrder.tracking_number && dbByTracking.has(sOrder.tracking_number)) {
        matchedRow = dbByTracking.get(sOrder.tracking_number);
        matchType = 'tracking';
      }

      // Strategy 2: Match by James order number appearing in existing order_number field
      if (!matchedRow && sOrder.order_number) {
        const exactMatches = dbByOrderNumber.get(sOrder.order_number);
        if (exactMatches && exactMatches.length > 0) {
          matchedRow = exactMatches[0];
          matchType = 'order_number_exact';
        }

        if (!matchedRow) {
          for (const row of existingOrders) {
            if (row.order_number && row.order_number.includes(sOrder.order_number)) {
              matchedRow = row;
              matchType = 'order_number_partial';
              break;
            }
          }
        }
      }

      // Strategy 3: Match by PO number appearing in existing order data
      if (!matchedRow && sOrder.po_number) {
        for (const row of existingOrders) {
          const poLower = sOrder.po_number.toLowerCase();
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

      // Strategy 4: Match by James order number appearing in description/subject
      if (!matchedRow && sOrder.order_number) {
        for (const row of existingOrders) {
          if (row.description && row.description.includes(sOrder.order_number)) {
            matchedRow = row;
            matchType = 'description_order_num';
            break;
          }
        }
      }

      // Strategy 5: Match James/Snap One vendor + similar project name
      if (!matchedRow && sOrder.project) {
        const projLower = sOrder.project.toLowerCase();
        for (const row of existingOrders) {
          if (
            row.vendor &&
            (row.vendor.toLowerCase().includes('james') ||
             row.vendor.toLowerCase().includes('sonance')) &&
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
        // Enrich the existing order with James data
        const updates: string[] = [];

        const newProject = sOrder.project && !matchedRow.project ? sOrder.project : null;
        const newTracking = sOrder.tracking_number && !matchedRow.tracking_number ? sOrder.tracking_number : null;
        const newCarrier = sOrder.carrier && !matchedRow.carrier ? sOrder.carrier : null;
        const newDelivery = sOrder.estimated_delivery && !matchedRow.estimated_delivery ? sOrder.estimated_delivery : null;
        const newVendor = matchedRow.vendor === 'Unknown' ? 'James' : null;

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

          if (newProject) updates.push(`project=${sOrder.project}`);
          if (newTracking) updates.push(`tracking=${sOrder.tracking_number}`);
          if (newCarrier) updates.push(`carrier=${sOrder.carrier}`);
          if (newDelivery) updates.push(`delivery=${sOrder.estimated_delivery}`);
          if (newVendor) updates.push('vendor=James');

          enriched++;
          details.push(`Enriched order #${matchedRow.id} (${matchType}): ${updates.join(', ')}`);
        } else {
          skipped++;
        }
      } else if (sOrder.tracking_number) {
        // No match found — insert as new order if it has tracking data
        const description = [
          sOrder.po_number ? `PO: ${sOrder.po_number}` : '',
          sOrder.order_number ? `James #${sOrder.order_number}` : '',
        ].filter(Boolean).join(' — ') || `James Order ${sOrder.order_number}`;

        // Map James status to shipping tracker status
        let trackerStatus = 'Order Confirmed';
        if (sOrder.status === 'Shipped') trackerStatus = 'Shipped';
        else if (sOrder.status === 'In Transit') trackerStatus = 'In Transit';
        else if (sOrder.status === 'Processing') trackerStatus = 'Processing';
        else if (sOrder.status === 'Backordered') trackerStatus = 'Backordered';
        else if (sOrder.status === 'Open') trackerStatus = 'Order Confirmed';

        const insertResult = await sql`
          INSERT INTO orders (vendor, description, order_number, order_date, tracking_number,
                             carrier, status, estimated_delivery, project, notes, created_by)
          VALUES (
            'James',
            ${description},
            ${sOrder.order_number},
            ${sOrder.order_date || null},
            ${sOrder.tracking_number},
            ${sOrder.carrier},
            ${trackerStatus},
            ${sOrder.estimated_delivery},
            ${sOrder.project},
            ${`Source: James Portal | PO: ${sOrder.po_number || 'N/A'}`},
            'james-sync'
          )
          RETURNING id, order_number, tracking_number, vendor, carrier,
                    estimated_delivery, project, status, description, notes
        `;
        // Add newly inserted row to lookup indexes so subsequent records
        // for the same order enrich instead of inserting duplicates
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
        details.push(`Inserted new: James #${sOrder.order_number} (${sOrder.project || 'no project'})`);
      } else {
        skipped++;
      }
    }

    const summary = {
      timestamp: new Date().toISOString(),
      totalReceived: jamesOrders.length,
      enriched,
      inserted,
      skipped,
      details: details.slice(0, 50),
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('James enrichment error:', error);
    return NextResponse.json(
      { error: 'Enrichment failed', details: String(error) },
      { status: 500 }
    );
  }
}
