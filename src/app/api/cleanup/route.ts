import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// One-time cleanup: remove duplicate orders from the database.
// Keeps the oldest entry for each group of duplicates, merges info into it, deletes the rest.
// POST /api/cleanup?secret=SYNC_SECRET

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.SYNC_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // If ?reset_senders=true, clear all sender_email values so sync can repopulate them
    if (searchParams.get('reset_senders') === 'true') {
      await sql`UPDATE orders SET sender_email = NULL`;
    }

    // First: remove junk entries with no useful data
    const { rowCount: junkRemoved } = await sql`
      DELETE FROM orders
      WHERE (description = 'script' OR description = '' OR description IS NULL)
         OR (vendor = 'Unknown' AND tracking_number IS NULL AND order_number IS NULL AND (description IS NULL OR LENGTH(description) < 15))
    `;

    // Get all remaining orders
    const { rows: allOrders } = await sql`
      SELECT id, vendor, description, order_number, order_date, tracking_number, carrier, status, estimated_delivery, project
      FROM orders
      ORDER BY id ASC
    `;

    // Normalize description for comparison
    function normDesc(desc: string): string {
      return (desc || '')
        .replace(/^(FW:|Fw:|RE:|Re:)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    // Group duplicates by: tracking number, order number, or normalized description
    // Each order gets assigned to a group; first one in the group is the "keeper"
    const groupMap = new Map<number, number>(); // order id -> keeper id
    const groups = new Map<number, typeof allOrders>(); // keeper id -> list of duplicates

    const byTracking = new Map<string, number>(); // tracking -> keeper id
    const byOrderVendor = new Map<string, number>(); // vendor:order_number -> keeper id
    const byDesc = new Map<string, number>(); // normalized description -> keeper id

    for (const row of allOrders) {
      let keeperId: number | undefined;

      // Check tracking number
      if (row.tracking_number && byTracking.has(row.tracking_number)) {
        keeperId = byTracking.get(row.tracking_number);
      }

      // Check order number + vendor
      if (keeperId === undefined && row.order_number && row.vendor) {
        const key = `${row.vendor}:${row.order_number}`;
        if (byOrderVendor.has(key)) {
          keeperId = byOrderVendor.get(key);
        }
      }

      // Check normalized description (must be meaningful length)
      if (keeperId === undefined) {
        const nd = normDesc(row.description);
        if (nd.length > 10 && byDesc.has(nd)) {
          keeperId = byDesc.get(nd);
        }
      }

      if (keeperId !== undefined) {
        // This is a duplicate — add to the group
        groupMap.set(row.id, keeperId);
        const group = groups.get(keeperId) || [];
        group.push(row);
        groups.set(keeperId, group);
      } else {
        // This is a new unique order — it becomes a keeper
        groupMap.set(row.id, row.id);
        if (row.tracking_number) byTracking.set(row.tracking_number, row.id);
        if (row.order_number && row.vendor) byOrderVendor.set(`${row.vendor}:${row.order_number}`, row.id);
        const nd = normDesc(row.description);
        if (nd.length > 10) byDesc.set(nd, row.id);
      }
    }

    // For each group, merge info into the keeper and delete duplicates
    let deleted = 0;
    let updated = 0;

    for (const [keeperId, duplicates] of groups.entries()) {
      // Find the keeper row
      const keeper = allOrders.find(r => r.id === keeperId);
      if (!keeper) continue;

      let needsUpdate = false;

      for (const dup of duplicates) {
        // Merge any non-null fields from duplicate into keeper
        if (!keeper.tracking_number && dup.tracking_number) {
          keeper.tracking_number = dup.tracking_number;
          needsUpdate = true;
        }
        if (!keeper.carrier && dup.carrier) {
          keeper.carrier = dup.carrier;
          needsUpdate = true;
        }
        if (!keeper.estimated_delivery && dup.estimated_delivery) {
          keeper.estimated_delivery = dup.estimated_delivery;
          needsUpdate = true;
        }
        if (!keeper.project && dup.project) {
          keeper.project = dup.project;
          needsUpdate = true;
        }
        if (keeper.vendor === 'Unknown' && dup.vendor !== 'Unknown') {
          keeper.vendor = dup.vendor;
          keeper.description = dup.description;
          needsUpdate = true;
        }
        if (!keeper.order_number && dup.order_number) {
          keeper.order_number = dup.order_number;
          needsUpdate = true;
        }

        // Delete the duplicate
        await sql`DELETE FROM orders WHERE id = ${dup.id}`;
        deleted++;
      }

      // Update keeper with merged data
      if (needsUpdate) {
        await sql`
          UPDATE orders SET
            tracking_number = ${keeper.tracking_number},
            carrier = ${keeper.carrier},
            estimated_delivery = ${keeper.estimated_delivery},
            project = ${keeper.project},
            vendor = ${keeper.vendor},
            description = ${keeper.description},
            order_number = ${keeper.order_number}
          WHERE id = ${keeperId}
        `;
        updated++;
      }
    }

    return NextResponse.json({
      junkRemoved: junkRemoved || 0,
      totalOrdersAfterJunk: allOrders.length,
      duplicatesRemoved: deleted,
      ordersUpdatedWithMergedData: updated,
      remainingOrders: allOrders.length - deleted,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', details: String(error) },
      { status: 500 }
    );
  }
}
