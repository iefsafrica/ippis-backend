import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?unread=true  Published HR announcements for staff, with whether this employee has read each
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const unreadOnly = new URL(req.url).searchParams.get("unread") === "true";
    const rows = await db`
      SELECT a.id, a.title, a.content, a.publish_date, a.expiry_date, a.created_at,
             (r.employee_id IS NOT NULL) AS is_read, r.read_at
      FROM announcements a
      LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.employee_id = ${auth.ctx.employee.id}
      WHERE LOWER(COALESCE(a.status, '')) = 'published'
        AND LOWER(COALESCE(a.audience, 'all')) IN ('all', 'employees', 'employee', 'staff', 'all staff')
        AND (a.publish_date IS NULL OR a.publish_date <= NOW())
        AND (a.expiry_date IS NULL OR a.expiry_date >= NOW())
        AND (${unreadOnly} = FALSE OR r.employee_id IS NULL)
      ORDER BY COALESCE(a.publish_date, a.created_at) DESC
      LIMIT 100
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("EMPLOYEE ANNOUNCEMENTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load announcements" }, 500);
  }
}

// Body: { id } or { ids: [..] }  Marks announcements as read
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { id?: unknown; ids?: unknown };
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(Number);
    if (ids.length === 0 || ids.length > 200 || !ids.every((i) => Number.isInteger(i) && i > 0)) {
      return withCors(req, { success: false, error: "send id or ids" }, 400);
    }

    const rows = await db`
      INSERT INTO announcement_reads (announcement_id, employee_id)
      SELECT a.id, ${auth.ctx.employee.id} FROM announcements a WHERE a.id = ANY(${ids})
      ON CONFLICT DO NOTHING
      RETURNING announcement_id
    `;
    return withCors(req, { success: true, data: { marked: rows.length } });
  } catch (error) {
    console.error("EMPLOYEE ANNOUNCEMENT READ ERROR:", error);
    return withCors(req, { success: false, error: "Failed to mark the announcement as read" }, 500);
  }
}
