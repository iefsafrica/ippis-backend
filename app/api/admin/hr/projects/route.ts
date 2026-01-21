import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/* -------------------- Types -------------------- */
interface ProjectPayload {
  id?: number;
  project_title: string;
  start_date: string;
  end_date: string;
  project_manager_id: string;  // employee id
  team_member_ids?: string[];  // array of employee ids
  project_description?: string;
  project_status?: string;
  priority?: string;
  budget?: number;
  completion_percentage?: number;
}

interface EmployeeRow {
  employee_key: string;
  employee_name: string;
}

/* -------------------- CORS -------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------- GET -------------------- */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const manager_id = req.nextUrl.searchParams.get("project_manager_id");

    let projects;

    if (id) {
      projects = await sql`SELECT * FROM employee_projects WHERE id = ${id}`;
    } else if (manager_id) {
      projects = await sql`
        SELECT * FROM employee_projects
        WHERE project_manager_id = ${manager_id}
        ORDER BY start_date ASC
      `;
    } else {
      projects = await sql`SELECT * FROM employee_projects ORDER BY start_date ASC`;
    }

    return withCors(req, { success: true, data: projects });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch projects",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- POST -------------------- */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ProjectPayload;
    const {
      project_title,
      start_date,
      end_date,
      project_manager_id,
      team_member_ids = [],
      project_description,
      project_status = "pending",
      priority = "medium",
      budget = 0,
      completion_percentage = 0,
    } = body;

    // ---------- Validate required fields ----------
    if (!project_title || !start_date || !end_date || !project_manager_id) {
      return withCors(
        req,
        { success: false, error: "project_title, start_date, end_date, project_manager_id are required" },
        400
      );
    }

    // ---------- Validate manager ----------
    const managerRow = (await sql`
      SELECT id::text AS employee_key, name AS employee_name
      FROM employees
      WHERE id::text = ${project_manager_id}
    `) as EmployeeRow[];

    if (!managerRow || managerRow.length === 0) {
      return withCors(req, {
        success: false,
        error: "Project manager ID does not exist",
        invalid_employee_id: project_manager_id,
      }, 400);
    }

    // ---------- Validate team members ----------
    if (team_member_ids.length > 0) {
      const existingMembers = (await sql`
        SELECT id::text AS employee_key
        FROM employees
        WHERE id::text = ANY(${team_member_ids})
      `) as EmployeeRow[];

      const existingKeys = existingMembers.map(e => e.employee_key);
      const invalidIds = team_member_ids.filter(id => !existingKeys.includes(id));

      if (invalidIds.length > 0) {
        return withCors(req, {
          success: false,
          error: "Some team member IDs do not exist",
          invalid_employee_ids: invalidIds,
        }, 400);
      }
    }

    // ---------- Insert project ----------
    const result = await sql`
      INSERT INTO employee_projects (
        project_title,
        start_date,
        end_date,
        project_manager_id,
        team_member_ids,
        project_description,
        project_status,
        priority,
        budget,
        completion_percentage,
        created_at,
        updated_at
      )
      VALUES (
        ${project_title},
        ${start_date},
        ${end_date},
        ${project_manager_id},
        ${team_member_ids},
        ${project_description},
        ${project_status},
        ${priority},
        ${budget},
        ${completion_percentage},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Project created successfully", data: result[0] }, 201);
  } catch (error) {
    console.error("Error creating project:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create project",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- PUT -------------------- */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ProjectPayload>;
    const { id, project_manager_id, team_member_ids } = body;

    if (!id) {
      return withCors(req, { success: false, error: "Project id is required" }, 400);
    }

    let managerExists: boolean | undefined;
    if (project_manager_id) {
      const managerRow = (await sql`
        SELECT id::text AS employee_key FROM employees WHERE id::text = ${project_manager_id}
      `) as EmployeeRow[];

      if (!managerRow || managerRow.length === 0) {
        return withCors(req, {
          success: false,
          error: "Project manager ID does not exist",
          invalid_employee_id: project_manager_id,
        }, 400);
      }
      managerExists = true;
    }

    if (team_member_ids && team_member_ids.length > 0) {
      const existingMembers = (await sql`
        SELECT id::text AS employee_key
        FROM employees
        WHERE id::text = ANY(${team_member_ids})
      `) as EmployeeRow[];

      const existingKeys = existingMembers.map(e => e.employee_key);
      const invalidIds = team_member_ids.filter(id => !existingKeys.includes(id));

      if (invalidIds.length > 0) {
        return withCors(req, {
          success: false,
          error: "Some team member IDs do not exist",
          invalid_employee_ids: invalidIds,
        }, 400);
      }
    }

    const updated = await sql`
      UPDATE employee_projects
      SET
        project_title = COALESCE(${body.project_title}, project_title),
        start_date = COALESCE(${body.start_date}, start_date),
        end_date = COALESCE(${body.end_date}, end_date),
        project_manager_id = COALESCE(${project_manager_id}, project_manager_id),
        team_member_ids = COALESCE(${team_member_ids}, team_member_ids),
        project_description = COALESCE(${body.project_description}, project_description),
        project_status = COALESCE(${body.project_status}, project_status),
        priority = COALESCE(${body.priority}, priority),
        budget = COALESCE(${body.budget}, budget),
        completion_percentage = COALESCE(${body.completion_percentage}, completion_percentage),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, { success: true, message: "Project updated successfully", data: updated[0] });
  } catch (error) {
    console.error("Error updating project:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update project",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

/* -------------------- DELETE -------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, error: "Project id is required" }, 400);
    }

    await sql`DELETE FROM employee_projects WHERE id = ${id}`;

    return withCors(req, { success: true, message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    return withCors(req, {
      success: false,
      error: "Failed to delete project",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
