import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

// ---------------------------
// Type definition
// ---------------------------
type TaxPayload = {
  id?: number;
  name?: string;
  rate?: number;
  description?: string;
  status?: string;
};

// ---------------------------
// Helper: check table exists
// ---------------------------
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${tableName}
      )
    `;
    return result?.[0]?.exists ?? false;
  } catch {
    return false;
  }
}

// ---------------------------
// OPTIONS
// ---------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------------------
// CREATE (POST)
// Auto-generate TAX-001
// ---------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TaxPayload;

    if (!body.name || body.rate == null) {
      return withCors(req, { success: false, error: "Missing required fields" }, 400);
    }

    // Generate tax_code
    const last = await sql`SELECT tax_code FROM tax_types ORDER BY id DESC LIMIT 1`;
    let newCode = "TAX-001";

    if (last.length && last[0]?.tax_code) {
      const num = parseInt(last[0].tax_code.replace("TAX-", ""), 10) + 1;
      newCode = `TAX-${num.toString().padStart(3, "0")}`;
    }

    const result = await sql`
      INSERT INTO tax_types (tax_code, name, rate, description, status)
      VALUES (
        ${newCode},
        ${body.name},
        ${body.rate},
        ${body.description},
        ${body.status || "Active"}
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Tax type created successfully",
      data: result?.[0] ?? null,
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message }, 500);
  }
}

// ---------------------------
// READ (GET)
// ---------------------------
export async function GET(req: NextRequest) {
  try {
    const exists = await tableExists("tax_types");
    if (!exists) return withCors(req, { success: false, error: "Table not found" }, 404);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const row = await sql`SELECT * FROM tax_types WHERE id = ${id}`;
      return withCors(req, {
        success: true,
        data: row[0] ?? null,
      });
    }

    const rows = await sql`SELECT * FROM tax_types ORDER BY created_at DESC`;

    return withCors(req, {
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message }, 500);
  }
}

// ---------------------------
// UPDATE (PUT)
// ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as TaxPayload;

    if (!body.id) {
      return withCors(req, { success: false, error: "ID required" }, 400);
    }

    const result = await sql`
      UPDATE tax_types SET
        name = COALESCE(${body.name}, name),
        rate = COALESCE(${body.rate}, rate),
        description = COALESCE(${body.description}, description),
        status = COALESCE(${body.status}, status)
      WHERE id = ${body.id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req, { success: false, error: "Not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Tax type updated successfully",
      data: result[0],
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message }, 500);
  }
}

// ---------------------------
// DELETE
// ---------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, error: "ID required" }, 400);
    }

    const result = await sql`
      DELETE FROM tax_types WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(req, { success: false, error: "Not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "Tax type deleted successfully",
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message }, 500);
  }
}