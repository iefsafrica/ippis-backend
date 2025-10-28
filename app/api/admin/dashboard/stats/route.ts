import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

type TableNameRow = { table_name: string };
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

export async function GET(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || "")
 // @ts-expect-error axios response mismatch
    const tablesResult = await sql.query<TableNameRow[]>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `)

    const tables = Array.isArray(tablesResult)
      ? tablesResult.map((row) => row.table_name)
      : []

    const stats = {
      totalEmployees: 0,
      activeEmployees: 0,
      pendingEmployees: 0,
      pendingDocuments: 0,
      verifiedDocuments: 0,
      rejectedDocuments: 0,
    };

    // Safe query helper
    async function queryFirstRow<T>(query: string) {
      try {
         // @ts-expect-error axios response mismatch
        const result = await sql.query<T[]>(query)
        return Array.isArray(result) && result.length > 0 ? result[0] : undefined
      } catch (err) {
        console.error("Query failed:", err)
        return undefined
      }
    }

    // Employees table
    if (tables.includes("employees")) {
      const row = await queryFirstRow<EmployeesStatsRow>(`
        SELECT 
          COUNT(*) AS total_employees,
          COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_employees
        FROM employees;
      `);
      if (row) {
        stats.totalEmployees = Number(row.total_employees);
        stats.activeEmployees = Number(row.active_employees);
      }
    }

    // Pending employees
    if (tables.includes("pending_employees")) {
      const row = await queryFirstRow<PendingEmployeesStatsRow>(`
        SELECT COUNT(*) AS pending_employees
        FROM pending_employees
        WHERE status = 'pending_approval';
      `);
      if (row) {
        stats.pendingEmployees = Number(row.pending_employees);
      }
    }

    // Documents table (dynamic)
    const docTable = tables.includes("documents")
      ? "documents"
      : tables.includes("document_uploads")
      ? "document_uploads"
      : null;

    if (docTable) {
      const row = await queryFirstRow<DocumentsStatsRow>(`
        SELECT
          COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_documents,
          COUNT(CASE WHEN status = 'verified' THEN 1 END) AS verified_documents,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_documents
        FROM ${docTable};
      `);
      if (row) {
        stats.pendingDocuments = Number(row.pending_documents);
        stats.verifiedDocuments = Number(row.verified_documents);
        stats.rejectedDocuments = Number(row.rejected_documents);
      }
    }

    return withCors(req, { success: true, data: stats })
  } catch (error) {
    console.error("Unexpected error in dashboard GET:", error)
    return withCors(req, { success: false, message: "Unexpected server error" }, 500)
  }
}

// ✅ Handle preflight OPTIONS requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}
