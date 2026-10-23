import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, placementFor, placementOf, parentOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { z } from "zod";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   ZOD SCHEMA (VALIDATION)
------------------------- */
const JobSchema = z.object({
  job_title: z.string().min(1),
  department: z.string().min(1),
  number_of_positions: z.number().int().positive(),
  posted_date: z.string().min(1),
  closing_date: z.string().min(1),
  status: z.enum(["draft", "active", "closed"]),
  location: z.string().min(1),
  job_type: z.enum(["full-time", "part-time", "contract", "internship"]),
  experience: z.string().min(1),
  salary_range: z.string().min(1),
  job_description: z.string().optional(),
  requirements: z.string().min(1),
  responsibilities: z.string().min(1)
});

/* -------------------------
   OPTIONS
------------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   CREATE JOB (POST)
------------------------- */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();

    const body = JobSchema.parse(rawBody);
    // The job post belongs to an MDA inside the caller's scope
    const placed = await placementFor(auth.ctx, "recruitment.records.manage", rawBody as Record<string, unknown>);
    if (!placed.ok) return withCors(req, { success: false, message: placed.error }, placed.status);

    const result = await sql`
      INSERT INTO job_posts (
        job_title,
        department,
        number_of_positions,
        posted_date,
        closing_date,
        status,
        location,
        job_type,
        experience,
        salary_range,
        job_description,
        requirements,
        responsibilities,
        company_id,
        department_id
      )
      VALUES (
        ${body.job_title},
        ${body.department},
        ${body.number_of_positions},
        ${body.posted_date},
        ${body.closing_date},
        ${body.status},
        ${body.location},
        ${body.job_type},
        ${body.experience},
        ${body.salary_range},
        ${body.job_description ?? null},
        ${body.requirements},
        ${body.responsibilities},
        ${placed.placement.companyId},
        ${placed.placement.departmentId}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "recruitment.job.created", targetType: "recruitment.job", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Job created successfully",
      data: result[0]
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: error?.errors ? error.errors[0].message : "Create failed",
      error: error.message
    }, 400);
  }
}

/* -------------------------
   GET JOB(S)
------------------------- */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    // Only the job posts of the caller's MDA or department
    const sc = moduleScope(auth.ctx, "recruitment.records.view");

    /* -------- SINGLE JOB -------- */
    if (id) {
      const result = await sql`
        SELECT * FROM job_posts j WHERE j.id = ${id} AND (${sc.all}::boolean OR j.company_id = ANY(${sc.companyIds}::int[]) OR j.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND j.company_id IS NULL))
      `;

      if (result.length === 0) {
        return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
      }

      return withCors(req, {
        success: true,
        data: result[0]
      });
    }

    /* -------- FILTERED JOBS -------- */
    const jobs = await sql`
      SELECT * FROM job_posts j
      WHERE (${status}::text IS NULL OR j.status = ${status})
        AND (${search ? "%" + search + "%" : null}::text IS NULL OR j.job_title ILIKE ${search ? "%" + search + "%" : null})
        AND (${sc.all}::boolean OR j.company_id = ANY(${sc.companyIds}::int[]) OR j.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND j.company_id IS NULL))
      ORDER BY j.created_at DESC
    `;

    return withCors(req, {
      success: true,
      data: jobs
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: "Fetch failed",
      error: error.message
    }, 500);
  }
}

/* -------------------------
   UPDATE JOB (PUT)
------------------------- */
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Job ID is required" }, 400);
    }

    const rawBody = await req.json();
    const body = JobSchema.parse(rawBody);
    const existing = await parentOf("job", id);
    if (!canChange(auth.ctx, "recruitment.records.manage", existing)) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }
    const placed = await placementFor(auth.ctx, "recruitment.records.manage", rawBody as Record<string, unknown>, placementOf(existing));
    if (!placed.ok) return withCors(req, { success: false, message: placed.error }, placed.status);

    const result = await sql`
      UPDATE job_posts SET
        job_title = ${body.job_title},
        department = ${body.department},
        number_of_positions = ${body.number_of_positions},
        posted_date = ${body.posted_date},
        closing_date = ${body.closing_date},
        status = ${body.status},
        location = ${body.location},
        job_type = ${body.job_type},
        experience = ${body.experience},
        salary_range = ${body.salary_range},
        job_description = ${body.job_description ?? null},
        requirements = ${body.requirements},
        responsibilities = ${body.responsibilities},
        company_id = ${placed.placement.companyId},
        department_id = ${placed.placement.departmentId},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Job not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "recruitment.job.updated", targetType: "recruitment.job", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Job updated successfully",
      data: result[0]
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: error?.errors ? error.errors[0].message : "Update failed",
      error: error.message
    }, 400);
  }
}

/* -------------------------
   DELETE JOB
------------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Job ID is required" }, 400);
    }
    if (!canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", id))) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      DELETE FROM job_posts
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Job not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "recruitment.job.deleted", targetType: "recruitment.job", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Job deleted successfully"
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: "Delete failed",
      error: error.message
    }, 500);
  }
}