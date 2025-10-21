// import { NextResponse } from "next/server"
// import { neon } from "@neondatabase/serverless"

// export async function GET(request: Request, { params }: { params: { id: string } }) {
//   try {
//     const id = params.id
//     const sql = neon(process.env.DATABASE_URL!)

//     // Get employee details
//     const result = await sql`
//       SELECT * FROM employees WHERE id = ${id}
//     `

//     if (result.length === 0) {
//       return NextResponse.json(
//         {
//           error: "Employee not found",
//         },
//         { status: 404 },
//       )
//     }

//     return NextResponse.json({
//       success: true,
//       data: result[0],
//     })
//   } catch (error) {
//     console.error("Get employee error:", error)
//     return NextResponse.json(
//       {
//         error: "Failed to fetch employee details",
//         details: error instanceof Error ? error.message : String(error),
//       },
//       { status: 500 },
//     )
//   }
// }

// export async function PUT(request: Request, { params }: { params: { id: string } }) {
//   try {
//     const id = params.id
//     const data = await request.json()
//     const sql = neon(process.env.DATABASE_URL!)

//     // Check if employee exists
//     const checkResult = await sql`
//       SELECT id FROM employees WHERE id = ${id}
//     `

//     if (checkResult.length === 0) {
//       return NextResponse.json(
//         {
//           error: "Employee not found",
//         },
//         { status: 404 },
//       )
//     }

//     // If we're just updating the status
//     if (Object.keys(data).length === 1 && data.status) {
//       const { status } = data

//       // Validate status
//       if (!["active", "inactive", "pending"].includes(status)) {
//         return NextResponse.json(
//           {
//             error: "Invalid status value",
//           },
//           { status: 400 },
//         )
//       }

//       // Update employee status
//       const result = await sql`
//         UPDATE employees
//         SET 
//           status = ${status},
//           updated_at = CURRENT_TIMESTAMP
//         WHERE id = ${id}
//         RETURNING id, name, email, department, position, status, join_date
//       `

//       // Add to history
//       await sql`
//         INSERT INTO registration_history (
//           registration_id, 
//           action, 
//           details, 
//           performed_by
//         )
//         VALUES (
//           ${id}, 
//           'status_updated', 
//           ${`Employee status updated to ${status}`}, 
//           'Admin'
//         )
//       `

//       return NextResponse.json({
//         success: true,
//         data: result[0],
//       })
//     }
//     // Full update
//     else {
//       const { name, email, department, position, status } = data

//       // Validate required fields
//       if (!name || !email || !department || !position || !status) {
//         return NextResponse.json(
//           {
//             error: "Missing required fields",
//           },
//           { status: 400 },
//         )
//       }

//       // Update employee
//       const result = await sql`
//         UPDATE employees
//         SET 
//           name = ${name},
//           email = ${email},
//           department = ${department},
//           position = ${position},
//           status = ${status},
//           updated_at = CURRENT_TIMESTAMP
//         WHERE id = ${id}
//         RETURNING id, name, email, department, position, status, join_date
//       `

//       // Add to history
//       await sql`
//         INSERT INTO registration_history (
//           registration_id, 
//           action, 
//           details, 
//           performed_by
//         )
//         VALUES (
//           ${id}, 
//           'updated', 
//           'Employee information updated', 
//           'Admin'
//         )
//       `

//       return NextResponse.json({
//         success: true,
//         data: result[0],
//       })
//     }
//   } catch (error) {
//     console.error("Update employee error:", error)
//     return NextResponse.json(
//       {
//         error: "Failed to update employee",
//         details: error instanceof Error ? error.message : String(error),
//       },
//       { status: 500 },
//     )
//   }
// }

// export async function DELETE(request: Request, { params }: { params: { id: string } }) {
//   try {
//     const id = params.id
//     const sql = neon(process.env.DATABASE_URL!)

