import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

// ---------------------------
// Type definition for Payroll
// ---------------------------
type PayrollPayload = {
  id?: number
  payment_id?: string
  employee_id?: string
  payment_date?: string
  payment_type?: string
  amount?: number
  status?: string
}

// ---------------------------------
// Helper: check if table exists
// ---------------------------------
async function tableExists(tableName: string) {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${tableName}
      )
    `
    return result?.[0]?.exists ?? false
  } catch {
    return false
  }
}

// ---------------------------------
// Helper: format date fields
// ---------------------------------
function formatDateFields(rows: any[]) {
  return rows.map((r) => {
    if (r.payment_date) r.paymentDate = new Date(r.payment_date).toISOString()
    if (r.created_at) r.createdAt = new Date(r.created_at).toISOString()
    if (r.updated_at) r.updatedAt = new Date(r.updated_at).toISOString()
    return r
  })
}

// ---------------------------
// OPTIONS (CORS Preflight)
// ---------------------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ---------------------------
// CREATE (POST) endpoint
// Auto-generates payment_id
// ---------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PayrollPayload & { month?: string, year?: string }

    if (!body.employee_id) {
      return withCors(req, { success: false, error: "Missing required fields: employee_id" }, 400)
    }

    // Check if employee exists
    const employee = await sql`SELECT id, name FROM employees WHERE id = ${body.employee_id}`
    if (!employee.length) {
      return withCors(req, { success: false, error: "Employee not found" }, 404)
    }

    let finalAmount = body.amount

    // If amount is not provided, calculate it based on attendance
    if (finalAmount == null) {
      // Get attendance for the month
      const attendance = await sql`
        SELECT status FROM attendance 
        WHERE employee_code = ${body.employee_id} 
        AND attendance_date LIKE ${`${body.year || new Date().getFullYear()}-${body.month || (new Date().getMonth() + 1).toString().padStart(2, "0")}%`}
      `
      
      const presentDays = attendance.filter(a => a.status === "present" || a.status === "late").length
      const absentDays = attendance.filter(a => a.status === "absent").length
      const totalWorkingDays = 22 // Default working days in a month

      // Get basic salary
      const salaryRecord = await sql`SELECT basic_salary FROM employee_payments WHERE employee_id = ${body.employee_id} ORDER BY created_at DESC LIMIT 1`
      const baseSalary = salaryRecord[0] ? parseFloat((salaryRecord[0] as any).basic_salary) : 50000 // Default if not found

      // Calculate ratio
      // If no attendance records, assume 100% (or 0%? Let's assume 100% for now but deduct for explicit absence)
      finalAmount = baseSalary - (baseSalary / totalWorkingDays * absentDays)
      if (finalAmount < 0) finalAmount = 0
    }

    // Auto-generate payment_id: PAY-001, PAY-002, etc.
    const lastPayment = await sql`SELECT payment_id FROM payroll ORDER BY id DESC LIMIT 1`
    let newPaymentId = "PAY-001"
    if (lastPayment.length && lastPayment[0]?.payment_id) {
      const lastNumber = parseInt(lastPayment[0].payment_id.replace("PAY-", ""), 10)
      const nextNumber = lastNumber + 1
      newPaymentId = `PAY-${nextNumber.toString().padStart(3, "0")}`
    }

    const result = await sql`
      INSERT INTO payroll (
        payment_id,
        employee_id,
        payment_date,
        payment_type,
        amount,
        status
      )
      VALUES (
        ${newPaymentId},
        ${body.employee_id},
        ${body.payment_date || new Date().toISOString().split("T")[0]},
        ${body.payment_type || "salary"},
        ${finalAmount},
        ${body.status || "pending"}
      )
      RETURNING *
    `

    return withCors(req, { 
      success: true, 
      data: result?.[0] ?? null,
      message: body.amount == null ? "Amount calculated based on attendance" : undefined 
    })
  } catch (error: any) {
    console.error("Payroll POST error:", error)
    return withCors(req, { success: false, error: error?.message || "POST failed" }, 500)
  }
}

// ---------------------------
// READ (GET) endpoint
// Supports fetching by ID or pagination
// ---------------------------
export async function GET(req: NextRequest) {
  try {
    const exists = await tableExists("payroll")
    if (!exists) return withCors(req, { success: false, error: "Payroll table does not exist" }, 404)

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (id) {
      // Fetch single payroll record by ID
      const rows = await sql`
        SELECT 
          p.*,
          e.name AS employee_name,
          e.department
        FROM payroll p
        JOIN employees e ON p.employee_id = e.id
        WHERE p.id = ${id}
      `
      if (!rows.length) {
        return withCors(req, { success: false, error: "Payroll record not found" }, 404)
      }
      return withCors(req, { success: true, data: formatDateFields(rows)[0] })
    }

    // Otherwise, return paginated list
    const page = Number(searchParams.get("page") || "1")
    const limit = Number(searchParams.get("limit") || "10")
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT 
        p.*,
        e.name AS employee_name,
        e.department
      FROM payroll p
      JOIN employees e ON p.employee_id = e.id
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const countResult = await sql`SELECT COUNT(*) AS total FROM payroll`
    const total = Number(countResult?.[0]?.total ?? 0)

    return withCors(req, {
      success: true,
      data: {
        payrolls: formatDateFields(rows),
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    })
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "GET failed" }, 500)
  }
}

// ---------------------------
// UPDATE (PUT) endpoint
// ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as PayrollPayload
    if (!body.id) return withCors(req, { success: false, error: "ID is required" }, 400)

    const result = await sql`
      UPDATE payroll SET
        payment_id = COALESCE(${body.payment_id}, payment_id),
        employee_id = COALESCE(${body.employee_id}, employee_id),
        payment_date = COALESCE(${body.payment_date}, payment_date),
        payment_type = COALESCE(${body.payment_type}, payment_type),
        amount = COALESCE(${body.amount}, amount),
        status = COALESCE(${body.status}, status)
      WHERE id = ${body.id}
      RETURNING *
    `

    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404)
    return withCors(req, { success: true, data: result[0] })
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "PUT failed" }, 500)
  }
}

// ---------------------------
// DELETE endpoint
// ---------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) return withCors(req, { success: false, error: "ID required" }, 400)

    const result = await sql`DELETE FROM payroll WHERE id = ${id} RETURNING *`
    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404)

    return withCors(req, { success: true, message: "Deleted successfully" })
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "DELETE failed" }, 500)
  }
}