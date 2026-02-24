import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Location Type
// -------------------------
type Location = {
  id: string;
  company_code: string; // stores company_code like "IPPIS-C 00001"
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  company_name?: string; // optional, joined from companies table
};

type CreateLocationBody = {
  name: string;
  company_code: string; // REQUIRED now
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  status?: 'active' | 'inactive';
};

type UpdateLocationBody = {
  id: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  status?: 'active' | 'inactive';
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
        SELECT l.*, c.name AS company_name
        FROM locations l
        LEFT JOIN companies c
          ON l.company_code = c.company_code
        WHERE l.id = ${id}
      `;
      const location = result.at(0) as Location | undefined;

      if (!location) {
        return NextResponse.json({ success: false, message: 'Location not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, message: 'Location retrieved successfully', data: location });
    }

    const allLocations = await sql`
      SELECT l.*, c.name AS company_name
      FROM locations l
      LEFT JOIN companies c
        ON l.company_code = c.company_code
      ORDER BY l.created_at DESC
    `;

    return NextResponse.json({ success: true, message: 'Locations retrieved successfully', data: allLocations });

  } catch (error) {
    console.error('Location GET error:', error);
    return NextResponse.json({ success: false, message: 'Something went wrong' }, { status: 500 });
  }
}

// =========================
// POST: create location
// =========================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateLocationBody;
    const { name, company_code, address, city, state, country, status } = body;

    if (!name || !company_code) {
      return NextResponse.json({ success: false, message: 'Location name and company_code are required' }, { status: 400 });
    }

    // Verify the company exists
    const companyExists = await sql`
      SELECT company_code
      FROM companies
      WHERE TRIM(company_code) = TRIM(${company_code})
    `;
    if (!companyExists.length) {
      return NextResponse.json({ success: false, message: 'Invalid company_code provided' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO locations
        (company_code, name, address, city, state, country, status, created_at)
      VALUES
        (${company_code}, ${name}, ${address ?? null}, ${city ?? null}, ${state ?? null}, ${country ?? null}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;
    const location = result.at(0) as Location | undefined;

    if (!location) {
      return NextResponse.json({ success: false, message: 'Failed to create location' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Location created successfully', data: location });

  } catch (error) {
    console.error('Location POST error:', error);
    return NextResponse.json({ success: false, message: 'Failed to create location' }, { status: 500 });
  }
}

// =========================
// PUT: update location
// =========================
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateLocationBody;
    const { id, name, address, city, state, country, status } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Location ID is required' }, { status: 400 });
    }

    const result = await sql`
      UPDATE locations
      SET
        name = COALESCE(${name ?? null}, name),
        address = COALESCE(${address ?? null}, address),
        city = COALESCE(${city ?? null}, city),
        state = COALESCE(${state ?? null}, state),
        country = COALESCE(${country ?? null}, country),
        status = COALESCE(${status ?? null}, status)
      WHERE id = ${id}
      RETURNING *
    `;
    const location = result.at(0) as Location | undefined;

    if (!location) {
      return NextResponse.json({ success: false, message: 'Location not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Location updated successfully', data: location });

  } catch (error) {
    console.error('Location PUT error:', error);
    return NextResponse.json({ success: false, message: 'Failed to update location' }, { status: 500 });
  }
}

// =========================
// DELETE: delete location
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Location ID is required' }, { status: 400 });
    }

    const result = await sql`DELETE FROM locations WHERE id = ${id} RETURNING *`;
    const location = result.at(0) as Location | undefined;

    if (!location) {
      return NextResponse.json({ success: false, message: 'Location not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Location deleted successfully', data: location });

  } catch (error) {
    console.error('Location DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete location' }, { status: 500 });
  }
}