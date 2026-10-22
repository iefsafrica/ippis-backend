import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, runAudited, covers } from "@/lib/rbac";
import { referencesToMda, describe } from "@/lib/org-references";
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

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET
// -------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');

  if (idParam) {
    const id = Number(idParam);

    if (isNaN(id)) {
      return withCors(req, { success: false, message: 'Invalid ID' }, 400);
    }

    const result = await sql`
      SELECT * FROM companies WHERE id = ${id}
    `;

    const company = result[0] as Company | undefined;

    if (!company) {
      return withCors(req, { success: false, message: 'Company not found' }, 404);
    }

    return withCors(req, { success: true, data: company });
  }

  const result = await sql`
    SELECT * FROM companies ORDER BY created_at DESC
  `;

  return withCors(req, { success: true, data: result });
}

// -------------------------
// POST
// -------------------------
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "organization.structure.manage");
  if (!auth.ok) return auth.response;
  // A new MDA is outside every MDA-level scope, so creating one needs global scope
  if (!covers(auth.ctx, "organization.structure.manage", { level: "global", companyId: null, departmentId: null })) {
    return withCors(req, { success: false, message: 'Creating an MDA needs organisation rights across all MDAs' }, 403);
  }

  const body = (await req.json().catch(() => ({}))) as CreateCompanyBody;

  const { name, email, phone, status } = body;

  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) {
    return withCors(req, { success: false, message: 'Name is required' }, 400);
  }

  const sameName = await sql`SELECT id FROM companies WHERE LOWER(TRIM(name)) = LOWER(${cleanName}) LIMIT 1`;
  if (sameName.length > 0) {
    return withCors(req, { success: false, message: `An MDA called '${cleanName}' already exists` }, 409);
  }

  // The next code is one above the highest existing "IPPIS-C nnnnn" code.
  // Codes in other formats (the seeded FMF, OHCSF, ...) are ignored, so they
  // can no longer make the numbering restart and collide. If another MDA is
  // created at the same moment and takes the number, try the next one.
  let result: Record<string, any>[] = [];
  for (let attempt = 0; attempt < 5 && result.length === 0; attempt++) {
    const highest = await sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(TRIM(company_code) FROM '^IPPIS-C ([0-9]+)$') AS INTEGER)), 0)::int AS n
      FROM companies
    `;
    const newCompanyCode = `IPPIS-C ${String(Number(highest[0]?.n ?? 0) + 1 + attempt).padStart(5, '0')}`;
    try {
      result = await sql`
        INSERT INTO companies (company_code, name, email, phone, status, created_at)
        VALUES (
          ${newCompanyCode},
          ${cleanName},
          ${email ?? null},
          ${phone ?? null},
          ${status ?? 'active'},
          NOW()
        )
        RETURNING *
      `;
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
    }
  }

  const inserted = result[0] as Company | undefined;

  if (!inserted) {
    return withCors(req, { success: false, message: 'Failed to create company' }, 500);
  }

  await runAudited(req, auth.ctx, {
    action: "organization.company.created",
    targetType: "organization.company",
    targetId: inserted.id,
    details: { name: inserted.name, company_code: inserted.company_code },
  }, []);

  return withCors(req, { success: true, data: inserted });
}

// -------------------------
// PUT
// -------------------------
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "organization.structure.manage");
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as UpdateCompanyBody;

  const { id, name, email, phone, status } = body;

  if (!id || typeof id !== 'number') {
    return withCors(req, { success: false, message: 'Valid company ID is required' }, 400);
  }
  if (!covers(auth.ctx, "organization.structure.manage", { level: "mda", companyId: id, departmentId: null })) {
    return withCors(req, { success: false, message: 'This MDA is outside your scope' }, 403);
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
    return withCors(req, { success: false, message: 'Company not found' }, 404);
  }

  await runAudited(req, auth.ctx, {
    action: "organization.company.updated",
    targetType: "organization.company",
    targetId: updated.id,
    details: { name: updated.name, status: updated.status },
  }, []);

  return withCors(req, { success: true, data: updated });
}

// -------------------------
// DELETE
// -------------------------
export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "organization.structure.manage");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return withCors(req, { success: false, message: 'Company ID is required' }, 400);
  }

  const id = Number(idParam);

  if (isNaN(id)) {
    return withCors(req, { success: false, message: 'Invalid ID' }, 400);
  }

  if (!covers(auth.ctx, "organization.structure.manage", { level: "mda", companyId: id, departmentId: null })) {
    return withCors(req, { success: false, message: 'This MDA is outside your scope' }, 403);
  }

  const existingRows = await sql`SELECT id, name, company_code FROM companies WHERE id = ${id}`;
  const existing = existingRows[0] as { id: number; name: string; company_code: string | null } | undefined;
  if (!existing) {
    return withCors(req, { success: false, message: 'Company not found' }, 404);
  }

  // The database would cascade the delete to everything below and silently
  // remove people's role assignments, so refuse while anything still uses it
  const references = await referencesToMda(Number(existing.id), existing.company_code);
  if (references.length > 0) {
    return withCors(req, {
      success: false,
      message: `${existing.name} is still in use (${describe(references)}). Move or remove those first, or set the MDA to inactive instead.`,
      references,
    }, 409);
  }

  const result = await sql`
    DELETE FROM companies
    WHERE id = ${id}
    RETURNING *
  `;

  const deleted = result[0] as Company | undefined;

  if (!deleted) {
    return withCors(req, { success: false, message: 'Company not found' }, 404);
  }

  await runAudited(req, auth.ctx, {
    action: "organization.company.deleted",
    targetType: "organization.company",
    targetId: deleted.id,
    details: { name: deleted.name, company_code: deleted.company_code },
  }, []);

  return withCors(req, {
    success: true,
    message: 'Company deleted successfully',
    data: deleted,
  });
}   