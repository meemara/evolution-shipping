import { NextResponse } from 'next/server';
import { getChangeLog } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');
    const log = await getChangeLog(orderId ? parseInt(orderId) : undefined);
    return NextResponse.json(log);
  } catch (error) {
    console.error('Error fetching change log:', error);
    return NextResponse.json({ error: 'Failed to fetch change log' }, { status: 500 });
  }
}
