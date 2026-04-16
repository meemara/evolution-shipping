-- Evolution Shipping Tracker - Database Schema
-- Run this once in your Vercel Postgres console

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS change_log (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  changed_by VARCHAR(100) NOT NULL,
  field_changed VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMP DEFAULT NOW()
);

-- Seed employees (add more as needed)
INSERT INTO employees (name, role) VALUES
  ('Mark Meece', 'admin'),
  ('Josh Fontaine', 'admin')
ON CONFLICT (name) DO NOTHING;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_change_log_order ON change_log(order_id);
CREATE INDEX IF NOT EXISTS idx_change_log_date ON change_log(changed_at);
