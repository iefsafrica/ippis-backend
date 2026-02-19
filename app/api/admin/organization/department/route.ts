import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from "../../../../../lib/cors";
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
  status?: 'active' | 'inactive';
};

type UpdateDepartmentBody = {
  id: string | number;
  name?: string;
  status?: 'active' | 'inactive';
};

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
        return NextResponse.json(
          { success: false, message: 'Department not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
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

    const result = await sql`
      SELECT * FROM departments ORDER BY created_at DESC
    `;

    const departments: Department[] = result.map((row) => ({
      id: String(row.id),
      company_id: String(row.company_id),
      name: row.name,
      status: row.status,
      created_at: row.created_at,
    }));

    return NextResponse.json({ success: true, data: departments });

  } catch (error) {
    console.error('Department GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Something went wrong' },
      { status: 500 }
    );
  }
}

// =========================
// POST: Create Department
// =========================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateDepartmentBody;
    const { name, status } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, message: 'Department name is required' },
        { status: 400 }
      );
    }

    // 🔹 Auto get first company
    const companyResult = await sql`
      SELECT id FROM companies ORDER BY created_at ASC LIMIT 1
    `;

    const company = companyResult.at(0);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'No company found. Create a company first.' },
        { status: 400 }
      );
    }

    const result = await sql`
      INSERT INTO departments (company_id, name, status, created_at)
      VALUES (${company.id}, ${name}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;

    const department = result.at(0);

    if (!department) {
      return NextResponse.json(
        { success: false, message: 'Failed to create department' },
        { status: 500 }
      );
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, message: 'Failed to create department' },
      { status: 500 }
    );
  }
}

// =========================
// PUT: Update Department
// =========================
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateDepartmentBody;
    const { id, name, status } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Department ID is required' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { success: false, message: 'Department not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, message: 'Failed to update department' },
      { status: 500 }
    );
  }
}

// =========================
// DELETE: Delete Department
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Department ID is required' },
        { status: 400 }
      );
    }

    const result = await sql`
      DELETE FROM departments WHERE id = ${id}
      RETURNING *
    `;

    const department = result.at(0);

    if (!department) {
      return NextResponse.json(
        { success: false, message: 'Department not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, message: 'Failed to delete department' },
      { status: 500 }
    );
  }
}
