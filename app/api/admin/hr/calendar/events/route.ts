import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../../lib/cors";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const sql = neon(process.env.DATABASE_URL!);

/* -------------------- Types -------------------- */
interface EventPayload {
  id?: number;
  title: string;
  event_type: string;
  start_date: string;
  end_date: string;
  all_day?: boolean;
  department?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  status?: string;
}

interface EmployeeRow {
  employee_key: string;
}

/* -------------------- CORS -------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------- GET -------------------- */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const department = req.nextUrl.searchParams.get("department");

    let events;

    if (id) {
      events = await sql`
        SELECT * FROM hr_events WHERE id = ${id}
      `;
    } else if (department) {
      events = await sql`
        SELECT * FROM hr_events
        WHERE department = ${department}
        ORDER BY start_date ASC
      `;
    } else {
      events = await sql`
        SELECT * FROM hr_events
        ORDER BY start_date ASC
      `;
    }

    return withCors(req, { success: true, data: events });
  } catch (error) {
    console.error("Error fetching events:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to fetch events",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- POST -------------------- */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as EventPayload;

    const {
      title,
      event_type,
      start_date,
      end_date,
      all_day = false,
      department,
      location,
      description,
      attendees,
    } = body;

    if (!title || !event_type || !start_date || !end_date) {
      return withCors(
        req,
        {
          success: false,
          error: "title, event_type, start_date and end_date are required",
        },
        400
      );
    }

    /* ---------- Validate employees ---------- */
    if (attendees && attendees.length > 0) {
      const existingEmployees = (await sql`
        SELECT DISTINCT
          COALESCE(registration_id, id::text) AS employee_key
        FROM employees
        WHERE registration_id = ANY(${attendees})
           OR id::text = ANY(${attendees})
      `) as EmployeeRow[];

      const existingKeys = existingEmployees.map(e => e.employee_key);

      const invalidIds = attendees.filter(
        id => !existingKeys.includes(id)
      );

      if (invalidIds.length > 0) {
        return withCors(
          req,
          {
            success: false,
            error: "Some employee IDs do not exist",
            invalid_employee_ids: invalidIds,
          },
          400
        );
      }
    }

    /* ---------- Insert event ---------- */
    const result = await sql`
      INSERT INTO hr_events (
        title,
        event_type,
        start_date,
        end_date,
        all_day,
        department,
        location,
        description,
        attendees,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${title},
        ${event_type},
        ${start_date},
        ${end_date},
        ${all_day},
        ${department},
        ${location},
        ${description},
        ${attendees},
        'active',
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return withCors(
      req,
      {
        success: true,
        message: "Event created successfully",
        data: result[0],
      },
      201
    );
  } catch (error) {
    console.error("Error creating event:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to create event",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- PUT -------------------- */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<EventPayload>;
    const { id } = body;

    if (!id) {
      return withCors(
        req,
        { success: false, error: "Event id is required" },
        400
      );
    }

    /* ---------- Validate employees ---------- */
    if (body.attendees && body.attendees.length > 0) {
      const existingEmployees = (await sql`
        SELECT DISTINCT
          COALESCE(registration_id, id::text) AS employee_key
        FROM employees
        WHERE registration_id = ANY(${body.attendees})
           OR id::text = ANY(${body.attendees})
      `) as EmployeeRow[];

      const existingKeys = existingEmployees.map(e => e.employee_key);

      const invalidIds = body.attendees.filter(
        id => !existingKeys.includes(id)
      );

      if (invalidIds.length > 0) {
        return withCors(
          req,
          {
            success: false,
            error: "Some employee IDs do not exist",
            invalid_employee_ids: invalidIds,
          },
          400
        );
      }
    }

    const updated = await sql`
      UPDATE hr_events
      SET
        title = COALESCE(${body.title}, title),
        event_type = COALESCE(${body.event_type}, event_type),
        start_date = COALESCE(${body.start_date}, start_date),
        end_date = COALESCE(${body.end_date}, end_date),
        all_day = COALESCE(${body.all_day}, all_day),
        department = COALESCE(${body.department}, department),
        location = COALESCE(${body.location}, location),
        description = COALESCE(${body.description}, description),
        attendees = COALESCE(${body.attendees}, attendees),
        status = COALESCE(${body.status}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Event updated successfully",
      data: updated[0],
    });
  } catch (error) {
    console.error("Error updating event:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to update event",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/* -------------------- DELETE -------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return withCors(
        req,
        { success: false, error: "Event id is required" },
        400
      );
    }

    await sql`
      DELETE FROM hr_events WHERE id = ${id}
    `;

    return withCors(req, {
      success: true,
      message: "Event deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting event:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Failed to delete event",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
