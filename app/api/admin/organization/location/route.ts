import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// Location Type
// -------------------------
type Location = {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: 'active' | 'inactive';
  created_at: string;
};

type CreateLocationBody = {
  name: string;
  company_id?: string; // optional: auto-assign first company if not provided
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  status?: 'active' | 'inactive';
};

type UpdateLocationBody = {
  id: string | number;
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
      const result = await sql`SELECT * FROM locations WHERE id = ${id}`;
      const location = result.at(0) as Location | undefined;

      if (!location) {
        return NextResponse.json({ success: false, message: 'Location not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, data: location });
    }

    const allLocations = await sql`SELECT * FROM locations ORDER BY created_at DESC`;
    const locations: Location[] = allLocations.map((row) => ({
      id: String(row.id),
      company_id: String(row.company_id),
      name: row.name,
      address: row.address,
      city: row.city,
      state: row.state,
      country: row.country,
      status: row.status,
      created_at: row.created_at,
    }));

    return NextResponse.json({ success: true, data: locations });

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
    let { name, company_id, address, city, state, country, status } = body;

    if (!name) {
      return NextResponse.json({ success: false, message: 'Location name is required' }, { status: 400 });
    }

    // Auto-assign first company if company_id not provided
    if (!company_id) {
      const companyResult = await sql`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`;
      const company = companyResult.at(0) as { id: string } | undefined;
      if (!company) {
        return NextResponse.json({ success: false, message: 'No company found. Create company first.' }, { status: 400 });
      }
      company_id = company.id;
    }

    const result = await sql`
      INSERT INTO locations 
        (company_id, name, address, city, state, country, status, created_at)
      VALUES 
        (${company_id}, ${name}, ${address ?? null}, ${city ?? null}, ${state ?? null}, ${country ?? null}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;
    const location = result.at(0) as Location | undefined;

    if (!location) {
      return NextResponse.json({ success: false, message: 'Failed to create location' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: location });

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

    return NextResponse.json({ success: true, data: location });

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
