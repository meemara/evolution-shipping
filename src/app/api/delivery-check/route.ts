import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

/**
 * Delivery Check & Cleanup endpoint.
 *
 * Checks tracking numbers against UPS/FedEx APIs to find delivered packages,
 * then removes confirmed-delivered orders from the tracker.
 *
 * POST /api/delivery-check?secret=SYNC_SECRET
 *
 * Query params:
 *   - secret: required auth token
 *   - dry_run=true: just report what would be deleted, don't delete
 *   - age_days=7: also mark orders older than N days with tracking as delivered (default 7)
 */

interface TrackingResult {
  tracking_number: string;
  delivered: boolean;
  status: string;
  delivery_date?: string;
}

// Check UPS tracking numbers via their public web API
async function checkUPSBatch(trackingNumbers: string[]): Promise<TrackingResult[]> {
  const results: TrackingResult[] = [];

  try {
    const resp = await fetch('https://www.ups.com/track/api/Track/GetStatus?loc=en_US', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://www.ups.com',
        'Referer': 'https://www.ups.com/track?loc=en_US',
      },
      body: JSON.stringify({
        Locale: 'en_US',
        TrackingNumber: trackingNumbers,
      }),
    });

    if (!resp.ok) {
      console.log(`UPS API returned ${resp.status} — falling back to age-based check`);
      return trackingNumbers.map(t => ({
        tracking_number: t,
        delivered: false,
        status: `API error: ${resp.status}`,
      }));
    }

    const data = await resp.json();

    if (data.trackDetails && Array.isArray(data.trackDetails)) {
      for (const detail of data.trackDetails) {
        const trackNum = detail.trackingNumber || '';
        const status = detail.packageStatus || '';
        const delivered = status.toLowerCase().includes('delivered');
        const deliveryDate = detail.deliveredDate || detail.deliveryInformation?.deliveryDate || undefined;

        results.push({
          tracking_number: trackNum,
          delivered,
          status,
          delivery_date: deliveryDate,
        });
      }
    }
  } catch (err) {
    console.error('UPS API error:', err);
    return trackingNumbers.map(t => ({
      tracking_number: t,
      delivered: false,
      status: `API error: ${String(err)}`,
    }));
  }

  return results;
}

// Check FedEx tracking numbers
async function checkFedExBatch(trackingNumbers: string[]): Promise<TrackingResult[]> {
  const results: TrackingResult[] = [];

  try {
    const trackingList = trackingNumbers.map(t => ({
      trackNumberInfo: {
        trackingNumber: t,
        trackingQualifier: '',
        trackingCarrier: '',
      },
    }));

    const payload = {
      TrackPackagesRequest: {
        appType: 'WTRK',
        appDeviceType: 'DESKTOP',
        supportHTML: true,
        supportCurrentLocation: true,
        uniqueKey: '',
        processingParameters: {},
        trackingInfoList: trackingList,
      },
    };

    const resp = await fetch('https://www.fedex.com/trackingCal/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.fedex.com/fedextrack/',
      },
      body: `data=${encodeURIComponent(JSON.stringify(payload))}&action=trackpackages&locale=en_US&version=1&format=json`,
    });

    if (!resp.ok) {
      console.log(`FedEx API returned ${resp.status} — falling back to age-based check`);
      return trackingNumbers.map(t => ({
        tracking_number: t,
        delivered: false,
        status: `API error: ${resp.status}`,
      }));
    }

    const data = await resp.json();

    if (data.TrackPackagesResponse?.packageList) {
      for (const pkg of data.TrackPackagesResponse.packageList) {
        const trackNum = pkg.trackingNbr || '';
        const status = pkg.keyStatus || '';
        const delivered = status.toLowerCase().includes('delivered');
        const deliveryDate = pkg.displayActDeliveryDt || undefined;

        results.push({
          tracking_number: trackNum,
          delivered,
          status,
          delivery_date: deliveryDate,
        });
      }
    }
  } catch (err) {
    console.error('FedEx API error:', err);
    return trackingNumbers.map(t => ({
      tracking_number: t,
      delivered: false,
      status: `API error: ${String(err)}`,
    }));
  }

  return results;
}

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

    // Separate by carrier
    const upsOrders = orders.filter(o => (o.tracking_number || '').startsWith('1Z'));
    const fedexOrders = orders.filter(o =>
      !(o.tracking_number || '').startsWith('1Z') &&
      /^\d{10,22}$/.test(o.tracking_number || '')
    );
    const otherOrders = orders.filter(o =>
      !upsOrders.includes(o) && !fedexOrders.includes(o)
    );

    const deliveredIds: number[] = [];
    const apiResults: TrackingResult[] = [];

    // Check UPS in batches of 25
    for (let i = 0; i < upsOrders.length; i += 25) {
      const batch = upsOrders.slice(i, i + 25);
      const trackingNums = batch.map(o => o.tracking_number);
      const results = await checkUPSBatch(trackingNums);
      apiResults.push(...results);

      for (const result of results) {
        if (result.delivered) {
          const order = batch.find(o => o.tracking_number === result.tracking_number);
          if (order) deliveredIds.push(order.id);
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + 25 < upsOrders.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Check FedEx in batches of 25
    for (let i = 0; i < fedexOrders.length; i += 25) {
      const batch = fedexOrders.slice(i, i + 25);
      const trackingNums = batch.map(o => o.tracking_number);
      const results = await checkFedExBatch(trackingNums);
      apiResults.push(...results);

      for (const result of results) {
        if (result.delivered) {
          const order = batch.find(o => o.tracking_number === result.tracking_number);
          if (order) deliveredIds.push(order.id);
        }
      }

      if (i + 25 < fedexOrders.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Age-based fallback: if order is older than ageDays and has tracking, consider it delivered
    const ageThreshold = new Date();
    ageThreshold.setDate(ageThreshold.getDate() - ageDays);

    const agedOutIds: number[] = [];
    for (const order of orders) {
      if (deliveredIds.includes(order.id)) continue; // already confirmed
      const orderDate = new Date(order.created_at);
      if (orderDate < ageThreshold) {
        agedOutIds.push(order.id);
      }
    }

    // Combined list of IDs to remove
    const allDeliveredIds = [...new Set([...deliveredIds, ...agedOutIds])];

    let deleted = 0;
    let statusUpdated = 0;

    if (!dryRun && allDeliveredIds.length > 0) {
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

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      dryRun,
      totalChecked: orders.length,
      breakdown: {
        ups: upsOrders.length,
        fedex: fedexOrders.length,
        other: otherOrders.length,
      },
      apiConfirmedDelivered: deliveredIds.length,
      agedOutDelivered: agedOutIds.length,
      totalDelivered: allDeliveredIds.length,
      deleted,
      statusUpdated,
      junkRemoved,
      // Show sample of what was found
      sampleResults: apiResults.slice(0, 10).map(r => ({
        tracking: r.tracking_number,
        status: r.status,
        delivered: r.delivered,
      })),
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
