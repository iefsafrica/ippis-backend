import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, runAudited } from "@/lib/rbac";
import { managesMda } from "@/lib/organisation";
import { referencesToDepartment, describe } from "@/lib/org-references";
import { withCors, handleOptions } from "@/lib/cors";
import { neon } from '@neondatabase/serverless';


const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Department Type
// -------------------------
type Department = {
  id: string;
  company_id: string;
  name: string;
  status: 'active' | 'inactive';
  created_at: string;
};

type CreateDepartmentBody = {
  name: string;
  // The MDA the department belongs to (companies.id); mda_id is accepted as an alias
  company_id?: string | number;
  mda_id?: string | number;
  status?: 'active' | 'inactive';
};

type UpdateDepartmentBody = {
  id: string | number;
  name?: string;
  status?: 'active' | 'inactive';
};

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// =========================
// GET: List all OR Get by ID
// =========================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const result = await sql`
        SELECT * FROM departments WHERE id = ${id}
      `;

      const department = result.at(0);

      if (!department) {
        return withCors(req, { success: false, message: 'Department not found' }, 404);
      }

      return withCors(req, {
        success: true,
        data: {
          id: String(department.id),
          company_id: String(department.company_id),
          name: department.name,
          status: department.status,
          created_at: department.created_at,
        },
      });
    }

    const companyIdParam = searchParams.get('company_id') || searchParams.get('mda_id');
    const companyId = companyIdParam && !isNaN(Number(companyIdParam)) ? Number(companyIdParam) : null;

    const result = await sql`
      SELECT * FROM departments
      WHERE (${companyId}::int IS NULL OR company_id = ${companyId})
      ORDER BY name ASC, created_at DESC
    `;

    const departments: Department[] = result.map((row) => ({
      id: String(row.id),
      company_id: String(row.company_id),
      name: row.name,
      status: row.status,
      created_at: row.created_at,
    }));

    return withCors(req, { success: true, data: departments });

  } catch (error) {
    console.error('Department GET error:', error);
    return withCors(req, { success: false, message: 'Something went wrong' }, 500);
  }
}

// =========================
// POST: Create Department
// =========================
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as CreateDepartmentBody;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const status = body.status;
    const companyId = Number(body.company_id ?? body.mda_id);

    if (!name) {
      return withCors(req, { success: false, message: 'Department name is required' }, 400);
    }
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return withCors(req, { success: false, message: 'company_id (the MDA this department belongs to) is required' }, 400);
    }

    // The department goes under the MDA that was asked for, never a default one
    const companyResult = await sql`SELECT id, name, status FROM companies WHERE id = ${companyId}`;
    const company = companyResult.at(0);
    if (!company) {
      return withCors(req, { success: false, message: 'MDA not found' }, 404);
    }
    if (String(company.status ?? 'active').toLowerCase() !== 'active') {
      return withCors(req, { success: false, message: `${company.name} is inactive; reactivate it before adding departments` }, 409);
    }
    if (!managesMda(auth.ctx, companyId)) {
      return withCors(req, { success: false, message: 'You can only add departments to MDAs within your scope' }, 403);
    }

    const duplicate = await sql`
      SELECT id FROM departments WHERE company_id = ${companyId} AND LOWER(TRIM(name)) = LOWER(${name}) LIMIT 1
    `;
    if (duplicate.at(0)) {
      return withCors(req, { success: false, message: `${company.name} already has a department called '${name}'` }, 409);
    }

    const result = await sql`
      INSERT INTO departments (company_id, name, status, created_at)
      VALUES (${companyId}, ${name}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;

    const department = result.at(0);

    if (!department) {
      return withCors(req, { success: false, message: 'Failed to create department' }, 500);
    }

    await runAudited(req, auth.ctx, {
      action: "organization.department.created",
      targetType: "organization.department",
      targetId: department.id,
      details: { name, company_id: companyId, mda: company.name },
    }, []);

    return withCors(req, {
      success: true,
      data: {
        id: String(department.id),
        company_id: String(department.company_id),
        name: department.name,
        status: department.status,
        created_at: department.created_at,
      },
    });

  } catch (error) {
    console.error('Department POST error:', error);
    return withCors(req, { success: false, message: 'Failed to create department' }, 500);
  }
}

