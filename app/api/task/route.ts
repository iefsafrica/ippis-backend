import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, OUT_OF_SCOPE } from "@/lib/module-scope";
import { employeeInScope } from "@/lib/mda-scope";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

// ---------------------------
// Type definition for Task
// ---------------------------
type TaskPayload = {
  id?: number;
  task_code?: string;
  name?: string;
  project_id?: number;
  assigned_to?: string; // matches employees.id type
  due_date?: string;
  status?: string;
  progress?: number;
  priority?: string;
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
// Helper: format date fields
// ---------------------------
function formatDateFields(rows: any[]) {
  return rows.map((r) => {
    if (r.due_date) r.dueDate = new Date(r.due_date).toISOString();
    if (r.created_at) r.createdAt = new Date(r.created_at).toISOString();
    if (r.updated_at) r.updatedAt = new Date(r.updated_at).toISOString();
    return r;
  });
}

// ---------------------------
// OPTIONS (CORS Preflight)
// ---------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------------------
// CREATE (POST) endpoint
// Auto-generates task_code like TSK-001
// ---------------------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as TaskPayload;

    if (!body.name || !body.project_id || !body.assigned_to) {
      return withCors(req, { success: false, error: "Missing required fields" }, 400);
    }

    // A task belongs to its project: the project must be inside the caller's scope
    const project = await sql`SELECT id, company_id, department_id FROM projects WHERE id = ${body.project_id}`;
    if (!canChange(auth.ctx, "projects.records.manage", project[0])) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    // Check employee exists
    const employee = await sql`SELECT id FROM employees WHERE id = ${body.assigned_to}`;
    if (!employee.length) {
      return withCors(req, { success: false, error: "Assigned employee not found" }, 404);
    }
    if (project[0]!.company_id != null && !(await employeeInScope(auth.ctx, "projects.records.manage", body.assigned_to))) {
      return withCors(req, { success: false, error: "The task can only be assigned to an employee inside your organisational scope" }, 400);
    }

    // Auto-generate task_code like TSK-001
    const lastTask = await sql`SELECT task_code FROM tasks ORDER BY id DESC LIMIT 1`;
    let newTaskCode = "TSK-001";
    if (lastTask.length && lastTask[0]?.task_code) {
      const lastNumber = parseInt(lastTask[0].task_code.replace("TSK-", ""), 10);
      const nextNumber = lastNumber + 1;
      newTaskCode = `TSK-${nextNumber.toString().padStart(3, "0")}`;
    }

    const result = await sql`
      INSERT INTO tasks (
        task_code,
        name,
        project_id,
        assigned_to,
        due_date,
        status,
        progress,
        priority
      )
      VALUES (
        ${newTaskCode},
        ${body.name},
        ${body.project_id},
        ${body.assigned_to},
        ${body.due_date},
        ${body.status || "pending"},
        ${body.progress || 0},
        ${body.priority || "Medium"}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "projects.task.created", targetType: "projects.task", details: {} }, []);

    return withCors(req, { success: true, message: "Task created successfully", data: result?.[0] ?? null });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "POST failed" }, 500);
  }
}

// ---------------------------
// READ (GET) endpoint
// Supports pagination and optional id filter
// ---------------------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.view");
    if (!auth.ok) return auth.response;

    const exists = await tableExists("tasks");
    if (!exists) return withCors(req, { success: false, error: "Tasks table does not exist" }, 404);

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const idFilter = searchParams.get("id");
    // Only the tasks of projects in the caller's MDA or department
    const sc = moduleScope(auth.ctx, "projects.records.view");

    let rows;
    if (idFilter) {
      rows = await sql`
        SELECT t.*, p.name AS project_name, e.name AS assigned_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN employees e ON t.assigned_to = e.id
        WHERE t.id = ${idFilter}
          AND (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))
      `;
      if (!rows.length) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    } else {
      rows = await sql`
        SELECT t.*, p.name AS project_name, e.name AS assigned_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN employees e ON t.assigned_to = e.id
        WHERE (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const countResult = await sql`SELECT COUNT(*) AS total FROM tasks t JOIN projects p ON p.id = t.project_id WHERE (${sc.all}::boolean OR p.company_id = ANY(${sc.companyIds}::int[]) OR p.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND p.company_id IS NULL))`;
    const total = Number(countResult?.[0]?.total ?? 0);

    return withCors(req, {
      success: true,
      data: {
        tasks: formatDateFields(rows),
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
    const auth = await requirePermission(req, "projects.records.manage");
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as TaskPayload;
    if (!body.id) return withCors(req, { success: false, error: "ID is required" }, 400);

    // The task's project, and any project it moves to, must be inside the caller's scope
    const [current] = await sql`SELECT p.company_id, p.department_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${body.id}`;
    if (!canChange(auth.ctx, "projects.records.manage", current)) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    if (body.project_id) {
      const project = await sql`SELECT id, company_id, department_id FROM projects WHERE id = ${body.project_id}`;
      if (!canChange(auth.ctx, "projects.records.manage", project[0])) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    if (body.assigned_to) {
      const employee = await sql`SELECT id FROM employees WHERE id = ${body.assigned_to}`;
      if (!employee.length) return withCors(req, { success: false, error: "Assigned employee not found" }, 404);
    }

    const result = await sql`
      UPDATE tasks SET
        name = COALESCE(${body.name}, name),
        project_id = COALESCE(${body.project_id}, project_id),
        assigned_to = COALESCE(${body.assigned_to}, assigned_to),
        due_date = COALESCE(${body.due_date}, due_date),
        status = COALESCE(${body.status}, status),
        progress = COALESCE(${body.progress}, progress),
        priority = COALESCE(${body.priority}, priority)
      WHERE id = ${body.id}
      RETURNING *
    `;

    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404);
    await runAudited(req, auth.ctx, { action: "projects.task.updated", targetType: "projects.task", details: {} }, []);

    return withCors(req, { success: true, message: "Task updated successfully", data: result[0] });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "PUT failed" }, 500);
  }
}

// ---------------------------
// DELETE endpoint
// ---------------------------
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "projects.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return withCors(req, { success: false, error: "ID required" }, 400);

    const [current] = await sql`SELECT p.company_id, p.department_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${id}`;
    if (!canChange(auth.ctx, "projects.records.manage", current)) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    const result = await sql`DELETE FROM tasks WHERE id = ${id} RETURNING *`;
    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404);

    await runAudited(req, auth.ctx, { action: "projects.task.deleted", targetType: "projects.task", details: {} }, []);

    return withCors(req, { success: true, message: "Task deleted successfully" });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "DELETE failed" }, 500);
  }
}