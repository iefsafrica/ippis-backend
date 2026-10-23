import { NextRequest } from "next/server";
import { requirePermission, runAudited } from "@/lib/rbac";
import { moduleScope, canChange, placementFor, placementOf, parentOf, OUT_OF_SCOPE } from "@/lib/module-scope";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { z } from "zod";

const sql = neon(process.env.DATABASE_URL!);

/* -------------------------
   VALIDATION
------------------------- */
const CandidateSchema = z.object({
  job_id: z.string().uuid(),
  candidate_name: z.string().min(1),
  email: z.string().email(),
  phone_number: z.string().optional(),
  application_date: z.string(),
  status: z.enum(["applied", "shortlisted", "interview", "hired", "rejected"]),
  experience: z.string().min(1),
  education: z.string().min(1),
  skills: z.string().min(1)
});

/* -------------------------
   OPTIONS
------------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   CREATE CANDIDATE
------------------------- */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const body = CandidateSchema.parse(await req.json());

    /* CHECK JOB EXISTS */
    const job = await sql`
      SELECT id FROM job_posts WHERE id = ${body.job_id}
    `;

    if (job.length === 0 || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", body.job_id))) {
      return withCors(req, {
        success: false,
        message: "Invalid job ID or outside your organisational scope"
      }, 404);
    }

    const result = await sql`
      INSERT INTO job_candidates (
        job_id,
        candidate_name,
        email,
        phone_number,
        application_date,
        status,
        experience,
        education,
        skills
      )
      VALUES (
        ${body.job_id},
        ${body.candidate_name},
        ${body.email},
        ${body.phone_number ?? null},
        ${body.application_date},
        ${body.status},
        ${body.experience},
        ${body.education},
        ${body.skills}
      )
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "recruitment.candidate.created", targetType: "recruitment.candidate", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Candidate added successfully",
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
   GET CANDIDATES
------------------------- */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");
    const status = searchParams.get("status");
    const job_id = searchParams.get("job_id");
    const search = searchParams.get("search");
    // Only the candidates of job posts in the caller's MDA or department
    const sc = moduleScope(auth.ctx, "recruitment.records.view");

    /* SINGLE */
    if (id) {
      const result = await sql`
        SELECT jc.*, jp.job_title
        FROM job_candidates jc
        LEFT JOIN job_posts jp ON jc.job_id = jp.id
        WHERE jc.id = ${id}
          AND (${sc.all}::boolean OR jp.company_id = ANY(${sc.companyIds}::int[]) OR jp.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND jp.company_id IS NULL))
      `;

      if (result.length === 0) {
        return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
      }

      return withCors(req, {
        success: true,
        data: result[0]
      });
    }

    /* LIST */
    const result = await sql`
      SELECT 
        jc.*,
        jp.job_title
      FROM job_candidates jc
      LEFT JOIN job_posts jp ON jc.job_id = jp.id
      WHERE (${status}::text IS NULL OR jc.status = ${status})
        AND (${job_id}::text IS NULL OR jc.job_id::text = ${job_id})
        AND (${search ? "%" + search + "%" : null}::text IS NULL OR jc.candidate_name ILIKE ${search ? "%" + search + "%" : null})
        AND (${sc.all}::boolean OR jp.company_id = ANY(${sc.companyIds}::int[]) OR jp.department_id = ANY(${sc.departmentIds}::int[]) OR (false::boolean AND jp.company_id IS NULL))
      ORDER BY jc.created_at DESC
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
   UPDATE CANDIDATE
------------------------- */
export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Candidate ID is required" }, 400);
    }

    const body = CandidateSchema.parse(await req.json());
    // The candidate's job post, and any post they move to, must be inside the caller's scope
    const [current] = await sql`SELECT job_id FROM job_candidates WHERE id = ${id}`;
    if (!current || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", current.job_id)) || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", body.job_id))) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      UPDATE job_candidates SET
        job_id = ${body.job_id},
        candidate_name = ${body.candidate_name},
        email = ${body.email},
        phone_number = ${body.phone_number ?? null},
        application_date = ${body.application_date},
        status = ${body.status},
        experience = ${body.experience},
        education = ${body.education},
        skills = ${body.skills},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Candidate not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "recruitment.candidate.updated", targetType: "recruitment.candidate", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Candidate updated successfully",
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
   DELETE CANDIDATE
------------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "recruitment.records.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Candidate ID is required" }, 400);
    }
    const [current] = await sql`SELECT job_id FROM job_candidates WHERE id = ${id}`;
    if (!current || !canChange(auth.ctx, "recruitment.records.manage", await parentOf("job", current.job_id))) {
      return withCors(req, { success: false, message: OUT_OF_SCOPE }, 404);
    }

    const result = await sql`
      DELETE FROM job_candidates
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Candidate not found" }, 404);
    }

    await runAudited(req, auth.ctx, { action: "recruitment.candidate.deleted", targetType: "recruitment.candidate", details: {} }, []);

    return withCors(req, {
      success: true,
      message: "Candidate deleted successfully"
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: "Delete failed",
      error: error.message
    }, 500);
  }
}