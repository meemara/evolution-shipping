import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { lookupTracking, type TrackingResult } from '@/lib/carrier-tracking';

/**
 * Delivery Check & Cleanup endpoint.
 *
 * Checks tracking numbers against the carrier tracking provider (EasyPost) to find
 * delivered packages, then removes confirmed-delivered orders from the tracker.
 *
 * POST /api/delivery-check?secret=SYNC_SECRET
 *
 * Query params:
 *   - secret: required auth token
 *   - dry_run=true: just report what would be deleted, don't delete
 *   - age_days=7: also mark orders older than N days with tracking as delivered (default 7)
 *   - delete=false: update status to Delivered instead of deleting
 *   - force=true: override the blast-radius guard
 *
 * 2026-09-18: the lookup layer was scraped consumer endpoints (ups.com / fedex.com)
 * that started returning bot-challenge HTML. Replaced with EasyPost; see
 * src/lib/carrier-tracking.ts. Carrier detection is now EasyPost's job, so tracking
 * numbers that match neither the old "1Z..." nor the old digits-only pattern are no
 * longer stranded in an unverifiable bucket.
 */

// Up to ~200 lookups per run, run concurrently. Vercel clamps this to the plan maximum.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.SYNC_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = searchParams.get('dry_run') === 'true';
    const ageDays = parseInt(searchParams.get('age_days') || '7');
    const deleteDelivered = searchParams.get('delete') !== 'false'; // default true
    // Explicit override for the blast-radius guard below. Off unless asked for.
    const force = searchParams.get('force') === 'true';

    // Get all orders with tracking numbers not already marked delivered
    const { rows: orders } = await sql`
      SELECT id, vendor, description, tracking_number, carrier, status, created_at, order_date
      FROM orders
      WHERE tracking_number IS NOT NULL
        AND tracking_number != ''
        AND tracking_number != 'Unavailable'
        AND status != 'Delivered'
        AND status != 'Cancelled'
      ORDER BY created_at ASC
    `;

    console.log(`Found ${orders.length} orders with tracking to check`);

    // One lookup path for every tracked order. EasyPost auto-detects the carrier from
    // the tracking code; the vendor's own carrier column is passed only as a hint.
    const apiResults: TrackingResult[] = await lookupTracking(
      orders.map(o => ({
        tracking_number: o.tracking_number as string,
        carrier_hint: o.carrier as string | null,
      })),
    );

    const resultByTracking = new Map<string, TrackingResult>();
    for (const r of apiResults) resultByTracking.set(r.tracking_number, r);

    const deliveredIds: number[] = [];
    for (const order of orders) {
      const result = resultByTracking.get(order.tracking_number || '');
      if (result?.verified && result.delivered) deliveredIds.push(order.id);
    }

    // Which tracking numbers actually got a real answer from the carrier?
    // A failed lookup must NOT feed the age rule. Otherwise a carrier outage
    // silently reclassifies "could not verify" as "old enough to delete", which is
    // how a broken carrier integration can empty the entire tracker. (2026-09-18)
    //
    // This used to sniff for an "API error" prefix on the status string. It is now an
    // explicit `verified` flag set by the lookup layer, which also covers the case of a
    // successful HTTP call that carries no usable carrier data ("unknown"). Strictly
    // narrower than before: nothing that was excluded is now included.
    const lookupOk = new Set(
      apiResults.filter(r => r.verified).map(r => r.tracking_number),
    );

    // Age-based rule: only applies to orders the carrier actually answered for.
    const ageThreshold = new Date();
    ageThreshold.setDate(ageThreshold.getDate() - ageDays);

    const agedOutIds: number[] = [];
    let ageSkippedUnverified = 0;
    for (const order of orders) {
      if (deliveredIds.includes(order.id)) continue; // already confirmed by carrier
      const orderDate = new Date(order.created_at);
      if (!(orderDate < ageThreshold)) continue;
      if (!lookupOk.has(order.tracking_number || '')) {
        // Old, but we never got a usable carrier response for it. Leave it alone.
        ageSkippedUnverified++;
        continue;
      }
      agedOutIds.push(order.id);
    }

    // Combined list of IDs to remove
    const allDeliveredIds = [...new Set([...deliveredIds, ...agedOutIds])];

    // Hard blast-radius guard. This used to exist only as a sentence in a Cowork
    // task prompt -- an instruction to a model, not code. If a run would remove
    // more than half the tracker, it removes nothing and says so. (2026-09-18)
    const MAX_REMOVAL_FRACTION = 0.5;
    const removalFraction = orders.length > 0 ? allDeliveredIds.length / orders.length : 0;
    const guardTripped = !force && removalFraction > MAX_REMOVAL_FRACTION;

    if (guardTripped) {
      console.warn(
        `SAFETY GUARD: run would remove ${allDeliveredIds.length}/${orders.length} ` +
        `(${(removalFraction * 100).toFixed(1)}%) of tracked orders. Nothing removed. ` +
        `Re-run with &force=true only if this is genuinely intended.`
      );
    }

    let deleted = 0;
    let statusUpdated = 0;

    if (!dryRun && !guardTripped && allDeliveredIds.length > 0) {
      if (deleteDelivered) {
        // Delete delivered orders and their change logs
        for (const id of allDeliveredIds) {
          await sql`DELETE FROM change_log WHERE order_id = ${id}`;
          await sql`DELETE FROM orders WHERE id = ${id}`;
          deleted++;
        }
      } else {
        // Just update status to Delivered
        for (const id of allDeliveredIds) {
          await sql`UPDATE orders SET status = 'Delivered', updated_at = NOW() WHERE id = ${id}`;
          statusUpdated++;
        }
      }
    }

    // Also clean up orders with no tracking and no useful data that are old
    let junkRemoved = 0;
    if (!dryRun) {
      const { rowCount } = await sql`
        DELETE FROM orders
        WHERE tracking_number IS NULL
          AND order_number IS NULL
          AND status IN ('Order Placed', 'Shipped')
          AND created_at < ${ageThreshold.toISOString()}
          AND (description IS NULL OR LENGTH(description) < 15)
      `;
      junkRemoved = rowCount || 0;
    }

    // Breakdown by the carrier EasyPost actually resolved, rather than by guessing from
    // the shape of the tracking number.
    const breakdown: Record<string, number> = { ups: 0, fedex: 0, other: 0 };
    const unresolved: Array<{ tracking: string; vendor: string; status: string }> = [];
    for (const order of orders) {
      const result = resultByTracking.get(order.tracking_number || '');
      const carrier = (result?.detected_carrier || '').toLowerCase();
      if (carrier.includes('ups')) breakdown.ups++;
      else if (carrier.includes('fedex')) breakdown.fedex++;
      else breakdown.other++;

      if (!result?.verified) {
        unresolved.push({
          tracking: order.tracking_number as string,
          vendor: order.vendor as string,
          status: result?.status || 'no result',
        });
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      dryRun,
      totalChecked: orders.length,
      breakdown,
      apiConfirmedDelivered: deliveredIds.length,
      agedOutDelivered: agedOutIds.length,
      ageSkippedUnverified,
      carrierLookupsOk: lookupOk.size,
      carrierLookupsFailed: apiResults.length - lookupOk.size,
      guardTripped,
      removalFraction: Number(removalFraction.toFixed(3)),
      totalDelivered: allDeliveredIds.length,
      deleted,
      statusUpdated,
      junkRemoved,
      // Show sample of what was found
      sampleResults: apiResults.slice(0, 10).map(r => ({
        tracking: r.tracking_number,
        status: r.status,
        delivered: r.delivered,
        carrier: r.detected_carrier,
      })),
      // Every order the carrier could not give a usable answer for. These never age out.
      unresolved: unresolved.slice(0, 25),
      deliveredOrderIds: dryRun ? allDeliveredIds : undefined,
    });
  } catch (error) {
    console.error('Delivery check error:', error);
    return NextResponse.json(
      { error: 'Delivery check failed', details: String(error) },
      { status: 500 }
    );
  }
}
