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
// GET TRAINERS WITH DETAILS
// -------------------------
export async function GET(req: NextRequest) {
  try {
    // Aggregate trainers from training_programs
    const result = await sql`
      SELECT 
        trainer AS trainer_name,
        type AS training_type,
        email,
        phone,
        experience,
        rating,
        COUNT(*) AS trainings,
        status
      FROM training_programs
      GROUP BY trainer, type, email, phone, experience, rating, status
      ORDER BY trainer_name ASC
    `;

    // Map to frontend-friendly format
    const data = result.map((row: any) => ({
      trainer_name: row.trainer_name,
      type: row.training_type,
      contact: `${row.email ?? ""} | ${row.phone ?? ""}`,
      experience: row.experience ? `${row.experience} years` : "N/A",
      rating: row.rating ? parseFloat(row.rating) : 0,
      trainings: parseInt(row.trainings),
      status: row.status
    }));

    return withCors(req, {
      success: true,
      message: "Trainers fetched successfully",
      total: data.length,
      data
    });

  } catch (error) {
    console.error("Fetch trainers error:", error);

    return withCors(req, {
      success: false,
      message: "Error fetching trainers",
      total: 0,
      data: [],
    }, 500);
  }
}