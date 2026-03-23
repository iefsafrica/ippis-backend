import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// OPTIONS (CORS)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET TRAINING TYPES WITH DETAILS
// -------------------------
export async function GET(req: NextRequest) {
  try {
    // Fetch training types with details
    const result = await sql`
      SELECT
        type,
        category,
        duration,
        CASE WHEN required THEN 'Required' ELSE 'Optional' END AS required,
        CASE WHEN certification THEN 'Yes' ELSE 'No' END AS certification,
        COUNT(*) AS trainings,
        status
      FROM training_programs
      GROUP BY type, category, duration, required, certification, status
      ORDER BY type ASC
    `;

    return withCors(req, {
      success: true,
      message: "Training types fetched successfully",
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Fetch training types error:", error);

    return withCors(req, {
      success: false,
      message: "Error fetching training types",
      total: 0,
      data: [],
    }, 500);
  }
}