import { neon } from "@neondatabase/serverless";

const db = neon(process.env.DATABASE_URL!);

export type UserStatus = "active" | "suspended" | "deactivated" | "pending";
export type DataScopeLevel = "all_mdas" | "assigned_mda" | "department" | "sub_unit";

export interface UserRoleRecord {
  id: number;
  name: string;
  description?: string | null;
  key?: string | null;
  scope_level?: string | null;
  company_id?: number | null;
  department_id?: number | null;
  company_name?: string | null;
  department_name?: string | null;
}

export interface FormattedUserAccount {
  id: string | number;
  username: string;
  email: string;
  full_name: string;
  staff_id: string;
  phone?: string;
  status: UserStatus;
  roles: UserRoleRecord[];
  role_ids: number[];
  mda_id?: number | null;
  mda_name?: string;
  department_id?: number | null;
  department_name?: string;
  scope_level: DataScopeLevel;
  accessible_modules?: string[];
  last_login?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Normalizes DB / input scope levels into frontend DataScopeLevel
 */
export function normalizeScopeToFrontend(scope?: string | null): DataScopeLevel {
  if (!scope) return "assigned_mda";
  const s = scope.toLowerCase();
  if (s === "global" || s === "all_mdas") return "all_mdas";
  if (s === "mda" || s === "assigned_mda") return "assigned_mda";
  if (s === "department") return "department";
  if (s === "self" || s === "sub_unit") return "sub_unit";
  return "assigned_mda";
}

/**
 * Normalizes frontend DataScopeLevel to backend RBAC scope level
 */
export function normalizeScopeToBackend(scope?: string | null): "global" | "mda" | "department" | "self" {
  if (!scope) return "mda";
  const s = scope.toLowerCase();
  if (s === "all_mdas" || s === "global") return "global";
  if (s === "assigned_mda" || s === "mda") return "mda";
  if (s === "department") return "department";
  if (s === "sub_unit" || s === "self") return "self";
  return "mda";
}

/**
 * Resolves scope_level, company_id, and department_id ensuring PostgreSQL
 * user_roles_scope_check constraint is always strictly satisfied:
 * - global: company_id is NULL, department_id is NULL
 * - mda: company_id is NOT NULL, department_id is NULL
 * - department: company_id is NOT NULL, department_id is NOT NULL
 * - self: company_id is NULL, department_id is NULL
 */
export function resolveValidScope(
  requestedScope?: string | null,
  companyId?: number | null,
  departmentId?: number | null
): { scope_level: "global" | "mda" | "department" | "self"; company_id: number | null; department_id: number | null } {
  const norm = normalizeScopeToBackend(requestedScope);
  const comp = companyId && !isNaN(Number(companyId)) && Number(companyId) > 0 ? Number(companyId) : null;
  const dept = departmentId && !isNaN(Number(departmentId)) && Number(departmentId) > 0 ? Number(departmentId) : null;

  if (norm === "department") {
    if (comp && dept) {
      return { scope_level: "department", company_id: comp, department_id: dept };
    }
    if (comp) {
      return { scope_level: "mda", company_id: comp, department_id: null };
    }
    return { scope_level: "global", company_id: null, department_id: null };
  }

  if (norm === "mda") {
    if (comp) {
      return { scope_level: "mda", company_id: comp, department_id: null };
    }
    return { scope_level: "global", company_id: null, department_id: null };
  }

  return { scope_level: norm, company_id: null, department_id: null };
}

/**
 * Computes accessible top-level modules based on user roles and granular permissions
 */
export function computeAccessibleModules(
  roles: UserRoleRecord[],
  permissions: string[] = []
): string[] {
  const roleNames = roles.map((r) => (r.name || "").toLowerCase());
  const roleKeys = roles.map((r) => (r.key || "").toLowerCase());

  const isSuper =
    roleNames.some((n) => n.includes("super")) ||
    roleKeys.some((k) => k.includes("super"));

  const isCentralAccess =
    isSuper ||
    roleNames.some((n) => n.includes("central access")) ||
    roleKeys.some((k) => k.includes("central_access"));

  const isCentralHr =
    isSuper ||
    roleNames.some((n) => n.includes("central hr")) ||
    roleKeys.some((k) => k.includes("central_hr"));

  const isCentralPayroll =
    isSuper ||
    roleNames.some((n) => n.includes("central payroll")) ||
    roleKeys.some((k) => k.includes("central_payroll"));

  const isMdaAdmin =
    isSuper ||
    roleNames.some((n) => n.includes("mda admin")) ||
    roleKeys.includes("mda_admin");

  const isDeptHead =
    isSuper ||
    roleNames.some((n) => n.includes("department head") || n.includes("dept head")) ||
    roleKeys.includes("department_head");

  const isHr =
    isSuper ||
    isCentralHr ||
    roleNames.some((n) => n.includes("hr")) ||
    roleKeys.some((k) => k.includes("hr"));

  const isPayroll =
    isSuper ||
    isCentralPayroll ||
    roleNames.some((n) => n.includes("payroll")) ||
    roleKeys.some((k) => k.includes("payroll"));

  const isFinance =
    isSuper ||
    roleNames.some((n) => n.includes("finance") || n.includes("account")) ||
    roleKeys.some((k) => k.includes("finance"));

  const isAuditor =
    isSuper ||
    roleNames.some((n) => n.includes("audit")) ||
    roleKeys.some((k) => k.includes("audit") || k.includes("auditor"));

  const isReporting =
    isSuper ||
    roleNames.some((n) => n.includes("reporting")) ||
    roleKeys.some((k) => k.includes("reporting"));

  const isHelpdesk =
    isSuper ||
    roleNames.some((n) => n.includes("helpdesk") || n.includes("support")) ||
    roleKeys.some((k) => k.includes("helpdesk"));

  const isEmployee =
    roleNames.some((n) => n.includes("employee") || n.includes("self-service")) ||
    roleKeys.some((k) => k.includes("employee"));

  const isApplicant =
    roleNames.some((n) => n.includes("applicant")) ||
    roleKeys.some((k) => k.includes("applicant"));

  // Applicants who submitted an application can only access Application Status
  if (isApplicant && !isSuper) {
    return [
      "Dashboard",
      "dashboard",
      "/admin",
      "Application Status",
      "application-status",
      "/admin/application-status",
    ];
  }

  // Pure Employee Self-Service users (without administrative roles)
  const isPureEmployee =
    isEmployee &&
    !isSuper &&
    !isCentralAccess &&
    !isCentralHr &&
    !isCentralPayroll &&
    !isMdaAdmin &&
    !isDeptHead &&
    !isHr &&
    !isPayroll &&
    !isFinance &&
    !isAuditor &&
    !isReporting &&
    !isHelpdesk;

  if (isPureEmployee) {
    return [
      "Dashboard",
      "dashboard",
      "/admin",
      "Overview",
      "Profile",
      "My Profile",
      "profile",
      "Attendance",
      "attendance",
      "Timesheets",
      "timesheets",
      "/admin/timesheets",
      "Leaves",
      "Leave Management",
      "leaves",
      "/admin/leaves",
      "Payroll",
      "Payslips",
      "payroll",
      "/admin/payroll",
      "Tasks",
      "Project Management",
      "project-management",
      "/admin/project-management",
      "Documents",
      "Document Management",
      "documents",
      "/admin/documents",
      "Notifications",
      "Announcements",
      "notifications",
      "/admin/notifications",
    ];
  }

  const pSet = new Set(permissions.map((p) => p.toLowerCase()));
  const hasPerm = (prefix: string) => {
    const pLow = prefix.toLowerCase();
    for (const p of pSet) {
      if (p === pLow || p.startsWith(pLow + ".") || p.startsWith(pLow + ":")) return true;
    }
    return false;
  };

  const modules: string[] = ["Dashboard", "dashboard", "/admin"];


  // Employees List
  if (isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || isCentralPayroll || isReporting || hasPerm("employees")) {
    modules.push("Employees", "Employees List", "employees", "employee-list", "/admin/employees");
  }

  // Core HR
  if (isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || hasPerm("corehr") || hasPerm("hr")) {
    modules.push("Core HR", "core-hr", "corehr", "/admin/core-hr");
  }

  // Performance
  if (isSuper || isHr || isDeptHead || isAuditor || hasPerm("performance")) {
    modules.push("Performance", "performance", "/admin/performance");
  }

  // Organization
  if (isSuper || isHr || isMdaAdmin || isAuditor || isCentralAccess || hasPerm("organization")) {
    modules.push("Organization", "organization", "/admin/organization");
  }

  // Timesheets
  if (isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || isEmployee || hasPerm("timesheets") || hasPerm("attendance") || hasPerm("leaves")) {
    modules.push("Timesheets", "timesheets", "/admin/timesheets");
  }

  // HR Calendar
  if (isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || isEmployee || hasPerm("calendar") || hasPerm("events")) {
    modules.push("HR Calendar", "hr-calendar", "calendar", "/admin/hr-calendar");
  }

  // HR Reports
  if (isSuper || isAuditor || isReporting || isHr || isPayroll || isFinance || hasPerm("reports")) {
    modules.push("HR Reports", "Reports", "hr-reports", "reports", "/admin/hr-reports");
  }

  // Recruitment
  if (isSuper || isHr || isAuditor || hasPerm("recruitment")) {
    modules.push("Recruitment", "recruitment", "/admin/recruitment");
  }

  // Training
  if (isSuper || isHr || isDeptHead || isAuditor || hasPerm("training")) {
    modules.push("Training", "training", "/admin/training");
  }

  // Events & Meetings
  if (isSuper || isHr || isDeptHead || isAuditor || hasPerm("events") || hasPerm("calendar")) {
    modules.push("Events & Meetings", "event-meetings", "events-meetings", "/admin/events-meetings");
  }

  // Payroll
  if (isSuper || isPayroll || isAuditor || hasPerm("payroll")) {
    modules.push("Payroll", "payroll", "/admin/payroll");
  }

  // Project Management
  if (isSuper || isDeptHead || isAuditor || hasPerm("projects")) {
    modules.push("Project Management", "project-managment", "project-management", "/admin/project-management");
  }

  // Support Tickets
  if (isSuper || isHelpdesk || isCentralAccess || isHr || isPayroll || isEmployee || hasPerm("support") || hasPerm("tickets")) {
    modules.push("Support Tickets", "support-tickets", "support", "/admin/support-tickets");
  }

  // Finance
  if (isSuper || isFinance || isPayroll || isAuditor || hasPerm("finance")) {
    modules.push("Finance", "finance", "/admin/finance");
  }

  // Assets
  if (isSuper || isAuditor || hasPerm("assets")) {
    modules.push("Assets", "assets", "/admin/assets");
  }

  // File Manager
  if (isSuper || isCentralHr || isMdaAdmin || isAuditor || hasPerm("files")) {
    modules.push("File Manager", "file-manager", "files", "/admin/file-manager");
  }

  // User Management
  if (isSuper || isCentralAccess || isMdaAdmin || isHelpdesk || hasPerm("users")) {
    modules.push("User Management", "users", "/admin/users");
  }

  // Roles
  if (isSuper || isCentralAccess || isMdaAdmin || hasPerm("access.roles") || hasPerm("roles")) {
    modules.push("Roles", "roles", "/admin/roles");
  }

  // Permissions
  if (isSuper || isCentralAccess || hasPerm("access.permissions") || hasPerm("permissions")) {
    modules.push("Permissions", "permissions", "/admin/permissions");
  }

  // Settings
  if (isSuper || isCentralAccess || hasPerm("settings")) {
    modules.push("Settings", "settings", "/admin/settings");
  }

  // Backup Database
  if (isSuper || hasPerm("system.database") || hasPerm("database")) {
    modules.push("Backup Database", "backup", "/admin/backup");
  }

  return Array.from(new Set(modules));
}

/**
 * Computes detailed module access entries for effective access drawer
 */
export function computeDetailedModuleAccess(
  roles: UserRoleRecord[],
  permissions: string[] = []
) {
  const roleNames = roles.map((r) => (r.name || "").toLowerCase());
  const roleKeys = roles.map((r) => (r.key || "").toLowerCase());

  const isSuper =
    roleNames.some((n) => n.includes("super")) ||
    roleKeys.some((k) => k.includes("super"));

  const isCentralAccess =
    isSuper ||
    roleNames.some((n) => n.includes("central access")) ||
    roleKeys.some((k) => k.includes("central_access"));

  const isCentralHr =
    isSuper ||
    roleNames.some((n) => n.includes("central hr")) ||
    roleKeys.some((k) => k.includes("central_hr"));

  const isCentralPayroll =
    isSuper ||
    roleNames.some((n) => n.includes("central payroll")) ||
    roleKeys.some((k) => k.includes("central_payroll"));

  const isMdaAdmin =
    isSuper ||
    roleNames.some((n) => n.includes("mda admin")) ||
    roleKeys.includes("mda_admin");

  const isDeptHead =
    isSuper ||
    roleNames.some((n) => n.includes("department head") || n.includes("dept head")) ||
    roleKeys.includes("department_head");

  const isHr =
    isSuper ||
    isCentralHr ||
    roleNames.some((n) => n.includes("hr")) ||
    roleKeys.some((k) => k.includes("hr"));

  const isPayroll =
    isSuper ||
    isCentralPayroll ||
    roleNames.some((n) => n.includes("payroll")) ||
    roleKeys.some((k) => k.includes("payroll"));

  const isFinance =
    isSuper ||
    roleNames.some((n) => n.includes("finance") || n.includes("account")) ||
    roleKeys.some((k) => k.includes("finance"));

  const isAuditor =
    isSuper ||
    roleNames.some((n) => n.includes("audit")) ||
    roleKeys.some((k) => k.includes("audit") || k.includes("auditor"));

  const isReporting =
    isSuper ||
    roleNames.some((n) => n.includes("reporting")) ||
    roleKeys.some((k) => k.includes("reporting"));

  const isHelpdesk =
    isSuper ||
    roleNames.some((n) => n.includes("helpdesk") || n.includes("support")) ||
    roleKeys.some((k) => k.includes("helpdesk"));

  const isEmployee =
    roleNames.some((n) => n.includes("employee") || n.includes("self-service")) ||
    roleKeys.some((k) => k.includes("employee"));

  const pSet = new Set(permissions.map((p) => p.toLowerCase()));
  const hasPerm = (prefix: string) => {
    const pLow = prefix.toLowerCase();
    for (const p of pSet) {
      if (p === pLow || p.startsWith(pLow + ".") || p.startsWith(pLow + ":")) return true;
    }
    return false;
  };

  return [
    {
      name: "Dashboard & Analytics",
      accessible: true,
      access_level: "Full Access",
      resource: "dashboard",
    },
    {
      name: "Employee Management",
      accessible: isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || isCentralPayroll || isReporting || hasPerm("employees"),
      access_level: isSuper || isHr ? "Full Management" : isMdaAdmin ? "MDA Scope Only" : isAuditor ? "Audit Read-Only" : "View Records",
      resource: "employees",
    },
    {
      name: "Payroll Operations",
      accessible: isSuper || isPayroll || isAuditor || hasPerm("payroll"),
      access_level: isSuper || isCentralPayroll ? "Full Oversight & Approval" : isPayroll ? "Preparation & Processing" : "Audit Review",
      resource: "payroll",
    },
    {
      name: "Core HR & Approvals",
      accessible: isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || hasPerm("corehr") || hasPerm("hr"),
      access_level: isSuper ? "Universal Approval" : isMdaAdmin || isDeptHead ? "Unit / Department Scope" : "HR Processing",
      resource: "core-hr",
    },
    {
      name: "Finance & Accounts",
      accessible: isSuper || isFinance || isPayroll || isAuditor || hasPerm("finance"),
      access_level: isSuper ? "Full Financial Control" : isFinance ? "Disbursement & Accounting" : "Ledger Audit",
      resource: "finance",
    },
    {
      name: "HR Reports & Compliance",
      accessible: isSuper || isAuditor || isReporting || isHr || isPayroll || isFinance || hasPerm("reports"),
      access_level: isAuditor ? "Full Audit Read-Out" : isSuper || isReporting ? "Complete Statutory Reports" : "Operational Reports",
      resource: "hr-reports",
    },
    {
      name: "Organization Structure",
      accessible: isSuper || isHr || isMdaAdmin || isAuditor || isCentralAccess || hasPerm("organization"),
      access_level: isSuper ? "Full Structure Configuration" : "Unit / MDA View",
      resource: "organization",
    },
    {
      name: "Timesheets & Attendance",
      accessible: isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || isEmployee || hasPerm("timesheets"),
      access_level: isSuper || isHr ? "Full Management" : isDeptHead ? "Department Approvals" : "Self-Service",
      resource: "timesheets",
    },
    {
      name: "HR Calendar & Leaves",
      accessible: isSuper || isHr || isMdaAdmin || isDeptHead || isAuditor || isEmployee || hasPerm("calendar"),
      access_level: isSuper || isHr ? "Full Calendar Management" : "View Events & Leaves",
      resource: "hr-calendar",
    },
    {
      name: "Recruitment & Onboarding",
      accessible: isSuper || isHr || isAuditor || hasPerm("recruitment"),
      access_level: isSuper || isHr ? "Full Recruitment Cycle" : "Audit Review",
      resource: "recruitment",
    },
    {
      name: "Training & Development",
      accessible: isSuper || isHr || isDeptHead || isAuditor || hasPerm("training"),
      access_level: isSuper || isHr ? "Program Coordination" : "Nomination & View",
      resource: "training",
    },
    {
      name: "Support Tickets & Helpdesk",
      accessible: isSuper || isHelpdesk || isCentralAccess || isHr || isPayroll || isEmployee || hasPerm("support") || hasPerm("tickets"),
      access_level: isSuper || isHelpdesk ? "Ticket Resolution & Escalation" : "Submit & Track",
      resource: "support-tickets",
    },
    {
      name: "User Management & Security",
      accessible: isSuper || isCentralAccess || isMdaAdmin || hasPerm("users"),
      access_level: isSuper ? "Full Administration" : isCentralAccess ? "Provisioning & Roles" : isMdaAdmin ? "MDA Account Management" : "No Access",
      resource: "users",
    },
    {
      name: "Role & Permission Configuration",
      accessible: isSuper || isCentralAccess || hasPerm("access.roles") || hasPerm("access.permissions"),
      access_level: isSuper ? "Full RBAC Management" : isCentralAccess ? "Role Assignment" : "No Access",
      resource: "permissions",
    },
    {
      name: "Database Backup & Restore",
      accessible: isSuper || hasPerm("system.database"),
      access_level: isSuper ? "Full Database Operations" : "No Access",
      resource: "backup",
    },
  ];
}

/**
 * Loads role maps for an array of user IDs
 */
export async function loadUserRolesMap(userIds: (string | number)[]): Promise<Record<string, UserRoleRecord[]>> {
  if (userIds.length === 0) return {};
  const strIds = userIds.map(String);

  const rows = await db`
    SELECT ur.user_id, r.id AS role_id, r.name, r.description, r.key,
           ur.scope_level, ur.company_id, ur.department_id,
           c.name AS company_name, d.name AS department_name
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
    LEFT JOIN companies c ON c.id = ur.company_id
    LEFT JOIN departments d ON d.id = ur.department_id
    WHERE ur.user_id = ANY(${strIds})
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    ORDER BY ur.assigned_at ASC
  `;

  const map: Record<string, UserRoleRecord[]> = {};
  for (const row of rows) {
    const uid = String(row.user_id);
    if (!map[uid]) map[uid] = [];
    map[uid].push({
      id: Number(row.role_id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      key: row.key ? String(row.key) : null,
      scope_level: row.scope_level ? String(row.scope_level) : null,
      company_id: row.company_id == null ? null : Number(row.company_id),
      department_id: row.department_id == null ? null : Number(row.department_id),
      company_name: row.company_name ? String(row.company_name) : null,
      department_name: row.department_name ? String(row.department_name) : null,
    });
  }

  return map;
}

/**
 * Formats a raw admin_users row into a rich FormattedUserAccount
 */
export function formatUserAccount(
  row: Record<string, any>,
  userRoles: UserRoleRecord[] = [],
  allRolesFallback: UserRoleRecord[] = []
): FormattedUserAccount {
  const userId = Number(row.id);
  let effectiveRoles = userRoles;

  // Fallback if no user_roles assigned yet: deduce from legacy row.role column
  if (effectiveRoles.length === 0) {
    const legacyRoleStr = String(row.role || "").toLowerCase();
    const matched = allRolesFallback.find((r) => {
      const nameLower = (r.name || "").toLowerCase();
      const keyLower = (r.key || "").toLowerCase();
      if (legacyRoleStr.includes("super") && (nameLower.includes("super") || keyLower.includes("super"))) return true;
      if (legacyRoleStr === "admin" && (nameLower.includes("mda admin") || keyLower === "mda_admin")) return true;
      if (legacyRoleStr === "viewer" && (nameLower.includes("auditor") || keyLower.includes("auditor"))) return true;
      return nameLower === legacyRoleStr || keyLower === legacyRoleStr;
    });

    if (matched) {
      effectiveRoles = [matched];
    } else if (allRolesFallback[0]) {
      effectiveRoles = [allRolesFallback[0]];
    } else {
      effectiveRoles = [{ id: 1, name: row.role || "Admin", key: "admin" }];
    }
  }

  const roleIds = effectiveRoles.map((r) => Number(r.id));
  const mdaId = row.mda_id != null ? Number(row.mda_id) : effectiveRoles[0]?.company_id ?? null;
  const mdaName = row.mda_name || effectiveRoles[0]?.company_name || "";
  const deptId = row.department_id != null ? Number(row.department_id) : effectiveRoles[0]?.department_id ?? null;
  const deptName = row.department_name || effectiveRoles[0]?.department_name || "";

  let status: UserStatus = "active";
  if (row.status) {
    status = row.status as UserStatus;
  } else if (row.is_active === false) {
    status = "deactivated";
  }

  const scopeLevel = normalizeScopeToFrontend(row.scope_level || effectiveRoles[0]?.scope_level);
  const accessibleModules = computeAccessibleModules(effectiveRoles);

  return {
    id: userId,
    username: String(row.username || ""),
    email: String(row.email || ""),
    full_name: String(row.full_name || row.username || ""),
    staff_id: String(row.staff_id || `IPPIS-STAFF-${1000 + userId}`),
    phone: row.phone ? String(row.phone) : "",
    status,
    roles: effectiveRoles,
    role_ids: roleIds,
    mda_id: mdaId,
    mda_name: mdaName,
    department_id: deptId,
    department_name: deptName,
    scope_level: scopeLevel,
    accessible_modules: accessibleModules,
    last_login: row.last_login ? new Date(row.last_login).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}
