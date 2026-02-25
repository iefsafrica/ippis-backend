import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Types
// -------------------------
type CompanyPolicy = {
  id: number;
  company_code: string;
  title: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  publish_date: string | null;
  expiry_date: string | null;
  created_at: string;
  company_name?: string;
};

type CreateCompanyPolicyBody = {
  company_code: string;
  title: string;
  content: string;
  status?: 'draft' | 'published' | 'archived';
  publish_date?: string;
  expiry_date?: string;
};

type UpdateCompanyPolicyBody = {
  id: number;
  title?: string;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  publish_date?: string;
  expiry_date?: string;
};

// =========================
// GET: list all OR get by id
// =========================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const result = await sql`
        SELECT p.*, c.name AS company_name
        FROM company_policies p
        LEFT JOIN companies c
          ON p.company_code = c.company_code
        WHERE p.id = ${id}
      `;
      const policy = result.at(0);

      if (!policy) {
        return NextResponse.json({ success: false, message: 'Company policy not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, message: 'Policy retrieved successfully', data: policy });
    }

    const allPolicies = await sql`
      SELECT p.*, c.name AS company_name
      FROM company_policies p
      LEFT JOIN companies c
        ON p.company_code = c.company_code
      ORDER BY p.created_at DESC
    `;

    return NextResponse.json({ success: true, message: 'Policies retrieved successfully', data: allPolicies });

  } catch (error) {
    console.error('CompanyPolicy GET error:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch policies' }, { status: 500 });
  }
}

// =========================
// POST: create policy
// =========================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateCompanyPolicyBody;
    const { company_code, title, content, status, publish_date, expiry_date } = body;

    if (!company_code || !title || !content) {
      return NextResponse.json({ success: false, message: 'company_code, title, and content are required' }, { status: 400 });
    }

    const company = await sql`SELECT company_code FROM companies WHERE TRIM(company_code) = TRIM(${company_code})`;
    if (!company.length) {
      return NextResponse.json({ success: false, message: 'Invalid company_code provided' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO company_policies
        (company_code, title, content, status, publish_date, expiry_date, created_at)
      VALUES
        (${company_code}, ${title}, ${content}, ${status ?? 'draft'}, ${publish_date ?? null}, ${expiry_date ?? null}, NOW())
      RETURNING *
    `;

    return NextResponse.json({ success: true, message: 'Company policy created successfully', data: result.at(0) });

  } catch (error) {
    console.error('CompanyPolicy POST error:', error);
    return NextResponse.json({ success: false, message: 'Failed to create company policy' }, { status: 500 });
  }
}

// =========================
// PUT: update policy
// =========================
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateCompanyPolicyBody;
    const { id, title, content, status, publish_date, expiry_date } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Policy ID is required' }, { status: 400 });
    }

    const result = await sql`
      UPDATE company_policies
      SET
        title = COALESCE(${title ?? null}, title),
        content = COALESCE(${content ?? null}, content),
        status = COALESCE(${status ?? null}, status),
        publish_date = COALESCE(${publish_date ?? null}, publish_date),
        expiry_date = COALESCE(${expiry_date ?? null}, expiry_date)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return NextResponse.json({ success: false, message: 'Company policy not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Policy updated successfully', data: result.at(0) });

  } catch (error) {
    console.error('CompanyPolicy PUT error:', error);
    return NextResponse.json({ success: false, message: 'Failed to update policy' }, { status: 500 });
  }
}

// =========================
// DELETE: remove policy
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Policy ID is required' }, { status: 400 });
    }

    const result = await sql`DELETE FROM company_policies WHERE id = ${id} RETURNING *`;
    if (!result.length) {
      return NextResponse.json({ success: false, message: 'Company policy not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Policy deleted successfully', data: result.at(0) });

  } catch (error) {
    console.error('CompanyPolicy DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete policy' }, { status: 500 });
  }
}