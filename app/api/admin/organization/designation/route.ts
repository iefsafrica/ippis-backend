import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, runAudited } from "@/lib/rbac";
import { resolveMda, managesMda, mdaIdOf } from "@/lib/organisation";
import { neon } from '@neondatabase/serverless';
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Types
// -------------------------
type Designation = {
  id: number;
  company_code: string;
  title: string;
  description: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  company_name?: string;
};

type CreateDesignationBody = {
  company_code: string;
  title: string;
  description?: string;
  status?: 'active' | 'inactive';
};

type UpdateDesignationBody = {
  id: number;
  title?: string;
  description?: string;
  status?: 'active' | 'inactive';
};

// =========================
// GET
// =========================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const mdaParam = searchParams.get('company_id') || searchParams.get('mda_id');
    const mdaFilter = mdaParam && Number.isInteger(Number(mdaParam)) ? Number(mdaParam) : null;

    if (id) {
      const result = await sql`
        SELECT d.*, c.name AS company_name
        FROM designations d
        LEFT JOIN companies c
          ON c.id = d.company_id OR (d.company_id IS NULL AND TRIM(c.company_code) = TRIM(d.company_code))
        WHERE d.id = ${id}
      `;

      if (!result.length) {
        return NextResponse.json({ success: false, message: 'Designation not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: 'Designation retrieved successfully',
        data: result[0]
      });
    }

    const all = await sql`
      SELECT d.*, c.name AS company_name
      FROM designations d
      LEFT JOIN companies c
        ON c.id = d.company_id OR (d.company_id IS NULL AND TRIM(c.company_code) = TRIM(d.company_code))
      WHERE (${mdaFilter}::int IS NULL OR d.company_id = ${mdaFilter})
    ORDER BY d.created_at DESC
    `;

    return NextResponse.json({
      success: true,
      message: 'Designations retrieved successfully',
      data: all
    });

  } catch (error) {
    console.error('Designation GET error:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch designations' }, { status: 500 });
  }
}

// =========================
// POST
// =========================
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as CreateDesignationBody;
    const { company_code, title, description, status } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, message: 'title is required' },
        { status: 400 }
      );
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
      INSERT INTO designations
        (company_id, company_code, title, description, status, created_at)
      VALUES
        (${mda.company.id}, ${mda.company.company_code}, ${title}, ${description ?? null}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "organization.designation.created", targetType: "organization.designation", details: {} }, []);

    return NextResponse.json({
      success: true,
      message: 'Designation created successfully',
      data: result[0]
    });

  } catch (error) {
    console.error('Designation POST error:', error);
    return NextResponse.json({ success: false, message: 'Failed to create designation' }, { status: 500 });
  }
}

// =========================
// PUT
// =========================
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = await req.json() as UpdateDesignationBody;
    const { id, title, description, status } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Designation ID is required' }, { status: 400 });
    }

    const owner = await sql`SELECT * FROM designations WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return NextResponse.json({ success: false, message: 'This record belongs to an MDA outside your scope' }, { status: 403 });
    }

    const result = await sql`
      UPDATE designations
      SET
        title = COALESCE(${title ?? null}, title),
        description = COALESCE(${description ?? null}, description),
        status = COALESCE(${status ?? null}, status)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return NextResponse.json({ success: false, message: 'Designation not found' }, { status: 404 });
    }

    await runAudited(req, auth.ctx, { action: "organization.designation.updated", targetType: "organization.designation", details: {} }, []);

    return NextResponse.json({
      success: true,
      message: 'Designation updated successfully',
      data: result[0]
    });

  } catch (error) {
    console.error('Designation PUT error:', error);
    return NextResponse.json({ success: false, message: 'Failed to update designation' }, { status: 500 });
  }
}

// =========================
// DELETE
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Designation ID is required' }, { status: 400 });
    }

    const owner = await sql`SELECT * FROM designations WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return NextResponse.json({ success: false, message: 'This record belongs to an MDA outside your scope' }, { status: 403 });
    }

    const result = await sql`
      DELETE FROM designations
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return NextResponse.json({ success: false, message: 'Designation not found' }, { status: 404 });
    }

    await runAudited(req, auth.ctx, { action: "organization.designation.deleted", targetType: "organization.designation", details: {} }, []);

    return NextResponse.json({
      success: true,
      message: 'Designation deleted successfully',
      data: result[0]
    });

  } catch (error) {
    if ((error as any)?.code === '23503') {
      return NextResponse.json({ success: false, message: 'This record is still in use elsewhere (for example by performance records), so it cannot be deleted. Set it to inactive instead.' }, { status: 409 });
    }
    console.error('Designation DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete designation' }, { status: 500 });
  }
}