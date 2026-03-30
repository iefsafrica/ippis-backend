import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

// ---------------------------
// Type definition for Project
// ---------------------------
type ProjectPayload = {
  id?: number;
  project_code?: string;
  name?: string;
  client?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  progress?: number;
  priority?: string;
  budget?: number;
  manager_id?: string; // matches employees.id
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
    if (r.start_date) r.startDate = new Date(r.start_date).toISOString();
    if (r.end_date) r.endDate = new Date(r.end_date).toISOString();
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
// Auto-generates project_code like PRJ-001
// ---------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ProjectPayload;

    if (!body.name || !body.manager_id) {
      return withCors(
        req,
        { success: false, message: "Missing required fields" },
        400
      );
    }

    // Check if manager exists
    const manager = await sql`SELECT id FROM employees WHERE id = ${body.manager_id}`;
    if (!manager.length) {
      return withCors(
        req,
        { success: false, message: "Manager not found" },
        404
      );
    }

    // Auto-generate project_code like PRJ-001
    const lastProject = await sql`SELECT project_code FROM projects ORDER BY id DESC LIMIT 1`;
    let newProjectCode = "PRJ-001";
    if (lastProject.length && lastProject[0]?.project_code) {
      const lastNumber = parseInt(
        lastProject[0].project_code.replace("PRJ-", ""),
        10
      );
      const nextNumber = lastNumber + 1;
      newProjectCode = `PRJ-${nextNumber.toString().padStart(3, "0")}`;
    }

    const result = await sql`
      INSERT INTO projects (
        project_code,
        name,
        client,
        start_date,
        end_date,
        status,
        progress,
        priority,
        budget,
        manager_id
      )
      VALUES (
        ${newProjectCode},
        ${body.name},
        ${body.client},
        ${body.start_date},
        ${body.end_date},
        ${body.status || "planned"},
        ${body.progress || 0},
        ${body.priority || "Medium"},
        ${body.budget},
        ${body.manager_id}
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Project created successfully",
      data: result?.[0] ?? null,
    });
  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: error?.message || "POST failed",
    }, 500);
  }
}

// ---------------------------
// READ (GET) endpoint
// Supports pagination and optional id filter
// ---------------------------
export async function GET(req: NextRequest) {
  try {
    const exists = await tableExists("projects");
    if (!exists)
      return withCors(req, { success: false, message: "Projects table does not exist" }, 404);

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const idFilter = searchParams.get("id");

    let rows;
    if (idFilter) {
      // Fetch single project by ID
      rows = await sql`
        SELECT p.*, e.name AS manager_name, e.department AS manager_department
        FROM projects p
        JOIN employees e ON p.manager_id = e.id
        WHERE p.id = ${idFilter}
      `;
    } else {
      // Fetch paginated list
      rows = await sql`
        SELECT p.*, e.name AS manager_name, e.department AS manager_department
        FROM projects p
        JOIN employees e ON p.manager_id = e.id
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const countResult = await sql`SELECT COUNT(*) AS total FROM projects`;
    const total = Number(countResult?.[0]?.total ?? 0);

    return withCors(req, {
      success: true,
      message: idFilter
        ? rows.length
          ? "Project retrieved successfully"
          : "Project not found"
        : "Projects retrieved successfully",
      data: {
        projects: formatDateFields(rows),
        pagination: idFilter
          ? undefined
          : { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: error?.message || "GET failed",
    }, 500);
  }
}

// ---------------------------
// UPDATE (PUT) endpoint
// ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as ProjectPayload;
    if (!body.id)
      return withCors(req, { success: false, message: "ID is required" }, 400);

    if (body.manager_id) {
      // Verify manager exists
      const manager = await sql`SELECT id FROM employees WHERE id = ${body.manager_id}`;
      if (!manager.length) {
        return withCors(req, { success: false, message: "Manager not found" }, 404);
      }
    }

    const result = await sql`
      UPDATE projects SET
        name = COALESCE(${body.name}, name),
        client = COALESCE(${body.client}, client),
        start_date = COALESCE(${body.start_date}, start_date),
        end_date = COALESCE(${body.end_date}, end_date),
        status = COALESCE(${body.status}, status),
        progress = COALESCE(${body.progress}, progress),
        priority = COALESCE(${body.priority}, priority),
        budget = COALESCE(${body.budget}, budget),
        manager_id = COALESCE(${body.manager_id}, manager_id)
      WHERE id = ${body.id}
      RETURNING *
    `;

    if (!result.length)
      return withCors(req, { success: false, message: "Project not found" }, 404);

    return withCors(req, {
      success: true,
      message: "Project updated successfully",
      data: result[0],
    });
  } catch (error: any) {
    return withCors(req, { success: false, message: error?.message || "PUT failed" }, 500);
  }
}

// ---------------------------
// DELETE endpoint
// ---------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id)
      return withCors(req, { success: false, message: "ID required" }, 400);

    const result = await sql`DELETE FROM projects WHERE id = ${id} RETURNING *`;
    if (!result.length)
      return withCors(req, { success: false, message: "Project not found" }, 404);

    return withCors(req, {
      success: true,
      message: "Project deleted successfully",
    });
  } catch (error: any) {
    return withCors(req, { success: false, message: error?.message || "DELETE failed" }, 500);
  }
}