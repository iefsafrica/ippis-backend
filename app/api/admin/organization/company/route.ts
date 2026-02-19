import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Company type
// -------------------------
type Company = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: 'active' | 'inactive';
  created_at: string;
};

// -------------------------
// Helper: check if table exists
// -------------------------
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      )
    `;
    return (result[0] as any)?.exists ?? false;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    return false;
  }
}

// -------------------------
// GET: list all companies or get by id
// -------------------------
export async function GET(req: NextRequest) {
  const tableCheck = await tableExists('companies');
  if (!tableCheck) {
    return NextResponse.json(
      { success: false, message: 'Companies table does not exist' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    // Fetch single company by ID
    const result = await sql`SELECT * FROM companies WHERE id = ${id}`;
    const company = (result[0] as any) ?? null;

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: String(company.id),
        name: company.name,
        email: company.email ?? null,
        phone: company.phone ?? null,
        status: company.status === 'active' ? 'active' : 'inactive',
        created_at: company.created_at,
      },
    });
  }

  // List all companies
  const result = await sql`SELECT * FROM companies ORDER BY created_at DESC`;
  const companies = (result as any[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status === 'active' ? 'active' : 'inactive',
    created_at: row.created_at,
  })) as Company[];

  return NextResponse.json({ success: true, data: companies });
}

// -------------------------
// POST: create a company
// -------------------------
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<Company>;
  const { name, email, phone, status } = body;

  if (!name) {
    return NextResponse.json(
      { success: false, message: 'Name is required' },
      { status: 400 }
    );
  }

  const result = await sql`
    INSERT INTO companies (name, email, phone, status, created_at)
    VALUES (${name}, ${email ?? null}, ${phone ?? null}, ${status ?? 'active'}, NOW())
    RETURNING *
  `;

  const inserted = result[0] as any;
  const company: Company = {
    id: String(inserted.id),
    name: inserted.name,
    email: inserted.email ?? null,
    phone: inserted.phone ?? null,
    status: inserted.status === 'active' ? 'active' : 'inactive',
    created_at: inserted.created_at,
  };

  return NextResponse.json({ success: true, data: company });
}

// -------------------------
// PUT: update a company
// -------------------------
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<Company> & { id: string };
  const { id, name, email, phone, status } = body;

  if (!id) {
    return NextResponse.json(
      { success: false, message: 'Company ID is required' },
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

  const updated = result[0] as any;
  if (!updated) {
    return NextResponse.json(
      { success: false, message: 'Company not found' },
      { status: 404 }
    );
  }

  const company: Company = {
    id: String(updated.id),
    name: updated.name,
    email: updated.email ?? null,
    phone: updated.phone ?? null,
    status: updated.status === 'active' ? 'active' : 'inactive',
    created_at: updated.created_at,
  };

  return NextResponse.json({ success: true, data: company });
}

// -------------------------
// DELETE: delete a company
// -------------------------
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      { success: false, message: 'Company ID is required' },
      { status: 400 }
    );
  }

  const result = await sql`DELETE FROM companies WHERE id = ${id} RETURNING *`;
  const deleted = result[0] as any;

  if (!deleted) {
    return NextResponse.json(
      { success: false, message: 'Company not found' },
      { status: 404 }
    );
  }

  const company: Company = {
    id: String(deleted.id),
    name: deleted.name,
    email: deleted.email ?? null,
    phone: deleted.phone ?? null,
    status: deleted.status === 'active' ? 'active' : 'inactive',
    created_at: deleted.created_at,
  };

  return NextResponse.json({
    success: true,
    message: 'Company deleted successfully',
    data: company,
  });
}
