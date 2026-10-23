import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"
import { requirePermission, runAudited } from "@/lib/rbac"
import { recordScope, employeeInScope, OUT_OF_SCOPE } from "@/lib/mda-scope"

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

// Whether the payroll record exists and its employee is inside the caller's scope
async function payrollInScope(ctx: Parameters<typeof employeeInScope>[0], id: unknown) {
  const [row] = await sql`SELECT employee_id FROM payroll WHERE id::text = ${String(id)}`
  return !!row && (await employeeInScope(ctx, "payroll.cycles.prepare", row.employee_id))
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
    const auth = await requirePermission(req, "payroll.cycles.prepare")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as PayrollPayload & { month?: string, year?: string }

    if (!body.employee_id) {
      return withCors(req, { success: false, error: "Missing required fields: employee_id" }, 400)
    }

    // Check if employee exists
    const employee = await sql`SELECT id, name FROM employees WHERE id = ${body.employee_id}`
    if (!employee.length) {
      return withCors(req, { success: false, error: "Employee not found" }, 404)
    }
    if (!(await employeeInScope(auth.ctx, "payroll.cycles.prepare", body.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404)
    }

    let finalAmount = body.amount

    // If amount is not provided, calculate it based on attendance
    if (finalAmount == null) {
      // Get attendance for the month
      const attendance = await sql`
        SELECT status FROM attendance 
        WHERE employee_code = ${body.employee_id} 
        AND attendance_date::text LIKE ${`${body.year || new Date().getFullYear()}-${body.month || (new Date().getMonth() + 1).toString().padStart(2, "0")}%`}
      `
      
      const presentDays = attendance.filter(a => a.status === "present" || a.status === "late").length
      const absentDays = attendance.filter(a => a.status === "absent").length
      const totalWorkingDays = 22 // Default working days in a month

      // Get basic salary
      // employee_payments.employee_id is a UUID column; compare as text
      const salaryRecord = await sql`SELECT basic_salary FROM employee_payments WHERE employee_id::text = ${body.employee_id} ORDER BY created_at DESC LIMIT 1`
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

    await runAudited(req, auth.ctx, { action: "payroll.cycle.created", targetType: "payroll.cycle", details: {} }, [])

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
    const auth = await requirePermission(req, "payroll.cycles.view")
    if (!auth.ok) return auth.response

    const exists = await tableExists("payroll")
    if (!exists) return withCors(req, { success: false, error: "Payroll table does not exist" }, 404)

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    // Only the payroll of employees inside the caller's MDA or department
    const sc = recordScope(auth.ctx, "payroll.cycles.view")

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
          AND (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      `
      if (!rows.length) {
        return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404)
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
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const countResult = await sql`
      SELECT COUNT(*) AS total FROM payroll p JOIN employees e ON p.employee_id = e.id
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
    `
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
    const auth = await requirePermission(req, "payroll.cycles.prepare")
    if (!auth.ok) return auth.response

    const body = (await req.json()) as PayrollPayload
    if (!body.id) return withCors(req, { success: false, error: "ID is required" }, 400)
    if (!(await payrollInScope(auth.ctx, body.id))) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404)
    // The record may only be moved to another employee inside the caller's scope
    if (body.employee_id && !(await employeeInScope(auth.ctx, "payroll.cycles.prepare", body.employee_id))) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404)
    }

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
    await runAudited(req, auth.ctx, { action: "payroll.cycle.updated", targetType: "payroll.cycle", details: {} }, [])

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
    const auth = await requirePermission(req, "payroll.cycles.prepare")
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) return withCors(req, { success: false, error: "ID required" }, 400)
    if (!(await payrollInScope(auth.ctx, id))) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404)

    const result = await sql`DELETE FROM payroll WHERE id = ${id} RETURNING *`
    if (!result.length) return withCors(req, { success: false, error: "Not found" }, 404)

    await runAudited(req, auth.ctx, { action: "payroll.cycle.deleted", targetType: "payroll.cycle", details: {} }, [])

    return withCors(req, { success: true, message: "Deleted successfully" })
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "DELETE failed" }, 500)
  }
}