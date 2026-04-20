import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// POST /api/enrich-crestron?secret=SYNC_SECRET
// Receives Crestron portal order data and enriches existing shipping tracker orders.
//
// For each Crestron order:
//   1. Match by tracking number (carrier emails from FedEx/UPS may already have the tracking)
//   2. Match by order number (Crestron order # may appear in email subjects)
//   3. Match by PO number (PO # from Crestron matches PO # parsed from emails)
//   4. If no match found but order has tracking, insert as a new order
//
// Enrichment adds: project name, carrier, tracking number, estimated delivery, vendor confirmation

interface CrestronOrder {
  vendor: string;
  order_number: string;
  po_number: string;
  project: string;
  order_date: string;
  status: string;
  tracking_number: string | null;
  carrier: string | null;
  estimated_delivery: string | null;
  delivery_number?: string;
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
    const crestronOrders: CrestronOrder[] = body.orders || [];

    if (crestronOrders.length === 0) {
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
      // Index by order_number (may have multiple matches)
      if (row.order_number) {
        const existing = dbByOrderNumber.get(row.order_number) || [];
        existing.push(row);
        dbByOrderNumber.set(row.order_number, existing);
      }
      // Index by description for keyword matching
      if (row.description) {
        const normDesc = row.description.toLowerCase().replace(/\s+/g, ' ').trim();
        dbByDescription.set(normDesc, row);
      }
    }

    let enriched = 0;
    let inserted = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const cOrder of crestronOrders) {
      let matchedRow: typeof existingOrders[0] | undefined;
      let matchType = '';

      // Strategy 1: Match by tracking number
      if (cOrder.tracking_number && dbByTracking.has(cOrder.tracking_number)) {
        matchedRow = dbByTracking.get(cOrder.tracking_number);
        matchType = 'tracking';
      }

      // Strategy 2: Match by Crestron order number appearing in existing order_number field
      if (!matchedRow && cOrder.order_number) {
        // Check exact match first
        const exactMatches = dbByOrderNumber.get(cOrder.order_number);
        if (exactMatches && exactMatches.length > 0) {
          matchedRow = exactMatches[0];
          matchType = 'order_number_exact';
        }

        // Check if Crestron order number appears anywhere in existing order numbers
        if (!matchedRow) {
          for (const row of existingOrders) {
            if (row.order_number && row.order_number.includes(cOrder.order_number)) {
              matchedRow = row;
              matchType = 'order_number_partial';
              break;
            }
          }
        }
      }

      // Strategy 3: Match by PO number appearing in existing order data
      if (!matchedRow && cOrder.po_number) {
        for (const row of existingOrders) {
          // Check if PO appears in order_number, description, or notes
          const poLower = cOrder.po_number.toLowerCase();
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

      // Strategy 4: Match by Crestron order number appearing in description/subject
      if (!matchedRow && cOrder.order_number) {
        for (const row of existingOrders) {
          if (row.description && row.description.includes(cOrder.order_number)) {
            matchedRow = row;
            matchType = 'description_order_num';
            break;
          }
        }
      }

      // Strategy 5: Match Crestron vendor + similar project name
      if (!matchedRow && cOrder.project) {
        const projLower = cOrder.project.toLowerCase();
        for (const row of existingOrders) {
          if (
            row.vendor &&
            row.vendor.toLowerCase().includes('crestron') &&
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
        // Enrich the existing order with Crestron data
        const updates: string[] = [];

        const newProject = cOrder.project && !matchedRow.project ? cOrder.project : null;
        const newTracking = cOrder.tracking_number && !matchedRow.tracking_number ? cOrder.tracking_number : null;
        const newCarrier = cOrder.carrier && !matchedRow.carrier ? cOrder.carrier : null;
        const newDelivery = cOrder.estimated_delivery && !matchedRow.estimated_delivery ? cOrder.estimated_delivery : null;
        const newVendor = matchedRow.vendor === 'Unknown' ? 'Crestron' : null;

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

          if (newProject) updates.push(`project=${cOrder.project}`);
          if (newTracking) updates.push(`tracking=${cOrder.tracking_number}`);
          if (newCarrier) updates.push(`carrier=${cOrder.carrier}`);
          if (newDelivery) updates.push(`delivery=${cOrder.estimated_delivery}`);
          if (newVendor) updates.push('vendor=Crestron');

          enriched++;
          details.push(`Enriched order #${matchedRow.id} (${matchType}): ${updates.join(', ')}`);
        } else {
          skipped++;
        }
      } else if (cOrder.tracking_number || cOrder.status !== 'Complete') {
        // No match found — insert as new order if it has useful data
        const description = [
          cOrder.po_number ? `PO: ${cOrder.po_number}` : '',
          cOrder.order_number ? `Crestron #${cOrder.order_number}` : '',
        ].filter(Boolean).join(' — ') || `Crestron Order ${cOrder.order_number}`;

        // Map Crestron status to shipping tracker status
        let trackerStatus = 'Order Confirmed';
        if (cOrder.status === 'Complete') trackerStatus = 'Delivered';
        else if (cOrder.status === 'In Progress') trackerStatus = 'In Transit';
        else if (cOrder.status === 'Shipped') trackerStatus = 'Shipped';

        await sql`
          INSERT INTO orders (vendor, description, order_number, order_date, tracking_number,
                             carrier, status, estimated_delivery, project, notes, created_by)
          VALUES (
            'Crestron',
            ${description},
            ${cOrder.order_number},
            ${cOrder.order_date || null},
            ${cOrder.tracking_number},
            ${cOrder.carrier},
            ${trackerStatus},
            ${cOrder.estimated_delivery},
            ${cOrder.project},
            ${`Source: Crestron Portal | PO: ${cOrder.po_number || 'N/A'}`},
            'crestron-sync'
          )
        `;
        inserted++;
        details.push(`Inserted new: Crestron #${cOrder.order_number} (${cOrder.project || 'no project'})`);
      } else {
        skipped++;
      }
    }

    const summary = {
      timestamp: new Date().toISOString(),
      totalReceived: crestronOrders.length,
      enriched,
      inserted,
      skipped,
      details: details.slice(0, 50), // Cap details to avoid huge response
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Crestron enrichment error:', error);
    return NextResponse.json(
      { error: 'Enrichment failed', details: String(error) },
      { status: 500 }
    );
  }
}
