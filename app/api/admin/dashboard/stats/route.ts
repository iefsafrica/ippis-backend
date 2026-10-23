import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import { authenticate } from "@/lib/rbac";
import { recordScope } from "@/lib/mda-scope";

// Row types
type EmployeesStatsRow = {
  total_employees: string;
  active_employees: string;
};
type PendingEmployeesStatsRow = {
  pending_employees: string;
};
type DocumentsStatsRow = {
  pending_documents: string;
  verified_documents: string;
  rejected_documents: string;
};

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Any signed-in admin; each figure counts only records inside the scope of
    // the permission that shows them (DSH-02), so it is 0 without that permission
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const scE = recordScope(auth.ctx, "employees.records.view");
    const scR = recordScope(auth.ctx, "employees.registrations.view");
    const scD = recordScope(auth.ctx, "employees.documents.view");

    const sql = neon(process.env.DATABASE_URL || "");

    // Check if document_uploads table exists
    const tableCheckResult = (await sql.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'document_uploads'
      ) AS table_exists;
    `)) as Array<{ table_exists: boolean }>;

    const documentUploadsExists = tableCheckResult[0]?.table_exists ?? false;

    const stats = {
      totalEmployees: 0,
      activeEmployees: 0,
      pendingEmployees: 0,
      pendingDocuments: 0,
      verifiedDocuments: 0,
      rejectedDocuments: 0,
    };

    // First row of a query, or undefined when it fails (e.g. a missing table)
    async function firstRow<T>(query: Promise<any>): Promise<T | undefined> {
      try {
        const rows = (await query) as unknown;
        return Array.isArray(rows) && rows.length > 0 ? (rows[0] as T) : undefined;
      } catch (err) {
        console.error("Dashboard stats query failed:", err);
        return undefined;
      }
    }

    // Employees stats
    const employeesRow = await firstRow<EmployeesStatsRow>(sql`
      SELECT 
        COUNT(*) AS total_employees,
        COUNT(CASE WHEN e.status = 'active' THEN 1 END) AS active_employees
      FROM employees e
      WHERE (${scE.all}::boolean OR e.company_id = ANY(${scE.companyIds}::int[]) OR e.department_id = ANY(${scE.departmentIds}::int[]))
    `);
    if (employeesRow) {
      stats.totalEmployees = Number(employeesRow.total_employees);
      stats.activeEmployees = Number(employeesRow.active_employees);
    }

    // Pending employees
    const pendingRow = await firstRow<PendingEmployeesStatsRow>(sql`
      SELECT COUNT(*) AS pending_employees
      FROM pending_employees p
      LEFT JOIN employment_info ei ON ei.registration_id = p.registration_id
      WHERE (${scR.all}::boolean OR ei.company_id = ANY(${scR.companyIds}::int[]) OR ei.department_id = ANY(${scR.departmentIds}::int[]))
    `);
    if (pendingRow) {
      stats.pendingEmployees = Number(pendingRow.pending_employees);
    }

    // Document stats from document_uploads
    if (documentUploadsExists) {
      const docRow = await firstRow<DocumentsStatsRow>(sql`
        SELECT
          COUNT(CASE WHEN du.status = 'pending' THEN 1 END) AS pending_documents,
          COUNT(CASE WHEN du.status = 'approved' THEN 1 END) AS verified_documents,
          COUNT(CASE WHEN du.status = 'rejected' THEN 1 END) AS rejected_documents
        FROM document_uploads du
        LEFT JOIN employees emp ON emp.registration_id = du.registration_id
        LEFT JOIN employment_info ei ON ei.registration_id = du.registration_id
        WHERE (${scD.all}::boolean OR COALESCE(emp.company_id, ei.company_id) = ANY(${scD.companyIds}::int[]) OR COALESCE(emp.department_id, ei.department_id) = ANY(${scD.departmentIds}::int[]))
      `);
      if (docRow) {
        stats.pendingDocuments = Number(docRow.pending_documents);
        stats.verifiedDocuments = Number(docRow.verified_documents);
        stats.rejectedDocuments = Number(docRow.rejected_documents);
      }
    }

    return withCors(req, { success: true, data: stats });
  } catch (error) {
    console.error("Unexpected error in dashboard GET:", error);
    return withCors(req, { success: false, message: "Unexpected server error" }, 500);
  }
}

// Handle preflight OPTIONS requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
