import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const name = body.name?.trim() || null;
    const role = body.role || null;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const { rows } = await sql`
      UPDATE employees SET
        name = ${name},
        role = COALESCE(${role}, role)
      WHERE id = ${parseInt(id)}
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (error: unknown) {
    console.error('Error updating employee:', error);
    const msg = error instanceof Error && error.message.includes('unique')
      ? 'An employee with that name already exists'
      : 'Failed to update employee';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { rowCount } = await sql`DELETE FROM employees WHERE id = ${parseInt(id)}`;
    if ((rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting employee:', error);
    return NextResponse.json({ error: 'Failed to delete employee' }, { status: 500 });
  }
}
