import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited, readReason } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.leaves.view");
    if (!auth.ok) return auth.response;

    const rows = await db`SELECT id, code, name, days_per_year, is_active, updated_at FROM leave_types ORDER BY name`;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST LEAVE TYPES ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch leave types" }, 500);
  }
}

// Body: { code, name, days_per_year }
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.leaves.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { code?: unknown; name?: unknown; days_per_year?: unknown; reason?: unknown };
    const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const days = Number(body.days_per_year);
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(code)) {
      return withCors(req, { success: false, error: "code must be 2-50 lowercase letters, digits or underscores" }, 400);
    }
    if (name.length < 2 || name.length > 100) {
      return withCors(req, { success: false, error: "name must be 2 to 100 characters" }, 400);
    }
    if (!Number.isInteger(days) || days < 0 || days > 366) {
      return withCors(req, { success: false, error: "days_per_year must be a whole number from 0 to 366" }, 400);
    }

    try {
      const [created] = await runAudited(
        req,
        auth.ctx,
        { action: "timesheets.leave_type.created", targetType: "leave_type", targetId: code, reason: readReason(body.reason), details: { name, days } },
        [db`INSERT INTO leave_types (code, name, days_per_year) VALUES (${code}, ${name}, ${days}) RETURNING id, code, name, days_per_year, is_active`]
      );
      return withCors(req, { success: true, data: created?.[0] }, 201);
    } catch (error: any) {
      if (error?.code === "23505") return withCors(req, { success: false, error: "A leave type with this code already exists" }, 409);
      throw error;
    }
  } catch (error) {
    console.error("CREATE LEAVE TYPE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to create the leave type" }, 500);
  }
}

// Body: { id, name?, days_per_year?, is_active?, reason? }
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "timesheets.leaves.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; name?: unknown; days_per_year?: unknown; is_active?: unknown; reason?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return withCors(req, { success: false, error: "id is required" }, 400);

    const name = body.name === undefined ? null : typeof body.name === "string" ? body.name.trim() : "";
    const days = body.days_per_year === undefined ? null : Number(body.days_per_year);
    const active = body.is_active === undefined ? null : body.is_active;
    if (name !== null && (name.length < 2 || name.length > 100)) return withCors(req, { success: false, error: "name must be 2 to 100 characters" }, 400);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 366)) return withCors(req, { success: false, error: "days_per_year must be a whole number from 0 to 366" }, 400);
    if (active !== null && typeof active !== "boolean") return withCors(req, { success: false, error: "is_active must be true or false" }, 400);

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: "timesheets.leave_type.updated", targetType: "leave_type", targetId: id, reason: readReason(body.reason), details: { name, days, active } },
      [db`
        UPDATE leave_types
        SET name = COALESCE(${name}, name), days_per_year = COALESCE(${days}, days_per_year),
            is_active = COALESCE(${active}, is_active), updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, code, name, days_per_year, is_active
      `]
    );
    if (!updated?.[0]) return withCors(req, { success: false, error: "Leave type not found" }, 404);
    return withCors(req, { success: true, data: updated[0] });
  } catch (error) {
    console.error("UPDATE LEAVE TYPE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update the leave type" }, 500);
  }
}
