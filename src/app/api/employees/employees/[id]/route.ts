import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { name, role } = await request.json();
    const { rows } = await sql`
      UPDATE employees SET
        name = COALESCE(${name ?? null}, name),
        role = COALESCE(${role ?? null}, role)
      WHERE id = ${parseInt(id)}
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error('Error updating employee:', error);
    return NextResponse.json({ error: 'Failed to update employee' }, { status: 500 });
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
