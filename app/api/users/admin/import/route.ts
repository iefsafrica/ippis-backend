import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import Papa from "papaparse";
import bcrypt from "bcryptjs";
import { requirePermission, runAudited, covers, type Scope } from "@/lib/rbac";
import { sendEmployeeCredentialsEmail } from "@/lib/email";
import { checkRoleAssignment, scopeFromRequest } from "@/lib/role-grants";
import { generateTemporaryPassword } from "@/lib/password-utils";

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
  // Resolved during validation; a row is imported exactly as resolved here
  resolved_scope: Scope | null;
  role_ids: number[];
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
    // The same role and scope combination is checked once per file
    const roleChecks = new Map<string, Awaited<ReturnType<typeof checkRoleAssignment>>>();

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
      // Nothing is filled in for the importer: an empty role means no role, and an
      // MDA or department that does not match exactly is an error, not a default
      const roleNames = getVal("role", "roles", "role_names");
      const mdaName = getVal("mda", "mda_name", "ministry", "agency", "company");
      const departmentName = getVal("department", "department_name", "dept");
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

      // MDA: exact name or code
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const company = mdaName
        ? allCompanies.find((c) => norm(c.name) === norm(mdaName) || (c.company_code && norm(c.company_code) === norm(mdaName)))
        : undefined;
      if (mdaName && !company) errors.push(`MDA '${mdaName}' not found (use the exact MDA name or code)`);

      // Department: exact name inside that MDA
      const dept = departmentName && company
        ? allDepartments.find((d) => Number(d.company_id) === Number(company.id) && norm(d.name) === norm(departmentName))
        : undefined;
      if (departmentName && company && !dept) errors.push(`Department '${departmentName}' not found in ${company.name}`);
      if (departmentName && !mdaName) errors.push("A department needs its MDA in the same row");

      // Roles: exact name or key; several can be separated with ; or |
      const roleIds: number[] = [];
      for (const wanted of roleNames.split(/[;|]/).map((r) => r.trim()).filter(Boolean)) {
        const role = allRoles.find((r) => norm(r.name) === norm(wanted) || (r.key && norm(r.key) === norm(wanted)));
        if (role) roleIds.push(Number(role.id));
        else errors.push(`Role '${wanted}' not found (use the exact role name)`);
      }

      // Scope, and whether the importer may create this account and grant these roles
      let resolvedScope: Scope | null = null;
      if (errors.length === 0) {
        const resolved = await scopeFromRequest(scopeLevel, company?.id ?? null, dept?.id ?? null);
        if ("error" in resolved) {
          errors.push(resolved.error);
        } else if (!covers(ctx, MANAGE, resolved.scope)) {
          errors.push("This account would be outside your organisational scope");
        } else {
          const key = `${roleIds.join(",")}|${resolved.scope.level}|${resolved.scope.companyId}|${resolved.scope.departmentId}`;
          let check = roleChecks.get(key);
          if (!check) {
            check = await checkRoleAssignment(ctx, null, roleIds, resolved.scope);
            roleChecks.set(key, check);
          }
          if (!check.ok) errors.push(check.error);
          else resolvedScope = resolved.scope;
        }
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
        resolved_scope: resolvedScope,
        role_ids: roleIds,
        valid: errors.length === 0,
        errors,
        warnings,
      });
    }

    const validRows = rows.filter((r) => r.valid);
    let importedCount = 0;

    if (!dryRun && validRows.length > 0) {
      for (const r of validRows) {
        const scope = r.resolved_scope!;
        // Each account gets its own random one-off password, sent only to that user
        const tempPassword = generateTemporaryPassword();
        const passHash = await bcrypt.hash(tempPassword, 10);

        const inserted = await db`
          INSERT INTO admin_users (
            username, email, password_hash, full_name, staff_id, phone,
            mda_id, department_id, scope_level, role, is_active, status, notes,
            created_at, updated_at
          )
          VALUES (
            ${r.username}, ${r.email.toLowerCase()}, ${passHash}, ${r.full_name}, ${r.staff_id}, ${r.phone || null},
            ${scope.companyId}, ${scope.departmentId}, ${scope.level},
            'admin', TRUE, 'active', 'Imported via CSV bulk upload', NOW(), NOW()
          )
          RETURNING id
        `;
        const newId = inserted[0]?.id;
        if (!newId) continue;

        for (const roleId of r.role_ids) {
          await db`
            INSERT INTO user_roles (user_id, role_id, scope_level, company_id, department_id, assigned_by, reason)
            VALUES (${String(newId)}, ${roleId}, ${scope.level}, ${scope.companyId}, ${scope.departmentId}, ${ctx.userId}, ${reason || "Bulk CSV Import"})
            ON CONFLICT DO NOTHING
          `;
        }
        importedCount++;

        const company = scope.companyId ? allCompanies.find((c) => Number(c.id) === scope.companyId) : undefined;
        const dept = scope.departmentId ? allDepartments.find((d) => Number(d.id) === scope.departmentId) : undefined;
        const roleName = allRoles.find((ro) => r.role_ids.includes(Number(ro.id)))?.name;
        sendEmployeeCredentialsEmail({
          to: r.email.toLowerCase(),
          fullName: r.full_name,
          username: r.username,
          temporaryPassword: tempPassword,
          staffId: r.staff_id,
          roleName: roleName ? String(roleName) : undefined,
          mdaName: company ? String(company.name) : undefined,
          departmentName: dept ? String(dept.name) : undefined,
          loginUrl: `${process.env.NEXT_PUBLIC_FRONTEND_URL || "https://ippis-frontend.vercel.app"}/login`,
        }).catch((e) => console.error(`[Bulk Import Email] Failed for ${r.email}:`, e));
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
