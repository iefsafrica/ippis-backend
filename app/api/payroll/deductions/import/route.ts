import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission, runAudited } from "@/lib/rbac";
import { recordScope, inScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

const money = (v: unknown) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100) / 100);

const CSV_TEMPLATE = `employee_id,deduction_type,amount,description,period
IPPIS100234,loan_deduction,15000.00,Staff Cooperative Loan Repayment,2026-05
IPPIS100235,health_insurance,5000.00,Voluntary NHIS Top-up,2026-05
IPPIS100236,union_dues,2500.00,Civil Service Union Dues,2026-05`;

// GET: Template download or list imported deductions
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);

    // Return downloadable template or metadata
    if (searchParams.get("template") === "true" || searchParams.get("download") === "template") {
      if (searchParams.get("format") === "csv") {
        return new Response(CSV_TEMPLATE, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="ippis_payroll_deductions_template.csv"',
          },
        });
      }
      return withCors(req, {
        success: true,
        template: {
          csv: CSV_TEMPLATE,
          columns: [
            { name: "employee_id", required: true, description: "IPPIS number or employee ID (e.g. IPPIS100234)" },
            { name: "deduction_type", required: true, description: "loan_deduction | health_insurance | income_tax | provident_fund | union_dues | other" },
            { name: "amount", required: true, description: "Deduction amount in Naira (e.g. 15000.00)" },
            { name: "description", required: false, description: "Purpose / Reference / Note" },
            { name: "period", required: false, description: "Deduction period in YYYY-MM format (e.g. 2026-05)" },
          ],
          matrix_columns_alternative: [
            "employee_id", "loan_deduction", "income_tax", "provident_fund", "health_insurance", "period", "remarks"
          ],
        },
      });
    }

    // Otherwise list historical deductions
    const sc = recordScope(auth.ctx, "payroll.cycles.view");
    const period = searchParams.get("period");
    const employeeId = searchParams.get("employee_id") || searchParams.get("employeeId");
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "20")));
    const offset = (page - 1) * limit;

    const rows = await sql`
      SELECT 
        d.id,
        d.employee_id,
        e.name AS employee_name,
        d.period,
        d.deduction_type,
        d.description,
        d.amount,
        d.effective_date,
        d.uploaded_by,
        d.batch_id,
        d.created_at,
        c.name AS mda_name
      FROM payroll_deductions d
      LEFT JOIN employees e ON e.id = d.employee_id
      LEFT JOIN companies c ON c.id = e.company_id
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
        AND (${period}::text IS NULL OR d.period = ${period})
        AND (${employeeId}::text IS NULL OR d.employee_id = ${employeeId})
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM payroll_deductions d
      LEFT JOIN employees e ON e.id = d.employee_id
      WHERE (${sc.all}::boolean OR e.company_id = ANY(${sc.companyIds}::int[]) OR e.department_id = ANY(${sc.departmentIds}::int[]))
        AND (${period}::text IS NULL OR d.period = ${period})
        AND (${employeeId}::text IS NULL OR d.employee_id = ${employeeId})
    `;
    const total = Number(countResult?.[0]?.total || 0);

    return withCors(req, {
      success: true,
      data: {
        deductions: rows.map((r: any) => ({
          id: r.id,
          employeeId: r.employee_id,
          employeeName: r.employee_name || "Civil Service Officer",
          period: r.period,
          deductionType: r.deduction_type,
          description: r.description,
          amount: Number(r.amount),
          uploadedBy: r.uploaded_by,
          batchId: r.batch_id,
          createdAt: r.created_at,
          mda: r.mda_name || "Federal Public Service",
        })),
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      },
    });
  } catch (error: any) {
    console.error("GET DEDUCTIONS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load deductions", details: error?.message }, 500);
  }
}

