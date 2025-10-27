import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

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

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Fetch table names
    const tablesResult = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public';
    `;
    const tables = (tablesResult as unknown as TableNameRow[]).map(
      (row) => row.table_name
    );

    const stats = {
      totalEmployees: 0,
      activeEmployees: 0,
      pendingEmployees: 0,
      pendingDocuments: 0,
      verifiedDocuments: 0,
      rejectedDocuments: 0,
    };

    // Helper function for parameterized queries
   async function queryFirstRow<T>(query: string, params?: any[]): Promise<T | undefined> {
  try {
    // Execute the query. Neon returns an array of rows directly
    const result = params ? await sql.query(query, params) : await sql.query(query);
    
    // Cast the result directly to T[]
    const rows = result as unknown as T[];
    return rows.length > 0 ? rows[0] : undefined;
  } catch (err) {
    console.error("Query failed:", err);
    return undefined;
  }
}


    // Employees stats
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

    // Pending employees stats
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

    // Document stats
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

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error("Unexpected error in dashboard GET:", error);
    return NextResponse.json(
      { success: false, message: "Unexpected server error" },
      { status: 500 }
    );
  }
}
