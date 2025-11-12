import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../../lib/cors";
import { NextRequest } from "next/server";

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

    // Safe query helper
    async function queryFirstRow<T>(query: string): Promise<T | undefined> {
      try {
        const raw = (await sql.query(query)) as unknown;
        if (Array.isArray(raw) && raw.length > 0) {
          return raw[0] as T;
        }
        return undefined;
      } catch (err) {
        console.error("Query failed:", err);
        return undefined;
      }
    }

    // Employees stats
    const employeesRow = await queryFirstRow<EmployeesStatsRow>(`
      SELECT 
        COUNT(*) AS total_employees,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_employees
      FROM employees;
    `);
    if (employeesRow) {
      stats.totalEmployees = Number(employeesRow.total_employees);
      stats.activeEmployees = Number(employeesRow.active_employees);
    }

    // Pending employees
    const pendingRow = await queryFirstRow<PendingEmployeesStatsRow>(`
      SELECT COUNT(*) AS pending_employees
      FROM pending_employees
      WHERE status = 'pending_approval';
    `);
    if (pendingRow) {
      stats.pendingEmployees = Number(pendingRow.pending_employees);
    }

    // Document stats from document_uploads
    if (documentUploadsExists) {
      const docRow = await queryFirstRow<DocumentsStatsRow>(`
        SELECT
          COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_documents,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) AS verified_documents,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_documents
        FROM document_uploads;
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
