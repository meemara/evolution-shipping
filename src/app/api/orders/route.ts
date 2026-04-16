import { NextResponse } from 'next/server';
import { getOrders, createOrder } from '@/lib/db';

export async function GET() {
  try {
    const orders = await getOrders();
    return NextResponse.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.vendor || !body.description || !body.created_by) {
      return NextResponse.json(
        { error: 'Vendor, description, and created_by are required' },
        { status: 400 }
      );
    }
    const order = await createOrder({
      vendor: body.vendor,
      description: body.description,
      order_number: body.order_number || null,
      order_date: body.order_date || null,
      tracking_number: body.tracking_number || null,
      carrier: body.carrier || null,
      status: body.status || 'Order Placed',
      estimated_delivery: body.estimated_delivery || null,
      actual_delivery: body.actual_delivery || null,
      project: body.project || null,
      notes: body.notes || null,
      created_by: body.created_by,
    });
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error('Error creating order:', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
