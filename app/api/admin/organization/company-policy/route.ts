import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, runAudited } from "@/lib/rbac";
import { resolveMda, managesMda, mdaIdOf } from "@/lib/organisation";
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
    const auth = await requirePermission(req, "organization.structure.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const mdaParam = searchParams.get('company_id') || searchParams.get('mda_id');
    const mdaFilter = mdaParam && Number.isInteger(Number(mdaParam)) ? Number(mdaParam) : null;

    if (id) {
      const result = await sql`
        SELECT p.*, c.name AS company_name
        FROM company_policies p
        LEFT JOIN companies c
          ON c.id = p.company_id OR (p.company_id IS NULL AND TRIM(c.company_code) = TRIM(p.company_code))
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
        ON c.id = p.company_id OR (p.company_id IS NULL AND TRIM(c.company_code) = TRIM(p.company_code))
      WHERE (${mdaFilter}::int IS NULL OR p.company_id = ${mdaFilter})
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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as CreateCompanyPolicyBody;
    const { company_code, title, content, status, publish_date, expiry_date } = body;

    if (!title || !content) {
      return NextResponse.json({ success: false, message: 'title and content are required' }, { status: 400 });
    }

    // The MDA, by company_id or company_code; stored by both
    const mda = await resolveMda(body as any);
    if ("error" in mda) {
      return NextResponse.json({ success: false, message: mda.error }, { status: mda.status });
    }
    if (!managesMda(auth.ctx, mda.company.id)) {
      return NextResponse.json({ success: false, message: 'This MDA is outside your scope' }, { status: 403 });
    }

    const result = await sql`
      INSERT INTO company_policies
        (company_id, company_code, title, content, status, publish_date, expiry_date, created_at)
      VALUES
        (${mda.company.id}, ${mda.company.company_code}, ${title}, ${content}, ${status ?? 'draft'}, ${publish_date ?? null}, ${expiry_date ?? null}, NOW())
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "organization.policy.created", targetType: "organization.policy", details: {} }, []);

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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as UpdateCompanyPolicyBody;
    const { id, title, content, status, publish_date, expiry_date } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Policy ID is required' }, { status: 400 });
    }

    const owner = await sql`SELECT * FROM company_policies WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return NextResponse.json({ success: false, message: 'This record belongs to an MDA outside your scope' }, { status: 403 });
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

    await runAudited(req, auth.ctx, { action: "organization.policy.updated", targetType: "organization.policy", details: {} }, []);

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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Policy ID is required' }, { status: 400 });
    }

    const owner = await sql`SELECT * FROM company_policies WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return NextResponse.json({ success: false, message: 'This record belongs to an MDA outside your scope' }, { status: 403 });
    }

    const result = await sql`DELETE FROM company_policies WHERE id = ${id} RETURNING *`;
    if (!result.length) {
      return NextResponse.json({ success: false, message: 'Company policy not found' }, { status: 404 });
    }

    await runAudited(req, auth.ctx, { action: "organization.policy.deleted", targetType: "organization.policy", details: {} }, []);

    return NextResponse.json({ success: true, message: 'Policy deleted successfully', data: result.at(0) });

  } catch (error) {
    if ((error as any)?.code === '23503') {
      return NextResponse.json({ success: false, message: 'This record is still in use elsewhere (for example by performance records), so it cannot be deleted. Set it to inactive instead.' }, { status: 409 });
    }
    console.error('CompanyPolicy DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete policy' }, { status: 500 });
  }
}