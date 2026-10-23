import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, runAudited } from "@/lib/rbac";
import { resolveMda, managesMda, mdaIdOf } from "@/lib/organisation";
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
    const mdaParam = searchParams.get('company_id') || searchParams.get('mda_id');
    const mdaFilter = mdaParam && Number.isInteger(Number(mdaParam)) ? Number(mdaParam) : null;

    if (id) {
      const result = await sql`
        SELECT l.*, c.name AS company_name
        FROM locations l
        LEFT JOIN companies c
          ON c.id = l.company_id OR (l.company_id IS NULL AND TRIM(c.company_code) = TRIM(l.company_code))
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
        ON c.id = l.company_id OR (l.company_id IS NULL AND TRIM(c.company_code) = TRIM(l.company_code))
      WHERE (${mdaFilter}::int IS NULL OR l.company_id = ${mdaFilter})
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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as CreateLocationBody;
    const { name, company_code, address, city, state, country, status } = body;

    if (!name) {
      return NextResponse.json({ success: false, message: 'Location name is required' }, { status: 400 });
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
      INSERT INTO locations
        (company_id, company_code, name, address, city, state, country, status, created_at)
      VALUES
        (${mda.company.id}, ${mda.company.company_code}, ${name}, ${address ?? null}, ${city ?? null}, ${state ?? null}, ${country ?? null}, ${status ?? 'active'}, NOW())
      RETURNING *
    `;
    const location = result.at(0) as Location | undefined;

    if (!location) {
      return NextResponse.json({ success: false, message: 'Failed to create location' }, { status: 500 });
    }

    await runAudited(req, auth.ctx, { action: "organization.location.created", targetType: "organization.location", details: {} }, []);

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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as UpdateLocationBody;
    const { id, name, address, city, state, country, status } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Location ID is required' }, { status: 400 });
    }

    const owner = await sql`SELECT * FROM locations WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return NextResponse.json({ success: false, message: 'This record belongs to an MDA outside your scope' }, { status: 403 });
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

    await runAudited(req, auth.ctx, { action: "organization.location.updated", targetType: "organization.location", details: {} }, []);

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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Location ID is required' }, { status: 400 });
    }

    const owner = await sql`SELECT * FROM locations WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return NextResponse.json({ success: false, message: 'This record belongs to an MDA outside your scope' }, { status: 403 });
    }

    const result = await sql`DELETE FROM locations WHERE id = ${id} RETURNING *`;
    const location = result.at(0) as Location | undefined;

    if (!location) {
      return NextResponse.json({ success: false, message: 'Location not found' }, { status: 404 });
    }

    await runAudited(req, auth.ctx, { action: "organization.location.deleted", targetType: "organization.location", details: {} }, []);

    return NextResponse.json({ success: true, message: 'Location deleted successfully', data: location });

  } catch (error) {
    if ((error as any)?.code === '23503') {
      return NextResponse.json({ success: false, message: 'This record is still in use elsewhere (for example by performance records), so it cannot be deleted. Set it to inactive instead.' }, { status: 409 });
    }
    console.error('Location DELETE error:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete location' }, { status: 500 });
  }
}