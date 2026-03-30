import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

// ---------------------------
// Type definition for Client
// ---------------------------
type ClientPayload = {
  id?: number;
  client_code?: string;
  name?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  status?: string;
};

// ---------------------------
// Helper: check if table exists
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
// OPTIONS (CORS Preflight)
// ---------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------------------
// CREATE (POST) endpoint
// Auto-generates client_code like CLT-001
// ---------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ClientPayload;

    if (!body.name || !body.contact_person) {
      return withCors(req, { success: false, error: "Missing required fields" }, 400);
    }

    // Auto-generate client_code
    const lastClient = await sql`SELECT client_code FROM clients ORDER BY id DESC LIMIT 1`;
    let newClientCode = "CLT-001";
    if (lastClient.length && lastClient[0]?.client_code) {
      const lastNumber = parseInt(lastClient[0].client_code.replace("CLT-", ""), 10);
      const nextNumber = lastNumber + 1;
      newClientCode = `CLT-${nextNumber.toString().padStart(3, "0")}`;
    }

    const result = await sql`
      INSERT INTO clients (
        client_code,
        name,
        contact_person,
        email,
        phone,
        status
      )
      VALUES (
        ${newClientCode},
        ${body.name},
        ${body.contact_person},
        ${body.email},
        ${body.phone},
        ${body.status || "Active"}
      )
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Client created successfully", data: result?.[0] ?? null });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "POST failed" }, 500);
  }
}

// ---------------------------
// READ (GET) endpoint
// Supports optional id filter & pagination
// ---------------------------
export async function GET(req: NextRequest) {
  try {
    const exists = await tableExists("clients");
    if (!exists) return withCors(req, { success: false, error: "Clients table does not exist" }, 404);

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const idFilter = searchParams.get("id");

    let rows;
    if (idFilter) {
      rows = await sql`SELECT * FROM clients WHERE id = ${idFilter}`;
    } else {
      rows = await sql`
        SELECT * FROM clients
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const countResult = await sql`SELECT COUNT(*) AS total FROM clients`;
    const total = Number(countResult?.[0]?.total ?? 0);

    return withCors(req, {
      success: true,
      data: {
        clients: rows,
        pagination: idFilter
          ? undefined
          : { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "GET failed" }, 500);
  }
}

// ---------------------------
// UPDATE (PUT) endpoint
// ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as ClientPayload;
    if (!body.id) return withCors(req, { success: false, error: "ID is required" }, 400);

    const result = await sql`
      UPDATE clients SET
        name = COALESCE(${body.name}, name),
        contact_person = COALESCE(${body.contact_person}, contact_person),
        email = COALESCE(${body.email}, email),
        phone = COALESCE(${body.phone}, phone),
        status = COALESCE(${body.status}, status)
      WHERE id = ${body.id}
      RETURNING *
    `;

    if (!result.length) return withCors(req, { success: false, error: "Client not found" }, 404);

    return withCors(req, { success: true, message: "Client updated successfully", data: result[0] });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "PUT failed" }, 500);
  }
}

// ---------------------------
// DELETE endpoint
// ---------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return withCors(req, { success: false, error: "ID required" }, 400);

    const result = await sql`DELETE FROM clients WHERE id = ${id} RETURNING *`;
    if (!result.length) return withCors(req, { success: false, error: "Client not found" }, 404);

    return withCors(req, { success: true, message: "Client deleted successfully" });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "DELETE failed" }, 500);
  }
}