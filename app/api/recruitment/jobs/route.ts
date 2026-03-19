import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";
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
    const rawBody = await req.json();

    const body = JobSchema.parse(rawBody);

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
        responsibilities
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
        ${body.responsibilities}
      )
      RETURNING *
    `;

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
    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    /* -------- SINGLE JOB -------- */
    if (id) {
      const result = await sql`
        SELECT * FROM job_posts WHERE id = ${id}
      `;

      if (result.length === 0) {
        return withCors(req, { success: false, message: "Job not found" }, 404);
      }

      return withCors(req, {
        success: true,
        data: result[0]
      });
    }

    /* -------- FILTERED JOBS -------- */
    const jobs = await sql`
      SELECT * FROM job_posts
      WHERE
        (${status ? sql`status = ${status}` : sql`TRUE`})
        AND
        (${search ? sql`job_title ILIKE ${"%" + search + "%"}` : sql`TRUE`})
      ORDER BY created_at DESC
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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Job ID is required" }, 400);
    }

    const rawBody = await req.json();
    const body = JobSchema.parse(rawBody);

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
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Job not found" }, 404);
    }

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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Job ID is required" }, 400);
    }

    const result = await sql`
      DELETE FROM job_posts
      WHERE id = ${id}
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Job not found" }, 404);
    }

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