import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// POST /api/enrich-legrand?secret=SYNC_SECRET
// Receives Legrand AV portal order data and enriches existing shipping tracker orders.
//
// For each Legrand order:
//   1. Match by tracking number (carrier emails may already have the tracking)
//   2. Match by order number (Legrand order ID)
//   3. Match by PO number
//   4. Match by Legrand order number appearing in description/subject
//   5. Match by vendor + project name
//   6. If no match found, insert as a new order

interface LegrandOrder {
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
    const legrandOrders: LegrandOrder[] = body.orders || [];

    if (legrandOrders.length === 0) {
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

    for (const lOrder of legrandOrders) {
      let matchedRow: typeof existingOrders[0] | undefined;
      let matchType = '';

      // Strategy 1: Match by tracking number
      if (lOrder.tracking_number && dbByTracking.has(lOrder.tracking_number)) {
        matchedRow = dbByTracking.get(lOrder.tracking_number);
        matchType = 'tracking';
      }

      // Strategy 2: Match by Legrand order number in existing order_number field
      if (!matchedRow && lOrder.order_number) {
        const exactMatches = dbByOrderNumber.get(lOrder.order_number);
        if (exactMatches && exactMatches.length > 0) {
          matchedRow = exactMatches[0];
          matchType = 'order_number_exact';
        }

        if (!matchedRow) {
          for (const row of existingOrders) {
            if (row.order_number && row.order_number.includes(lOrder.order_number)) {
              matchedRow = row;
              matchType = 'order_number_partial';
              break;
            }
          }
        }
      }

      // Strategy 3: Match by PO number appearing in existing order data
      if (!matchedRow && lOrder.po_number) {
        for (const row of existingOrders) {
          const poLower = lOrder.po_number.toLowerCase();
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

      // Strategy 4: Match by Legrand order number appearing in description
      if (!matchedRow && lOrder.order_number) {
        for (const row of existingOrders) {
          if (row.description && row.description.includes(lOrder.order_number)) {
            matchedRow = row;
            matchType = 'description_order_num';
            break;
          }
        }
      }

      // Strategy 5: Match Legrand vendor + similar project name
      if (!matchedRow && lOrder.project) {
        const projLower = lOrder.project.toLowerCase();
        for (const row of existingOrders) {
          if (
            row.vendor &&
            row.vendor.toLowerCase().includes('legrand') &&
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
        // Enrich the existing order with Legrand data
        const newProject = lOrder.project && !matchedRow.project ? lOrder.project : null;
        const newTracking = lOrder.tracking_number && !matchedRow.tracking_number ? lOrder.tracking_number : null;
        const newCarrier = lOrder.carrier && !matchedRow.carrier ? lOrder.carrier : null;
        const newDelivery = lOrder.estimated_delivery && !matchedRow.estimated_delivery ? lOrder.estimated_delivery : null;
        const newVendor = matchedRow.vendor === 'Unknown' ? 'Legrand' : null;

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
          if (newProject) updates.push(`project=${lOrder.project}`);
          if (newTracking) updates.push(`tracking=${lOrder.tracking_number}`);
          if (newCarrier) updates.push(`carrier=${lOrder.carrier}`);
          if (newDelivery) updates.push(`delivery=${lOrder.estimated_delivery}`);
          if (newVendor) updates.push('vendor=Legrand');

          enriched++;
          details.push(`Enriched order #${matchedRow.id} (${matchType}): ${updates.join(', ')}`);
        } else {
          skipped++;
        }
      } else {
        // No match found — insert as new order
        const description = [
          lOrder.po_number ? `PO: ${lOrder.po_number}` : '',
          lOrder.order_number ? `Legrand #${lOrder.order_number}` : '',
        ].filter(Boolean).join(' — ') || `Legrand Order ${lOrder.order_number}`;

        // Map Legrand status to shipping tracker status
        let trackerStatus = 'Order Confirmed';
        const statusLower = (lOrder.status || '').toLowerCase();
        if (statusLower === 'invoiced') trackerStatus = 'Delivered';
        else if (statusLower === 'shipped') trackerStatus = 'Shipped';
        else if (statusLower === 'confirmed') trackerStatus = 'Processing';
        else if (statusLower === 'order received') trackerStatus = 'Order Confirmed';

        const insertResult = await sql`
          INSERT INTO orders (vendor, description, order_number, order_date, tracking_number,
                             carrier, status, estimated_delivery, project, notes, created_by)
          VALUES (
            'Legrand',
            ${description},
            ${lOrder.order_number},
            ${lOrder.order_date || null},
            ${lOrder.tracking_number},
            ${lOrder.carrier},
            ${trackerStatus},
            ${lOrder.estimated_delivery},
            ${lOrder.project},
            ${`Source: Legrand AV Portal | PO: ${lOrder.po_number || 'N/A'}`},
            'legrand-sync'
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
        details.push(`Inserted new: Legrand #${lOrder.order_number} (${lOrder.project || 'no project'})`);
      }
    }

    const summary = {
      timestamp: new Date().toISOString(),
      totalReceived: legrandOrders.length,
      enriched,
      inserted,
      skipped,
      details: details.slice(0, 50),
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Legrand enrichment error:', error);
    return NextResponse.json(
      { error: 'Enrichment failed', details: String(error) },
      { status: 500 }
    );
  }
}
