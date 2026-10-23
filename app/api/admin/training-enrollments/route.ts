import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited } from "@/lib/rbac";
import { notifyMany } from "@/lib/employee-notifications";
import { recordScope, employeesOutOfScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ?training_id=  Who is enrolled in a programme
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.view");
    if (!auth.ok) return auth.response;

    const trainingId = Number(new URL(req.url).searchParams.get("training_id"));
    if (!Number.isInteger(trainingId)) return withCors(req, { success: false, error: "training_id is required" }, 400);

    // Only the enrolments of employees inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "training.records.view");
    const rows = await db`
      SELECT en.employee_id, e.name, e.department, en.status, en.enrolled_by, en.enrolled_at
      FROM training_enrollments en JOIN employees e ON e.id = en.employee_id
      WHERE en.training_id = ${trainingId}
        AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY e.name
    `;
    return withCors(req, { success: true, data: rows });
  } catch (error) {
    console.error("LIST TRAINING ENROLLMENTS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch enrolments" }, 500);
  }
}

// Body: { training_id, employee_ids: [..] }  Enrols employees and tells them
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { training_id?: unknown; employee_ids?: unknown };
    const trainingId = Number(body.training_id);
    if (!Number.isInteger(trainingId)) return withCors(req, { success: false, error: "training_id is required" }, 400);
    if (!Array.isArray(body.employee_ids) || body.employee_ids.length === 0 || body.employee_ids.length > 500) {
      return withCors(req, { success: false, error: "employee_ids must list 1 to 500 employees" }, 400);
    }
    const requested = [...new Set(body.employee_ids.map((i) => String(i).trim()).filter(Boolean))];
    // Employees outside the caller's MDA or department (or unknown) are not enrolled
    const refused = new Set(await employeesOutOfScope(auth.ctx, "training.records.manage", requested));
    const ids = requested.filter((i) => !refused.has(i));

    const training = await db`SELECT id, training_title, start_date::date::text AS start_date FROM training_programs WHERE id = ${trainingId}`;
    if (!training[0]) return withCors(req, { success: false, error: "Training programme not found" }, 404);

    const [enrolled] = await runAudited(
      req,
      auth.ctx,
      { action: "training.enrollment.added", targetType: "training", targetId: trainingId, details: { employees: ids } },
      [db`
        INSERT INTO training_enrollments (training_id, employee_id, enrolled_by)
        SELECT ${trainingId}, e.id, ${auth.ctx.user.username} FROM employees e WHERE e.id = ANY(${ids})
        ON CONFLICT (training_id, employee_id) DO UPDATE SET status = 'enrolled'
        RETURNING employee_id
      `]
    );
    const added = (enrolled ?? []).map((r: any) => String(r.employee_id));
    const t = training[0];
    await notifyMany("training", added.map((employeeId: string) => ({
      employeeId,
      title: "You have been enrolled in training",
      message: `"${t.training_title}" starts on ${t.start_date}.`,
      link: "/employee/trainings",
      dedupeKey: `training-enrolled:${trainingId}`,
    })));

    return withCors(req, {
      success: true,
      message: `${added.length} employee(s) enrolled`,
      data: { enrolled: added, notFound: requested.filter((i) => !added.includes(i)) },
    }, 201);
  } catch (error) {
    console.error("ADD TRAINING ENROLLMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to enrol employees" }, 500);
  }
}

// ?training_id=&employee_id=  Withdraws an employee from a programme
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "training.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const trainingId = Number(searchParams.get("training_id"));
    const employeeId = searchParams.get("employee_id");
    if (!Number.isInteger(trainingId) || !employeeId) {
      return withCors(req, { success: false, error: "training_id and employee_id are required" }, 400);
    }
    if (!(await employeeInScope(auth.ctx, "training.records.manage", employeeId))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const [updated] = await runAudited(
      req,
      auth.ctx,
      { action: "training.enrollment.withdrawn", targetType: "training", targetId: trainingId, details: { employee: employeeId } },
      [db`
        UPDATE training_enrollments SET status = 'withdrawn'
        WHERE training_id = ${trainingId} AND employee_id = ${employeeId} AND status <> 'withdrawn'
        RETURNING employee_id
      `]
    );
    if (!updated?.[0]) return withCors(req, { success: false, error: "Enrolment not found" }, 404);
    return withCors(req, { success: true, message: "Employee withdrawn from the programme" });
  } catch (error) {
    console.error("WITHDRAW TRAINING ENROLLMENT ERROR:", error);
    return withCors(req, { success: false, error: "Failed to withdraw the employee" }, 500);
  }
}
