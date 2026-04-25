import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { isAdmin } from '@/lib/db';

// GET: list all blocked senders
export async function GET() {
  try {
    // Create table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS blocked_senders (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        blocked_by VARCHAR(100) NOT NULL,
        reason VARCHAR(255),
        blocked_at TIMESTAMP DEFAULT NOW()
      )
    `;
    const { rows } = await sql`SELECT * FROM blocked_senders ORDER BY blocked_at DESC`;
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching blocked senders:', error);
    return NextResponse.json({ error: 'Failed to fetch blocked senders' }, { status: 500 });
  }
}

// POST: block a sender and delete all their orders
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, blocked_by, reason, delete_orders, user_id } = body;

    if (!email || !blocked_by) {
      return NextResponse.json({ error: 'email and blocked_by are required' }, { status: 400 });
    }

    if (!user_id || !(await isAdmin(parseInt(user_id)))) {
      return NextResponse.json({ error: 'Only admins can block senders' }, { status: 403 });
    }

    // Create table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS blocked_senders (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        blocked_by VARCHAR(100) NOT NULL,
        reason VARCHAR(255),
        blocked_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Add to block list
    await sql`
      INSERT INTO blocked_senders (email, blocked_by, reason)
      VALUES (${email.toLowerCase()}, ${blocked_by}, ${reason || 'Blocked by admin'})
      ON CONFLICT (email) DO NOTHING
    `;

    // Delete all orders from this sender if requested
    let deletedCount = 0;
    if (delete_orders) {
      const { rowCount } = await sql`
        DELETE FROM orders WHERE LOWER(sender_email) = ${email.toLowerCase()}
      `;
      deletedCount = rowCount || 0;
    }

    return NextResponse.json({
      success: true,
      blocked: email.toLowerCase(),
      ordersDeleted: deletedCount,
    });
  } catch (error) {
    console.error('Error blocking sender:', error);
    return NextResponse.json({ error: 'Failed to block sender' }, { status: 500 });
  }
}
