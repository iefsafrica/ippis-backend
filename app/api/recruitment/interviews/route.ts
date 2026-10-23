import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, placementFor, placementOf, parentOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { z } from "zod";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   VALIDATION SCHEMA
------------------------- */
const InterviewSchema = z.object({
  candidate_id: z.string().uuid(),
  job_id: z.string().uuid(),
  interview_datetime: z.string(),
  interview_type: z.enum(["technical", "hr", "behavioral"]),
  interviewers: z.string().min(1),
  status: z.enum(["scheduled", "completed", "cancelled"]),
  round: z.string().min(1),
  notes: z.string().optional(),
  feedback: z.string().optional()
});

/* -------------------------
   OPTIONS
------------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   CREATE INTERVIEW
------------------------- */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const body = InterviewSchema.parse(await req.json());
    // An interview belongs to its job post's MDA
    if (!canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", body.job_id))) {
      return withCors(req, { success: false, message: "Job not found or outside your organisational scope" }, 404);
    }

    const result = await sql`
      INSERT INTO job_interviews (
        candidate_id,
        job_id,
        interview_datetime,
        interview_type,
        interviewers,
        status,
        round,
        notes,
        feedback
      )
      VALUES (
        ${body.candidate_id},
        ${body.job_id},
        ${body.interview_datetime},
        ${body.interview_type},
        ${body.interviewers},
        ${body.status},
        ${body.round},
        ${body.notes ?? null},
        ${body.feedback ?? null}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "recruitment.interview.created", targetType: "recruitment.interview", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Interview created successfully",
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
   GET INTERVIEWS
------------------------- */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");
    const status = searchParams.get("status");
    // Only the interviews of job posts in the caller's MDA or department
    const sc = moduleScope(auth.ctx, "recruitment.records.view");

    /* SINGLE INTERVIEW */
    if (id) {
      const result = await sql`
        SELECT 
          ji.*,
          jc.candidate_name,
          jc.email,
          jp.job_title
        FROM job_interviews ji
        LEFT JOIN job_candidates jc ON ji.candidate_id = jc.id
        LEFT JOIN job_posts jp ON ji.job_id = jp.id
        WHERE ji.id = ${id}
          AND (${sc.all}::boolean OR jp.company_id = ANY(${sc.companyIds}::int[]) OR jp.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND jp.company_id IS NULL))
      `;

      if (result.length === 0) {
        return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
      }

      return withCors(req, { success: true, data: result[0] });
    }

    /* LIST FOR TABLE */
    const result = await sql`
      SELECT 
        ji.id,
        jc.candidate_name,
        jc.email,
        jp.job_title,
        ji.interview_datetime,
        ji.interview_type,
        ji.interviewers,
        ji.status,
        ji.round
      FROM job_interviews ji
      LEFT JOIN job_candidates jc ON ji.candidate_id = jc.id
      LEFT JOIN job_posts jp ON ji.job_id = jp.id
      WHERE (${status}::text IS NULL OR ji.status = ${status})
        AND (${sc.all}::boolean OR jp.company_id = ANY(${sc.companyIds}::int[]) OR jp.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND jp.company_id IS NULL))
      ORDER BY ji.interview_datetime DESC
    `;

    return withCors(req, {
      success: true,
      data: result
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
   UPDATE INTERVIEW
------------------------- */
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Interview ID required" }, 400);
    }

    const body = InterviewSchema.parse(await req.json());
    const [current] = await sql`SELECT job_id FROM job_interviews WHERE id = ${id}`;
    if (!current || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", current.job_id)) || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", body.job_id))) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      UPDATE job_interviews SET
        candidate_id = ${body.candidate_id},
        job_id = ${body.job_id},
        interview_datetime = ${body.interview_datetime},
        interview_type = ${body.interview_type},
        interviewers = ${body.interviewers},
        status = ${body.status},
        round = ${body.round},
        notes = ${body.notes ?? null},
        feedback = ${body.feedback ?? null},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Interview not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "recruitment.interview.updated", targetType: "recruitment.interview", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Interview updated successfully",
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
   DELETE INTERVIEW
------------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Interview ID required" }, 400);
    }
    const [current] = await sql`SELECT job_id FROM job_interviews WHERE id = ${id}`;
    if (!current || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", current.job_id))) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      DELETE FROM job_interviews
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Interview not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "recruitment.interview.deleted", targetType: "recruitment.interview", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Interview deleted successfully"
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: "Delete failed",
      error: error.message
    }, 500);
  }
}