//     // Check if employee exists
//     const checkResult = await sql`
//       SELECT id FROM employees WHERE id = ${id}
//     `

//     if (checkResult.length === 0) {
//       return NextResponse.json(
//         {
//           error: "Employee not found",
//         },
//         { status: 404 },
//       )
//     }

//     // Soft delete employee (mark as deleted)
//     await sql`
//       UPDATE employees
//       SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
//       WHERE id = ${id}
//     `

//     // Add to history
//     await sql`
//       INSERT INTO registration_history (
//         registration_id, 
//         action, 
//         details, 
//         performed_by
//       )
//       VALUES (
//         ${id}, 
//         'deleted', 
//         'Employee deleted', 
//         'Admin'
//       )
//     `

//     return NextResponse.json({
//       success: true,
//       message: "Employee deleted successfully",
//     })
//   } catch (error) {
//     console.error("Delete employee error:", error)
//     return NextResponse.json(
//       {
//         error: "Failed to delete employee",
//         details: error instanceof Error ? error.message : String(error),
//       },
//       { status: 500 },
//     )
//   }
// }
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

// Utility to handle errors consistently
function handleError(context: string, error: unknown, status = 500) {
  console.error(`${context} error:`, error);
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: context, details: message }, { status });
}

// Utility to validate required fields
function validateFields(data: Record<string, any>, fields: string[]) {
  const missing = fields.filter((field) => !data[field]);
  return missing.length > 0 ? `Missing required fields: ${missing.join(", ")}` : null;
}

// Helper to conditionally insert registration history
async function insertHistoryIfRegistrationExists(id: string, action: string, details: string) {
  const numericId = Number(id);
  const isNumeric = !isNaN(numericId);
  if (isNumeric) {
    const registrationExists = await sql`SELECT id FROM registrations WHERE id = ${numericId}`;
    if (registrationExists.length > 0) {
      await sql`
        INSERT INTO registration_history (registration_id, action, details, performed_by)
        VALUES (${numericId}, ${action}, ${details}, 'Admin')
      `;
    }
  }
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const result = await sql`SELECT * FROM employees WHERE id = ${id}`;
    if (result.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error) {
    return handleError("Failed to fetch employee details", error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const data = await request.json();

    // Check if employee exists
    const exists = await sql`SELECT id FROM employees WHERE id = ${id}`;
    if (exists.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Status-only update
    if (Object.keys(data).length === 1 && "status" in data) {
      const { status } = data;
      if (!["active", "inactive", "pending"].includes(status)) {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }

      const updated = await sql`
        UPDATE employees
        SET status = ${status}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING id, name, email, department, position, status, join_date
      `;

      await insertHistoryIfRegistrationExists(id, "status_updated", `Employee status updated to ${status}`);

      return NextResponse.json({ success: true, data: updated[0] });
    }

    // Full update validation
    const requiredFields = ["name", "email", "department", "position", "status"];
    const missingFields = validateFields(data, requiredFields);
    if (missingFields) {
      return NextResponse.json({ error: missingFields }, { status: 400 });
    }

    const { name, email, department, position, status } = data;

    const updated = await sql`
      UPDATE employees
      SET
        name = ${name},
        email = ${email},
        department = ${department},
        position = ${position},
        status = ${status},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING id, name, email, department, position, status, join_date
    `;

    await insertHistoryIfRegistrationExists(id, "updated", "Employee information updated");

    return NextResponse.json({ success: true, data: updated[0] });
  } catch (error) {
    return handleError("Failed to update employee", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Check if employee exists
    const exists = await sql`SELECT id FROM employees WHERE id = ${id}`;
    if (exists.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Soft delete the employee
    await sql`
      UPDATE employees
      SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;

    await insertHistoryIfRegistrationExists(id, "deleted", "Employee deleted");

    return NextResponse.json({
      success: true,
      message: "Employee deleted successfully",
    });
  } catch (error) {
    return handleError("Failed to delete employee", error);
  }
}
