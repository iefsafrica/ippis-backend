import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import Papa from "papaparse";
import bcrypt from "bcryptjs";
import { requirePermission, runAudited } from "@/lib/rbac";
import { normalizeScopeToBackend, resolveValidScope } from "@/lib/user-management";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);
const MANAGE = "users.accounts.manage";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

interface IncomingRow {
  row_number: number;
  username: string;
  email: string;
  full_name: string;
  staff_id: string;
  phone?: string;
  role_names: string;
  mda_name: string;
  department_name?: string;
  scope_level: string;
  status: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission(req, MANAGE);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const body = (await req.json()) as any;
    const { csvContent, rows: incomingRows, dryRun = false, reason } = body;

    let rawRows: any[] = [];

    if (csvContent && typeof csvContent === "string") {
      const parsed = Papa.parse(csvContent.trim(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
      });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        return withCors(req, { success: false, error: "Failed to parse CSV: " + parsed.errors[0]?.message }, 400);
      }

      rawRows = parsed.data;
    } else if (Array.isArray(incomingRows) && incomingRows.length > 0) {
      rawRows = incomingRows;
    } else {
      return withCors(req, { success: false, error: "csvContent or rows array is required" }, 400);
    }

    if (rawRows.length === 0) {
      return withCors(req, { success: false, error: "No records found to import" }, 400);
    }

    // Fetch existing records for duplicate check
    const existingUsers = await db`
      SELECT LOWER(username) AS u, LOWER(email) AS e, LOWER(staff_id) AS s
      FROM admin_users
    `;
    const existingUsernames = new Set(existingUsers.map((r) => r.u).filter(Boolean));
    const existingEmails = new Set(existingUsers.map((r) => r.e).filter(Boolean));
    const existingStaffIds = new Set(existingUsers.map((r) => r.s).filter(Boolean));

    // Fetch active roles
    const allRoles = await db`SELECT id, name, key FROM roles WHERE status = 'active'`;
    // Fetch active companies
    const allCompanies = await db`SELECT id, name, company_code FROM companies`;
    // Fetch active departments
    const allDepartments = await db`SELECT id, company_id, name FROM departments`;

    const fileUsernames = new Set<string>();
    const fileEmails = new Set<string>();
    const fileStaffIds = new Set<string>();

    const rows: IncomingRow[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 1;

      // Extract values with flexible header aliases
      const getVal = (...keys: string[]) => {
        for (const k of keys) {
          const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
          for (const rawKey of Object.keys(row)) {
            if (rawKey.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedKey) {
              const val = row[rawKey];
              if (val !== undefined && val !== null) return String(val).trim();
            }
          }
        }
        return "";
      };

      const username = getVal("username", "user");
      const email = getVal("email", "emailaddress");
      const fullName = getVal("fullname", "name", "employee_name", "staff_name");
      const staffId = getVal("staffid", "staff_id", "id", "employee_id");
      const phone = getVal("phone", "phonenumber", "telephone");
      const roleNames = getVal("role", "roles", "role_names") || "MDA Administrator";
      const mdaName = getVal("mda", "mda_name", "ministry", "agency", "company") || "Office of the Accountant General of the Federation";
      const departmentName = getVal("department", "department_name", "dept") || "IPPIS Central Operations";
      const scopeLevel = getVal("scope", "scope_level") || "assigned_mda";

      const errors: string[] = [];
      const warnings: string[] = [];

      // Validations
      if (!username) errors.push("Username is required");
      if (!email) errors.push("Email is required");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
      if (!fullName) errors.push("Full Name is required");
      if (!staffId) errors.push("Staff ID is required");

      // In-file duplicate checks
      if (username) {
        const uLower = username.toLowerCase();
        if (existingUsernames.has(uLower)) errors.push(`Username '${username}' already exists in system`);
        if (fileUsernames.has(uLower)) errors.push(`Duplicate username '${username}' inside file`);
        fileUsernames.add(uLower);
      }

      if (email) {
        const eLower = email.toLowerCase();
        if (existingEmails.has(eLower)) errors.push(`Email '${email}' already exists in system`);
        if (fileEmails.has(eLower)) errors.push(`Duplicate email '${email}' inside file`);
        fileEmails.add(eLower);
      }

      if (staffId) {
        const sLower = staffId.toLowerCase();
        if (existingStaffIds.has(sLower)) errors.push(`Staff ID '${staffId}' already exists in system`);
        if (fileStaffIds.has(sLower)) errors.push(`Duplicate staff ID '${staffId}' inside file`);
        fileStaffIds.add(sLower);
      }

      // Check role mapping
      const matchedRole = allRoles.find((r) =>
        roleNames.toLowerCase().includes(String(r.name).toLowerCase()) ||
        (r.key && roleNames.toLowerCase().includes(String(r.key).toLowerCase()))
      );
      if (!matchedRole) {
        warnings.push(`Role '${roleNames}' will default to MDA Administrator`);
      }

      rows.push({
        row_number: rowNum,
        username,
        email,
        full_name: fullName,
        staff_id: staffId,
        phone,
        role_names: roleNames,
        mda_name: mdaName,
        department_name: departmentName,
        scope_level: scopeLevel,
        status: "active",
        valid: errors.length === 0,
        errors,
        warnings,
      });
    }

    const validRows = rows.filter((r) => r.valid);
    let importedCount = 0;

    if (!dryRun && validRows.length > 0) {
      const defaultRole = allRoles.find((r) =>
        String(r.name).toLowerCase().includes("mda admin") || (r.key && r.key === "mda_admin")
      ) || allRoles[0];

      const defaultCompany = allCompanies[0];
      const defaultDept = allDepartments[0];

      const salt = await bcrypt.genSalt(10);
      const defaultPassHash = await bcrypt.hash("TempPassword123!", salt);

      for (const r of validRows) {
        // Resolve role
        const role = allRoles.find((ro) =>
          r.role_names.toLowerCase().includes(String(ro.name).toLowerCase()) ||
          (ro.key && r.role_names.toLowerCase().includes(String(ro.key).toLowerCase()))
        ) || defaultRole;

        // Resolve company
        const company = allCompanies.find((c) =>
          r.mda_name.toLowerCase().includes(String(c.name).toLowerCase()) ||
          (c.company_code && r.mda_name.toLowerCase().includes(String(c.company_code).toLowerCase()))
        ) || defaultCompany;

        // Resolve department
        const dept = allDepartments.find((d) =>
          r.department_name && String(d.name).toLowerCase().includes(r.department_name.toLowerCase())
        ) || defaultDept;

        const validScope = resolveValidScope(
          r.scope_level,
          company ? Number(company.id) : null,
          dept ? Number(dept.id) : null
        );

        // Insert into admin_users
        const inserted = await db`
          INSERT INTO admin_users (
            username, email, password_hash, full_name, staff_id, phone,
            mda_id, department_id, scope_level, role, is_active, status, notes,
            created_at, updated_at
          )
          VALUES (
            ${r.username}, ${r.email.toLowerCase()}, ${defaultPassHash}, ${r.full_name}, ${r.staff_id}, ${r.phone || null},
            ${validScope.company_id}, ${validScope.department_id}, ${validScope.scope_level},
            'admin', TRUE, 'active', 'Imported via CSV bulk upload', NOW(), NOW()
          )
          RETURNING id
        `;

        if (inserted[0]?.id && role?.id) {
          await db`
            INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, assigned_by, reason)
            VALUES (
              ${String(inserted[0].id)}, ${Number(role.id)}, ${validScope.scope_level},
              ${validScope.company_id}, ${validScope.department_id},
              ${ctx.userId}, ${reason || "Bulk CSV Import"}
            )
            ON CONFLICT DO NOTHING
          `;
          importedCount++;
        }
      }

      // Record audit event
      await runAudited(
        req,
        ctx,
        {
          action: "BULK_IMPORT",
          targetType: "user",
          targetId: `BATCH-IMPORT (${importedCount})`,
          reason: reason || "Authorised bulk CSV user import",
          details: {
            total_rows: rows.length,
            imported_count: importedCount,
            rejected_count: rows.length - importedCount,
          },
        },
        []
      );
    }

    return withCors(req, {
      success: true,
      total: rows.length,
      valid: validRows.length,
      invalid: rows.length - validRows.length,
      imported: dryRun ? 0 : importedCount,
      failed: rows.length - validRows.length,
      records: rows,
    });
  } catch (error: any) {
    console.error("BULK IMPORT ERROR:", error);
    return withCors(req, { success: false, error: error.message || "Failed to process CSV import" }, 500);
  }
}