// =========================
// PUT: Update Department
// =========================
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as UpdateDepartmentBody;
    const { id, status } = body;
    const name = typeof body.name === "string" ? body.name.trim() : undefined;

    if (!id) {
      return withCors(req, { success: false, message: 'Department ID is required' }, 400);
    }

    const existingRows = await sql`SELECT id, company_id, name FROM departments WHERE id = ${id}`;
    const existing = existingRows.at(0);
    if (!existing) {
      return withCors(req, { success: false, message: 'Department not found' }, 404);
    }
    if (!managesMda(auth.ctx, Number(existing.company_id))) {
      return withCors(req, { success: false, message: 'This department belongs to an MDA outside your scope' }, 403);
    }
    if (name) {
      const duplicate = await sql`
        SELECT id FROM departments
        WHERE company_id = ${existing.company_id} AND LOWER(TRIM(name)) = LOWER(${name}) AND id <> ${id}
        LIMIT 1
      `;
      if (duplicate.at(0)) {
        return withCors(req, { success: false, message: `This MDA already has a department called '${name}'` }, 409);
      }
    }

    const result = await sql`
      UPDATE departments
      SET
        name = COALESCE(${name ?? null}, name),
        status = COALESCE(${status ?? null}, status)
      WHERE id = ${id}
      RETURNING *
    `;

    const department = result.at(0);

    if (!department) {
      return withCors(req, { success: false, message: 'Department not found' }, 404);
    }

    await runAudited(req, auth.ctx, {
      action: "organization.department.updated",
      targetType: "organization.department",
      targetId: department.id,
      details: { from: existing.name, name: department.name, status: department.status },
    }, []);

    return withCors(req, {
      success: true,
      data: {
        id: String(department.id),
        company_id: String(department.company_id),
        name: department.name,
        status: department.status,
        created_at: department.created_at,
      },
    });

  } catch (error) {
    console.error('Department PUT error:', error);
    return withCors(req, { success: false, message: 'Failed to update department' }, 500);
  }
}

// =========================
// DELETE: Delete Department
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return withCors(req, { success: false, message: 'Department ID is required' }, 400);
    }

    const existingRows = await sql`SELECT id, company_id, name FROM departments WHERE id = ${id}`;
    const existing = existingRows.at(0);
    if (!existing) {
      return withCors(req, { success: false, message: 'Department not found' }, 404);
    }
    if (!managesMda(auth.ctx, Number(existing.company_id))) {
      return withCors(req, { success: false, message: 'This department belongs to an MDA outside your scope' }, 403);
    }

    // Deleting would cascade to people's role assignments and performance records
    const references = await referencesToDepartment(Number(existing.id));
    if (references.length > 0) {
      return withCors(req, {
        success: false,
        message: `'${existing.name}' is still in use (${describe(references)}). Move or remove those first, or set the department to inactive instead.`,
        references,
      }, 409);
    }

    const result = await sql`
      DELETE FROM departments WHERE id = ${id}
      RETURNING *
    `;

    const department = result.at(0);

    if (!department) {
      return withCors(req, { success: false, message: 'Department not found' }, 404);
    }

    await runAudited(req, auth.ctx, {
      action: "organization.department.deleted",
      targetType: "organization.department",
      targetId: department.id,
      details: { name: department.name, company_id: department.company_id },
    }, []);

    return withCors(req, {
      success: true,
      message: 'Department deleted successfully',
      data: {
        id: String(department.id),
        company_id: String(department.company_id),
        name: department.name,
        status: department.status,
        created_at: department.created_at,
      },
    });

  } catch (error) {
    console.error('Department DELETE error:', error);
    return withCors(req, { success: false, message: 'Failed to delete department' }, 500);
  }
}
