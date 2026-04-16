import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { fetchShippingEmails, parseShippingEmail, dedupeKey } from '@/lib/graph';

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

    // Deduplicate within this batch
    const seen = new Map<string, typeof parsed[0]>();
    for (const order of parsed) {
      const key = dedupeKey(order);
      if (!seen.has(key)) {
        seen.set(key, order);
      }
    }
    const unique = Array.from(seen.values());

    // Check existing orders in DB to avoid duplicates
    const { rows: existingOrders } = await sql`
      SELECT order_number, tracking_number, vendor FROM orders
    `;

    const existingKeys = new Set<string>();
    for (const row of existingOrders) {
      if (row.tracking_number) existingKeys.add(`tracking:${row.tracking_number}`);
      if (row.order_number) existingKeys.add(`order:${row.vendor}:${row.order_number}`);
    }

    // Insert only new orders
    let inserted = 0;
    let skipped = 0;

    for (const order of unique) {
      const key = dedupeKey(order);
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      await sql`
        INSERT INTO orders (vendor, description, order_number, order_date, tracking_number, carrier, status, estimated_delivery, project, notes, created_by)
        VALUES (${order.vendor}, ${order.description}, ${order.order_number}, ${order.order_date}, ${order.tracking_number}, ${order.carrier}, ${order.status}, ${order.estimated_delivery}, ${order.project}, ${order.notes}, ${order.created_by})
      `;

      existingKeys.add(key);
      inserted++;
    }

    // Log the sync
    const summary = {
      timestamp: new Date().toISOString(),
      emailsFetched: emails.length,
      emailsParsed: parsed.length,
      uniqueOrders: unique.length,
      inserted,
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
