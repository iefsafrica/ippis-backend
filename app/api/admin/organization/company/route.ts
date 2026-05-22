import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Types
// -------------------------
type Company = {
  id: number;
  company_code: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  created_at: string;
};

type CreateCompanyBody = {
  name: string;
  email?: string | null;
  phone?: string | null;
  status?: 'active' | 'inactive';
};

type UpdateCompanyBody = {
  id: number;
  name?: string;
  email?: string | null;
  phone?: string | null;
  status?: 'active' | 'inactive';
};

// -------------------------
// GET
// -------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');

  if (idParam) {
    const id = Number(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid ID' },
        { status: 400 }
      );
    }

    const result = await sql`
      SELECT * FROM companies WHERE id = ${id}
    `;

    const company = result[0] as Company | undefined;

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: company });
  }

  const result = await sql`
    SELECT * FROM companies ORDER BY created_at DESC
  `;

  return NextResponse.json({ success: true, data: result });
}

// -------------------------
// POST
// -------------------------
export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateCompanyBody;

  const { name, email, phone, status } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json(
      { success: false, message: 'Name is required' },
      { status: 400 }
    );
  }

  // Get last company_code
  const lastCodeResult = await sql`
    SELECT company_code
    FROM companies
    ORDER BY created_at DESC
    LIMIT 1
  `;

  let newCompanyCode = 'IPPIS-C 00001';

  const lastRow = lastCodeResult[0] as { company_code: string } | undefined;

  if (lastRow?.company_code) {
    const match = String(lastRow.company_code).match(/\d+$/);

    if (match) {
      const nextNumber = parseInt(match[0], 10) + 1;
      const padded = String(nextNumber).padStart(5, '0');
      newCompanyCode = `IPPIS-C ${padded}`;
    }
  }

  const result = await sql`
    INSERT INTO companies (company_code, name, email, phone, status, created_at)
    VALUES (
      ${newCompanyCode},
      ${name},
      ${email ?? null},
      ${phone ?? null},
      ${status ?? 'active'},
      NOW()
    )
    RETURNING *
  `;

  const inserted = result[0] as Company | undefined;

  if (!inserted) {
    return NextResponse.json(
      { success: false, message: 'Failed to create company' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data: inserted });
}

// -------------------------
// PUT
// -------------------------
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as UpdateCompanyBody;

  const { id, name, email, phone, status } = body;

  if (!id || typeof id !== 'number') {
    return NextResponse.json(
      { success: false, message: 'Valid company ID is required' },
      { status: 400 }
    );
  }

  const result = await sql`
    UPDATE companies
    SET
      name = COALESCE(${name}, name),
      email = COALESCE(${email}, email),
      phone = COALESCE(${phone}, phone),
      status = COALESCE(${status}, status)
    WHERE id = ${id}
    RETURNING *
  `;

  const updated = result[0] as Company | undefined;

  if (!updated) {
    return NextResponse.json(
      { success: false, message: 'Company not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: updated });
}

// -------------------------
// DELETE
// -------------------------
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json(
      { success: false, message: 'Company ID is required' },
      { status: 400 }
    );
  }

  const id = Number(idParam);

  if (isNaN(id)) {
    return NextResponse.json(
      { success: false, message: 'Invalid ID' },
      { status: 400 }
    );
  }

  const result = await sql`
    DELETE FROM companies
    WHERE id = ${id}
    RETURNING *
  `;

  const deleted = result[0] as Company | undefined;

  if (!deleted) {
    return NextResponse.json(
      { success: false, message: 'Company not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Company deleted successfully',
    data: deleted,
  });
}   