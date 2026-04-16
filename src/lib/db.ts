import { sql } from '@vercel/postgres';

// Order statuses in lifecycle order
export const ORDER_STATUSES = [
  'Order Placed',
  'Order Confirmed',
  'Processing',
  'Shipped',
  'In Transit',
  'Out for Delivery',
  'Delivered',
  'Delayed',
  'Cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  id: number;
  vendor: string;
  description: string;
  order_number: string | null;
  order_date: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status: OrderStatus;
  estimated_delivery: string | null;
  actual_delivery: string | null;
  project: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ChangeLogEntry {
  id: number;
  order_id: number;
  changed_by: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  vendor?: string;
  description?: string;
}

export interface Employee {
  id: number;
  name: string;
  role: 'admin' | 'viewer';
}

// --- Employees ---

export async function getEmployees(): Promise<Employee[]> {
  const { rows } = await sql`SELECT * FROM employees ORDER BY name`;
  return rows as Employee[];
}

export async function getEmployee(name: string): Promise<Employee | null> {
  const { rows } = await sql`SELECT * FROM employees WHERE name = ${name}`;
  return (rows[0] as Employee) || null;
}

export async function addEmployee(name: string, role: string = 'viewer'): Promise<Employee> {
  const { rows } = await sql`
    INSERT INTO employees (name, role) VALUES (${name}, ${role})
    RETURNING *
  `;
  return rows[0] as Employee;
}

// --- Orders ---

export async function getOrders(): Promise<Order[]> {
  const { rows } = await sql`
    SELECT * FROM orders ORDER BY
      CASE status
        WHEN 'Delayed' THEN 0
        WHEN 'Out for Delivery' THEN 1
        WHEN 'In Transit' THEN 2
        WHEN 'Shipped' THEN 3
        WHEN 'Processing' THEN 4
        WHEN 'Order Confirmed' THEN 5
        WHEN 'Order Placed' THEN 6
        WHEN 'Delivered' THEN 7
        WHEN 'Cancelled' THEN 8
      END,
      updated_at DESC
  `;
  return rows as Order[];
}

export async function getOrder(id: number): Promise<Order | null> {
  const { rows } = await sql`SELECT * FROM orders WHERE id = ${id}`;
  return (rows[0] as Order) || null;
}

export async function createOrder(order: Omit<Order, 'id' | 'created_at' | 'updated_at'>): Promise<Order> {
  const { rows } = await sql`
    INSERT INTO orders (vendor, description, order_number, order_date, tracking_number, carrier, status, estimated_delivery, actual_delivery, project, notes, created_by)
    VALUES (${order.vendor}, ${order.description}, ${order.order_number}, ${order.order_date}, ${order.tracking_number}, ${order.carrier}, ${order.status}, ${order.estimated_delivery}, ${order.actual_delivery}, ${order.project}, ${order.notes}, ${order.created_by})
    RETURNING *
  `;
  return rows[0] as Order;
}

export async function updateOrder(
  id: number,
  updates: Partial<Order>,
  changedBy: string
): Promise<Order | null> {
  const current = await getOrder(id);
  if (!current) return null;

  // Log each changed field
  const fieldsToCheck = [
    'vendor', 'description', 'order_number', 'order_date', 'tracking_number',
    'carrier', 'status', 'estimated_delivery', 'actual_delivery', 'project', 'notes'
  ] as const;

  for (const field of fieldsToCheck) {
    if (field in updates && updates[field as keyof Order] !== current[field as keyof Order]) {
      await sql`
        INSERT INTO change_log (order_id, changed_by, field_changed, old_value, new_value)
        VALUES (${id}, ${changedBy}, ${field}, ${String(current[field as keyof Order] || '')}, ${String(updates[field as keyof Order] || '')})
      `;
    }
  }

  const { rows } = await sql`
    UPDATE orders SET
      vendor = COALESCE(${updates.vendor ?? null}, vendor),
      description = COALESCE(${updates.description ?? null}, description),
      order_number = COALESCE(${updates.order_number ?? null}, order_number),
      order_date = COALESCE(${updates.order_date ?? null}, order_date),
      tracking_number = COALESCE(${updates.tracking_number ?? null}, tracking_number),
      carrier = COALESCE(${updates.carrier ?? null}, carrier),
      status = COALESCE(${updates.status ?? null}, status),
      estimated_delivery = COALESCE(${updates.estimated_delivery ?? null}, estimated_delivery),
      actual_delivery = COALESCE(${updates.actual_delivery ?? null}, actual_delivery),
      project = COALESCE(${updates.project ?? null}, project),
      notes = COALESCE(${updates.notes ?? null}, notes),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return (rows[0] as Order) || null;
}

export async function deleteOrder(id: number): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM orders WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}

// --- Change Log ---

export async function getChangeLog(orderId?: number): Promise<ChangeLogEntry[]> {
  if (orderId) {
    const { rows } = await sql`
      SELECT cl.*, o.vendor, o.description
      FROM change_log cl
      LEFT JOIN orders o ON cl.order_id = o.id
      WHERE cl.order_id = ${orderId}
      ORDER BY cl.changed_at DESC
    `;
    return rows as ChangeLogEntry[];
  }
  const { rows } = await sql`
    SELECT cl.*, o.vendor, o.description
    FROM change_log cl
    LEFT JOIN orders o ON cl.order_id = o.id
    ORDER BY cl.changed_at DESC
    LIMIT 200
  `;
  return rows as ChangeLogEntry[];
}
