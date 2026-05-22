import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// -------------------------
// OPTIONS (CORS)
// -------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// -------------------------
// GET Meetings
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const status = searchParams.get("status"); // optional filter
    const department = searchParams.get("department"); // optional filter

    let meetings;

    if (id && status && department) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE id = ${id} AND status = ${status} AND department = ${department}
        ORDER BY start_date ASC
      `;
    } else if (id && status) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE id = ${id} AND status = ${status}
        ORDER BY start_date ASC
      `;
    } else if (id && department) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE id = ${id} AND department = ${department}
        ORDER BY start_date ASC
      `;
    } else if (status && department) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE status = ${status} AND department = ${department}
        ORDER BY start_date ASC
      `;
    } else if (id) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE id = ${id}
        ORDER BY start_date ASC
      `;
    } else if (status) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE status = ${status}
        ORDER BY start_date ASC
      `;
    } else if (department) {
      meetings = await sql`
        SELECT * FROM hr_events
        WHERE department = ${department}
        ORDER BY start_date ASC
      `;
    } else {
      meetings = await sql`
        SELECT * FROM hr_events
        ORDER BY start_date ASC
      `;
    }

    // Map for frontend display
    const data = meetings.map((row: any) => ({
      id: row.id,
      meeting_title: row.title,
      type: row.event_type,
      date_time: row.start_date + (row.end_date ? ` - ${row.end_date}` : ""),
      location: row.location || "N/A",
      status: row.status,
      participants: Array.isArray(row.attendees) ? row.attendees.length : 0,
    }));

    return withCors(req, {
      success: true,
      message: "Meetings fetched successfully",
      total: data.length,
      data,
    });

  } catch (error) {
    console.error("Fetch meetings error:", error);
    return withCors(req, {
      success: false,
      message: "Error fetching meetings",
      total: 0,
      data: [],
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}