// POST: Bulk upload deductions from CSV or JSON rows
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, "payroll.cycles.prepare");
    if (!auth.ok) return auth.response;

    const sc = recordScope(auth.ctx, "payroll.cycles.prepare");
    const contentType = req.headers.get("content-type") || "";

    let rawRows: any[] = [];
    let periodFromRequest: string | null = null;
    let dryRun = false;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      periodFromRequest = (formData.get("period") as string)?.trim() || null;
      dryRun = formData.get("dry_run") === "true" || formData.get("dryRun") === "true";

      if (!file) {
        return withCors(req, { success: false, error: "CSV file is required in 'file' form field" }, 400);
      }

      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      if (!parsed.data || parsed.data.length === 0) {
        return withCors(req, { success: false, error: "CSV file is empty or invalid" }, 400);
      }
      rawRows = parsed.data as any[];
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      periodFromRequest = typeof body.period === "string" ? body.period.trim() : null;
      dryRun = body.dryRun === true || body.dry_run === true;

      if (Array.isArray(body.rows) && body.rows.length > 0) {
        rawRows = body.rows;
      } else if (typeof body.csv === "string" && body.csv.trim()) {
        const parsed = Papa.parse(body.csv, { header: true, skipEmptyLines: true });
        rawRows = parsed.data as any[];
      } else {
        return withCors(req, { success: false, error: "Missing 'rows' array or 'csv' string in JSON body" }, 400);
      }
    }

    const defaultPeriod = periodFromRequest && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodFromRequest)
      ? periodFromRequest
      : new Date().toISOString().slice(0, 7);

    // Pre-fetch all active employees for validation and scope check
    const allEmployees = await sql`
      SELECT id, name, company_id, department_id, registration_id
      FROM employees
    `;
    const employeeMap = new Map<string, any>();
    for (const e of allEmployees) {
      employeeMap.set(String(e.id).trim().toUpperCase(), e);
      if (e.registration_id) {
        employeeMap.set(String(e.registration_id).trim().toUpperCase(), e);
      }
    }

    const batchId = `DED-BATCH-${Date.now()}`;
    const validDeductions: Array<{
      employee_id: string;
      employee_name: string;
      period: string;
      deduction_type: string;
      description: string;
      amount: number;
    }> = [];

    const errors: Array<{ row: number; employee_id: string; reason: string }> = [];

    rawRows.forEach((row, index) => {
      const rowNum = index + 2; // 1-based index including header
      // Normalize row keys
      const normalizedRow: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        normalizedRow[k.trim().toLowerCase().replace(/[\s-]+/g, "_")] = typeof v === "string" ? v.trim() : v;
      }

      const empIdRaw = normalizedRow.employee_id || normalizedRow.employee_code || normalizedRow.ippis_no || normalizedRow.ippis_number || normalizedRow.staff_id;
      if (!empIdRaw) {
        errors.push({ row: rowNum, employee_id: "EMPTY", reason: "Missing employee_id" });
        return;
      }

      const empId = String(empIdRaw).trim().toUpperCase();
      const emp = employeeMap.get(empId);

      if (!emp) {
        errors.push({ row: rowNum, employee_id: empIdRaw, reason: "Employee not found on nominal roll" });
        return;
      }

      if (!inScope(sc, emp.company_id, emp.department_id)) {
        errors.push({ row: rowNum, employee_id: empIdRaw, reason: OUT_OF_SCOPE });
        return;
      }

      const rowPeriod = normalizedRow.period || periodFromRequest || defaultPeriod;
      const desc = normalizedRow.description || normalizedRow.notes || normalizedRow.comments || normalizedRow.remarks || "Payroll Deduction";

      // Case A: Matrix format (multiple deduction columns on one row)
      const matrixColumns = [
        { col: "loan_deduction", type: "loan_deduction", label: "Loan Deduction" },
        { col: "loan", type: "loan_deduction", label: "Loan Deduction" },
        { col: "cooperative", type: "loan_deduction", label: "Staff Cooperative" },
        { col: "health_insurance", type: "health_insurance", label: "Health Insurance" },
        { col: "income_tax", type: "income_tax", label: "PAYE Tax" },
        { col: "provident_fund", type: "provident_fund", label: "Pension Contribution" },
      ];

      let addedFromMatrix = false;
      for (const m of matrixColumns) {
        if (normalizedRow[m.col] !== undefined && normalizedRow[m.col] !== null && normalizedRow[m.col] !== "") {
          const parsedAmt = Number(String(normalizedRow[m.col]).replace(/,/g, ""));
          if (!isNaN(parsedAmt) && parsedAmt > 0) {
            validDeductions.push({
              employee_id: String(emp.id),
              employee_name: emp.name,
              period: rowPeriod,
              deduction_type: m.type,
              description: desc !== "Payroll Deduction" ? desc : m.label,
              amount: money(parsedAmt),
            });
            addedFromMatrix = true;
          }
        }
      }

      if (addedFromMatrix) return;

      // Case B: Standard format (deduction_type & amount)
      const typeRaw = normalizedRow.deduction_type || normalizedRow.type || normalizedRow.category || "loan_deduction";
      const amtRaw = normalizedRow.amount || normalizedRow.deduction_amount || normalizedRow.value;

      if (amtRaw === undefined || amtRaw === null || amtRaw === "") {
        errors.push({ row: rowNum, employee_id: empIdRaw, reason: "Missing or invalid deduction amount" });
        return;
      }

      const parsedAmt = Number(String(amtRaw).replace(/,/g, ""));
      if (isNaN(parsedAmt) || parsedAmt <= 0) {
        errors.push({ row: rowNum, employee_id: empIdRaw, reason: "Amount must be a positive number" });
        return;
      }

      validDeductions.push({
        employee_id: String(emp.id),
        employee_name: emp.name,
        period: rowPeriod,
        deduction_type: typeRaw.toLowerCase().replace(/[\s-]+/g, "_"),
        description: desc,
        amount: money(parsedAmt),
      });
    });

    const totalAmount = money(validDeductions.reduce((sum, d) => sum + d.amount, 0));

    if (dryRun) {
      return withCors(req, {
        success: true,
        data: {
          dryRun: true,
          totalRows: rawRows.length,
          validCount: validDeductions.length,
          errorCount: errors.length,
          totalDeductionsAmount: totalAmount,
          preview: validDeductions.slice(0, 15),
          errors,
        },
      });
    }

    if (validDeductions.length === 0) {
      return withCors(
        req,
        {
          success: false,
          error: "No valid deduction rows found to import",
          errors,
        },
        400
      );
    }

    // Insert valid deductions into payroll_deductions
    const rowsJson = JSON.stringify(
      validDeductions.map((d) => ({
        employee_id: d.employee_id,
        period: d.period,
        deduction_type: d.deduction_type,
        description: d.description,
        amount: d.amount,
        effective_date: `${d.period}-01`,
        uploaded_by: auth.ctx.user.username,
        batch_id: batchId,
      }))
    );

    await sql`
      INSERT INTO payroll_deductions (
        employee_id, period, deduction_type, description, amount, effective_date, uploaded_by, batch_id, created_at, updated_at
      )
      SELECT x.employee_id, x.period, x.deduction_type, x.description, x.amount, x.effective_date::date, x.uploaded_by, x.batch_id, NOW(), NOW()
      FROM jsonb_to_recordset(${rowsJson}::jsonb) AS x(
        employee_id text,
        period text,
        deduction_type text,
        description text,
        amount numeric,
        effective_date text,
        uploaded_by text,
        batch_id text
      )
    `;

    // Also update employee_payments and recalculate pending payroll amounts
    for (const d of validDeductions) {
      // 1. Update employee_payments loan_deduction or matching column
      if (d.deduction_type.includes("loan") || d.deduction_type.includes("cooperative")) {
        await sql`
          UPDATE employee_payments 
          SET loan_deduction = ${d.amount}
          WHERE employee_id::text = ${d.employee_id}
        `;
      } else if (d.deduction_type.includes("health")) {
        await sql`
          UPDATE employee_payments 
          SET health_insurance = ${d.amount}
          WHERE employee_id::text = ${d.employee_id}
        `;
      } else if (d.deduction_type.includes("tax")) {
        await sql`
          UPDATE employee_payments 
          SET income_tax = ${d.amount}
          WHERE employee_id::text = ${d.employee_id}
        `;
      } else if (d.deduction_type.includes("pension") || d.deduction_type.includes("provident")) {
        await sql`
          UPDATE employee_payments 
          SET provident_fund = ${d.amount}
          WHERE employee_id::text = ${d.employee_id}
        `;
      }

      // 2. If a pending payroll record exists for this period, recalculate net pay
      await sql`
        UPDATE payroll p
        SET amount = GREATEST(0, (
          SELECT COALESCE(ep.basic_salary, 0) + COALESCE(ep.house_rent_allowance, 0) + COALESCE(ep.medical_allowance, 0)
                 + COALESCE(ep.travel_allowance, 0) + COALESCE(ep.dearness_allowance, 0)
                 - COALESCE(ep.provident_fund, 0) - COALESCE(ep.income_tax, 0) - COALESCE(ep.health_insurance, 0)
                 - COALESCE(ep.loan_deduction, 0)
          FROM employee_payments ep
          WHERE ep.employee_id::text = p.employee_id::text
          ORDER BY ep.payment_date DESC NULLS LAST, ep.created_at DESC NULLS LAST
          LIMIT 1
        )),
        updated_at = NOW()
        WHERE p.employee_id = ${d.employee_id}
          AND to_char(p.payment_date, 'YYYY-MM') = ${d.period}
          AND LOWER(p.status) = 'pending'
      `;
    }

    await runAudited(
      req,
      auth.ctx,
      {
        action: "payroll.deductions.imported",
        targetType: "payroll",
        targetId: batchId,
        details: { count: validDeductions.length, totalAmount, period: defaultPeriod, errorCount: errors.length },
      },
      []
    );

    return withCors(
      req,
      {
        success: true,
        message: `Successfully imported ${validDeductions.length} deduction(s)`,
        data: {
          batchId,
          totalRows: rawRows.length,
          importedCount: validDeductions.length,
          skippedCount: errors.length,
          totalAmount,
          period: defaultPeriod,
          errors,
        },
      },
      201
    );
  } catch (error: any) {
    console.error("IMPORT DEDUCTIONS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to process deductions import", details: error?.message }, 500);
  }
}

