import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST() {
  try {
    // Create tables
    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        vendor VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        order_number VARCHAR(100),
        order_date DATE,
        tracking_number VARCHAR(200),
        carrier VARCHAR(100),
        status VARCHAR(50) NOT NULL DEFAULT 'Order Placed',
        estimated_delivery DATE,
        actual_delivery DATE,
        project VARCHAR(200),
        notes TEXT,
        created_by VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS change_log (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        changed_by VARCHAR(100) NOT NULL,
        field_changed VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Seed default employees
    await sql`
      INSERT INTO employees (name, role) VALUES ('Mark Meece', 'admin')
      ON CONFLICT (name) DO NOTHING
    `;
    await sql`
      INSERT INTO employees (name, role) VALUES ('Josh Fontaine', 'admin')
      ON CONFLICT (name) DO NOTHING
    `;

    // Add sender_email column if it doesn't exist
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255)`;

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_change_log_order ON change_log(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_change_log_date ON change_log(changed_at)`;

    return NextResponse.json({ success: true, message: 'Database initialized successfully' });
  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json({ error: 'Setup failed', details: String(error) }, { status: 500 });
  }
}
