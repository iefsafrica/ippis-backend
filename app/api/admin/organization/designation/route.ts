import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { withCors, handleOptions } from "../../../../../lib/cors";

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

    if (id) {
      const result = await sql`
        SELECT d.*, c.name AS company_name
        FROM designations d
        LEFT JOIN companies c
          ON d.company_code = c.company_code
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
        ON d.company_code = c.company_code
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
    const body = await req.json() as CreateDesignationBody;
    const { company_code, title, description, status } = body;

    if (!company_code || !title) {
      return NextResponse.json(
        { success: false, message: 'company_code and title are required' },
        { status: 400 }
      );
    }

    // Verify company exists
    const company = await sql`
      SELECT company_code FROM companies
      WHERE TRIM(company_code) = TRIM(${company_code})
    `;

    if (!company.length) {
      return NextResponse.json(
        { success: false, message: 'Invalid company_code provided' },
        { status: 400 }
      );
    }

    const result = await sql`
      INSERT INTO designations
        (company_code, title, description, status, created_at)
      VALUES
        (${company_code}, ${title}, ${description ?? null}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;

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
    const body = await req.json() as UpdateDesignationBody;
    const { id, title, description, status } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Designation ID is required' }, { status: 400 });
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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Designation ID is required' }, { status: 400 });
    }

    const result = await sql`
      DELETE FROM designations
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return NextResponse.json({ success: false, message: 'Designation not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Designation deleted successfully',
      data: result[0]
    });

  } catch (error) {
    console.error('Designation DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete designation' }, { status: 500 });
  }
}