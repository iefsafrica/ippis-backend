import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { CATEGORIES, syncReminders, unreadCounts } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?unread=true  ?category=leave|attendance|payroll|task|document|announcement|training|profile|system  ?limit=
// Also creates any due reminders (deadlines, expiring documents, training) first.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const category = searchParams.get("category");
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "30") || 30));
    if (category && !(CATEGORIES as readonly string[]).includes(category)) {
      return withCors(req, { success: false, error: `category must be one of: ${CATEGORIES.join(", ")}` }, 400);
    }

    await syncReminders(employee.id);

    const [rows, counts] = await Promise.all([
      db`
        SELECT id, category, title, message, link, is_read, read_at, created_at
        FROM employee_notifications
        WHERE employee_id = ${employee.id}
          AND (${unreadOnly} = FALSE OR NOT is_read)
          AND (${category}::text IS NULL OR category = ${category})
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      `,
      unreadCounts(employee.id),
    ]);

    return withCors(req, { success: true, data: { notifications: rows, unread: counts } });
  } catch (error) {
    console.error("EMPLOYEE NOTIFICATIONS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your notifications" }, 500);
  }
}

// Body: { ids: [..], read?: true|false } or { all: true, read?: true }
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown; read?: unknown };
    const read = body.read === undefined ? true : body.read;
    if (typeof read !== "boolean") return withCors(req, { success: false, error: "read must be true or false" }, 400);

    let ids: number[] | null = null;
    if (body.all !== true) {
      if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500 || !body.ids.every((i) => Number.isInteger(Number(i)))) {
        return withCors(req, { success: false, error: "send ids (a list of notification ids) or all: true" }, 400);
      }
      ids = body.ids.map(Number);
    }

    const rows = await db`
      UPDATE employee_notifications
      SET is_read = ${read}, read_at = CASE WHEN ${read} THEN NOW() ELSE NULL END
      WHERE employee_id = ${employee.id}
        AND (${ids === null} OR id = ANY(${ids ?? []}))
        AND is_read <> ${read}
      RETURNING id
    `;
    return withCors(req, { success: true, data: { updated: rows.length, unread: await unreadCounts(employee.id) } });
  } catch (error) {
    console.error("EMPLOYEE NOTIFICATIONS UPDATE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update notifications" }, 500);
  }
}
