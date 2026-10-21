import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { CATEGORIES, ALWAYS_IN_APP } from "@/lib/employee-notifications";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function preferences(employeeId: string) {
  const rows = await db`
    SELECT category, in_app, email FROM employee_notification_preferences WHERE employee_id = ${employeeId}
  `;
  const saved = new Map(rows.map((r: any) => [r.category, r]));
  // Categories never saved use the defaults: in the app yes, by email no
  return CATEGORIES.map((category) => ({
    category,
    in_app: ALWAYS_IN_APP.includes(category) ? true : saved.get(category)?.in_app ?? true,
    email: saved.get(category)?.email ?? false,
    locked: ALWAYS_IN_APP.includes(category),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    return withCors(req, { success: true, data: await preferences(auth.ctx.employee.id) });
  } catch (error) {
    console.error("NOTIFICATION PREFERENCES ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your preferences" }, 500);
  }
}

// Body: { preferences: [{ category, in_app?, email? }] }
export async function PUT(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as { preferences?: unknown };
    if (!Array.isArray(body.preferences) || body.preferences.length === 0) {
      return withCors(req, { success: false, error: "preferences must be a list" }, 400);
    }

    const current = new Map((await preferences(employee.id)).map((p) => [p.category, p]));
    const statements = [];
    for (const raw of body.preferences as any[]) {
      const category = raw?.category;
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        return withCors(req, { success: false, error: `category must be one of: ${CATEGORIES.join(", ")}` }, 400);
      }
      if ((raw.in_app !== undefined && typeof raw.in_app !== "boolean") || (raw.email !== undefined && typeof raw.email !== "boolean")) {
        return withCors(req, { success: false, error: "in_app and email must be true or false" }, 400);
      }
      if (ALWAYS_IN_APP.includes(category) && raw.in_app === false) {
        return withCors(req, { success: false, error: `${category} notifications cannot be switched off in the app` }, 400);
      }
      const now = current.get(category)!;
      statements.push(db`
        INSERT INTO employee_notification_preferences (employee_id, category, in_app, email)
        VALUES (${employee.id}, ${category}, ${raw.in_app ?? now.in_app}, ${raw.email ?? now.email})
        ON CONFLICT (employee_id, category) DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email, updated_at = NOW()
      `);
    }
    await db.transaction(statements);

    return withCors(req, { success: true, message: "Preferences saved", data: await preferences(employee.id) });
  } catch (error) {
    console.error("NOTIFICATION PREFERENCES SAVE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to save your preferences" }, 500);
  }
}
