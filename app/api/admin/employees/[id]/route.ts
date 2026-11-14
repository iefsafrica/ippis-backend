import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { recordScope, inScope, OUT_OF_SCOPE } from "@/lib/mda-scope";
import { clientIp } from "@/lib/rate-limit";
import { sendTerminationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function normalizeDate(val: unknown): string | null {
  if (val == null || val === "") return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return s;
}

const FIELD_LABELS: Record<string, string> = {
  firstname: "First Name",
  surname: "Surname",
  middlename: "Middle Name",
  email: "Email Address",
  telephoneno: "Telephone Number",
  birthdate: "Date of Birth",
  gender: "Gender",
  maritalstatus: "Marital Status",
  mda: "MDA / Organization",
  department: "Department",
  position: "Position",
  grade_level: "Grade Level",
  step: "Step",
  status: "Employment Status",
  state_of_origin: "State of Origin",
  residence_address: "Residential Address",
  next_of_kin_name: "Next of Kin Name",
  next_of_kin_relationship: "Next of Kin Relationship",
  next_of_kin_phone_number: "Next of Kin Phone",
  next_of_kin_address: "Next of Kin Address",
};

async function fetchEmployeeRecord(id: string) {
  const rows = await sql`
    SELECT 
      e.*,
      c.name AS mda_name,
      d.name AS dept_name,
      p.first_name AS p_first_name,
      p.surname AS p_surname,
      p.other_names AS p_other_names,
      p.email AS p_email,
      p.phone_number AS p_phone,
      p.date_of_birth AS p_date_of_birth,
      p.sex AS p_sex,
      p.marital_status AS p_marital_status,
      p.state_of_origin AS p_state_of_origin,
      p.address_state_of_residence AS p_address,
      p.next_of_kin_name AS p_nok_name,
      p.next_of_kin_relationship AS p_nok_rel,
      p.next_of_kin_phone_number AS p_nok_phone,
      p.next_of_kin_address AS p_nok_address,
      em.rank_position AS em_rank_position,
      em.department AS em_department,
      em.organization AS em_organization,
      em.gl AS em_gl,
      em.step AS em_step,
      ci.phone AS ci_phone,
      ci.address AS ci_address,
      ci.marital_status AS ci_marital_status,
      ci.next_of_kin_name AS ci_nok_name,
      ci.next_of_kin_relationship AS ci_nok_rel,
      ci.next_of_kin_phone AS ci_nok_phone,
      ci.next_of_kin_address AS ci_nok_address
    FROM employees e
    LEFT JOIN companies c ON c.id = e.company_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN personal_info p ON (p.registration_id = e.registration_id OR p.registration_id = e.id)
    LEFT JOIN employment_info em ON (em.registration_id = e.registration_id OR em.registration_id = e.id)
    LEFT JOIN employee_contact_info ci ON ci.employee_id = e.id
    WHERE e.id = ${id} OR e.registration_id = ${id}
    LIMIT 1
  `;

  return rows[0] || null;
}

function assembleEmployeeData(row: any) {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, any>;
  const nameParts = (row.name || "").trim().split(/\s+/);

  const firstname = row.p_first_name || meta.firstname || meta.first_name || nameParts[0] || "";
  const surname = row.p_surname || meta.surname || meta.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");
  const middlename = row.p_other_names || meta.middlename || meta.middle_name || "";

  const rawDob = row.p_date_of_birth || meta.birthdate || meta.date_of_birth || null;
  const birthdate = normalizeDate(rawDob);

  const telephoneno = row.ci_phone || row.p_phone || meta.telephoneno || meta.phone || meta.phone_number || "";
  const email = row.email || row.p_email || meta.email || "";
  const gender = row.p_sex || meta.gender || meta.sex || "Unspecified";
  const maritalstatus = row.p_marital_status || row.ci_marital_status || meta.maritalstatus || meta.marital_status || "Single";
  const mda = row.mda_name || row.em_organization || meta.mda || "Federal Public Service";
  const department = row.dept_name || row.department || row.em_department || meta.department || "";
  const position = row.position || row.em_rank_position || meta.position || "";
  const grade_level = row.em_gl || meta.grade_level || meta.gl || "";
  const step = row.em_step || meta.step || "";
  const status = row.status || "active";
  const state_of_origin = row.p_state_of_origin || meta.state_of_origin || "";
  const residence_address = row.ci_address || row.p_address || meta.residence_address || meta.address || "";
  const next_of_kin_name = row.ci_nok_name || row.p_nok_name || meta.next_of_kin_name || "";
  const next_of_kin_relationship = row.ci_nok_rel || row.p_nok_rel || meta.next_of_kin_relationship || "";
  const next_of_kin_phone_number = row.ci_nok_phone || row.p_nok_phone || meta.next_of_kin_phone_number || "";
  const next_of_kin_address = row.ci_nok_address || row.p_nok_address || meta.next_of_kin_address || "";
  const updated_at = row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString();

  return {
    id: String(row.id),
    employee_id: String(row.id),
    firstname,
    surname,
    middlename,
    email,
    telephoneno,
    birthdate,
    date_of_birth: birthdate,
    gender,
    maritalstatus,
    mda,
    department,
    position,
    grade_level,
    step,
    status,
    state_of_origin,
    residence_address,
    next_of_kin_name,
    next_of_kin_relationship,
    next_of_kin_phone_number,
    next_of_kin_address,
    updated_at,
  };
}

// 1. GET: Load full editable employee record
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(req, "employees.records.view");
    if (!auth.ok) return auth.response;

    const params = await props.params;
    const rawId = decodeURIComponent(params.id || "").trim();
    if (!rawId) {
      return withCors(req, { success: false, error: "Employee ID is required" }, 400);
    }

    const row = await fetchEmployeeRecord(rawId);
    if (!row) {
      return withCors(req, { success: false, error: `Employee '${rawId}' not found` }, 404);
    }

    const sc = recordScope(auth.ctx, "employees.records.view");
    const isAllowed = sc.all || row.company_id == null || inScope(sc, row.company_id, row.department_id);
    if (!isAllowed) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);
    }

    const employee = assembleEmployeeData(row);

    return withCors(req, {
      success: true,
      data: employee,
    });
  } catch (error: any) {
    console.error("GET EMPLOYEE DETAILS ERROR:", error);
    return withCors(req, { success: false, error: "Failed to fetch employee", details: error?.message }, 500);
  }
}

// 2. PATCH & PUT: Update employee record with DOB lock on active employees and audit logging
async function handleUpdateEmployee(req: NextRequest, props: { params: Promise<{ id: string }> }, auth: any) {
  try {

    const params = await props.params;
    const rawId = decodeURIComponent(params.id || "").trim();
    if (!rawId) {
      return withCors(req, { success: false, error: "Employee ID is required" }, 400);
    }

    const currentRow = await fetchEmployeeRecord(rawId);
    if (!currentRow) {
      return withCors(req, { success: false, error: `Employee '${rawId}' not found` }, 404);
    }

    const sc = recordScope(auth.ctx, "employees.records.update");
    const isAllowed = sc.all || currentRow.company_id == null || inScope(sc, currentRow.company_id, currentRow.department_id);
    if (!isAllowed) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 403);
    }

    const current = assembleEmployeeData(currentRow);
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;

    // -------------------------------------------------------------
    // DATE OF BIRTH LOCK ENFORCEMENT
    // If the employee's current status is "active", DOB is immutable
    // -------------------------------------------------------------
    const isCurrentActive = String(current.status || "").trim().toLowerCase() === "active";
    const incomingDob = body.birthdate !== undefined ? body.birthdate : body.date_of_birth;

    if (incomingDob !== undefined && incomingDob !== null && String(incomingDob).trim() !== "") {
      const oldDobNorm = normalizeDate(current.birthdate);
      const newDobNorm = normalizeDate(incomingDob);

      if (isCurrentActive && oldDobNorm && newDobNorm && oldDobNorm !== newDobNorm) {
        return withCors(
          req,
          {
            success: false,
            message: "Date of birth cannot be modified for an active employee.",
            error: "Date of birth cannot be modified for an active employee.",
          },
          400
        );
      }
    }

    // Build changes diff
    const incomingMap: Record<string, any> = {
      firstname: body.firstname !== undefined ? body.firstname : body.first_name,
      surname: body.surname !== undefined ? body.surname : body.last_name,
      middlename: body.middlename !== undefined ? body.middlename : body.middle_name,
      email: body.email,
      telephoneno: body.telephoneno !== undefined ? body.telephoneno : (body.phone !== undefined ? body.phone : body.phone_number),
      birthdate: incomingDob,
      gender: body.gender !== undefined ? body.gender : body.sex,
      maritalstatus: body.maritalstatus !== undefined ? body.maritalstatus : body.marital_status,
      mda: body.mda !== undefined ? body.mda : body.organization,
      department: body.department,
      position: body.position !== undefined ? body.position : body.rank_position,
      grade_level: body.grade_level !== undefined ? body.grade_level : body.gl,
      step: body.step,
      status: body.status,
      state_of_origin: body.state_of_origin,
      residence_address: body.residence_address !== undefined ? body.residence_address : body.address,
      next_of_kin_name: body.next_of_kin_name,
      next_of_kin_relationship: body.next_of_kin_relationship,
      next_of_kin_phone_number: body.next_of_kin_phone_number !== undefined ? body.next_of_kin_phone_number : body.next_of_kin_phone,
      next_of_kin_address: body.next_of_kin_address,
    };

    const changes: Array<{
      field: string;
      label: string;
      old_value: any;
      new_value: any;
    }> = [];

    for (const [fieldKey, label] of Object.entries(FIELD_LABELS)) {
      const incomingVal = incomingMap[fieldKey];
      if (incomingVal === undefined) continue;

      const currentVal = (current as any)[fieldKey];

      // Normalize dates or strings
      const normOld = fieldKey === "birthdate" ? normalizeDate(currentVal) : String(currentVal ?? "").trim();
      const normNew = fieldKey === "birthdate" ? normalizeDate(incomingVal) : String(incomingVal ?? "").trim();

      if (normOld !== normNew) {
        changes.push({
          field: fieldKey,
          label,
          old_value: currentVal || "",
          new_value: incomingVal,
        });
      }
    }

    // Determine target company / department IDs if MDA/department updated
    let newCompanyId = currentRow.company_id;
    let newDepartmentId = currentRow.department_id;

    if (body.company_id && Number.isInteger(Number(body.company_id))) {
      newCompanyId = Number(body.company_id);
    } else if (body.mda && typeof body.mda === "string") {
      const compRows = await sql`
        SELECT id FROM companies 
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(${body.mda})) OR company_code = ${body.mda} 
        LIMIT 1
      `;
      if (compRows[0]) newCompanyId = compRows[0].id;
    }

    if (body.department_id && Number.isInteger(Number(body.department_id))) {
      newDepartmentId = Number(body.department_id);
    } else if (body.department && typeof body.department === "string") {
      const deptRows = await sql`
        SELECT id FROM departments 
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(${body.department})) 
        LIMIT 1
      `;
      if (deptRows[0]) newDepartmentId = deptRows[0].id;
    }

    // Construct updated name
    const newFirst = incomingMap.firstname !== undefined ? String(incomingMap.firstname).trim() : current.firstname;
    const newMiddle = incomingMap.middlename !== undefined ? String(incomingMap.middlename).trim() : current.middlename;
    const newSurname = incomingMap.surname !== undefined ? String(incomingMap.surname).trim() : current.surname;
    const newFullName = [newFirst, newMiddle, newSurname].filter(Boolean).join(" ") || currentRow.name;

    const newEmail = incomingMap.email !== undefined ? String(incomingMap.email).trim() : currentRow.email;
    const newDept = incomingMap.department !== undefined ? String(incomingMap.department).trim() : currentRow.department;
    const newPos = incomingMap.position !== undefined ? String(incomingMap.position).trim() : currentRow.position;
    const newStatus = incomingMap.status !== undefined ? String(incomingMap.status).trim().toLowerCase() : currentRow.status;

    // Merge updated metadata
    const existingMeta = (currentRow.metadata && typeof currentRow.metadata === "object" ? currentRow.metadata : {}) as Record<string, any>;
    const updatedMeta = {
      ...existingMeta,
      firstname: newFirst,
      surname: newSurname,
      middlename: newMiddle,
      telephoneno: incomingMap.telephoneno !== undefined ? incomingMap.telephoneno : current.telephoneno,
      birthdate: incomingMap.birthdate !== undefined ? normalizeDate(incomingMap.birthdate) : current.birthdate,
      date_of_birth: incomingMap.birthdate !== undefined ? normalizeDate(incomingMap.birthdate) : current.birthdate,
      gender: incomingMap.gender !== undefined ? incomingMap.gender : current.gender,
      maritalstatus: incomingMap.maritalstatus !== undefined ? incomingMap.maritalstatus : current.maritalstatus,
      mda: incomingMap.mda !== undefined ? incomingMap.mda : current.mda,
      department: newDept,
      position: newPos,
      grade_level: incomingMap.grade_level !== undefined ? incomingMap.grade_level : current.grade_level,
      step: incomingMap.step !== undefined ? incomingMap.step : current.step,
      status: newStatus,
      state_of_origin: incomingMap.state_of_origin !== undefined ? incomingMap.state_of_origin : current.state_of_origin,
      residence_address: incomingMap.residence_address !== undefined ? incomingMap.residence_address : current.residence_address,
      next_of_kin_name: incomingMap.next_of_kin_name !== undefined ? incomingMap.next_of_kin_name : current.next_of_kin_name,
      next_of_kin_relationship: incomingMap.next_of_kin_relationship !== undefined ? incomingMap.next_of_kin_relationship : current.next_of_kin_relationship,
      next_of_kin_phone_number: incomingMap.next_of_kin_phone_number !== undefined ? incomingMap.next_of_kin_phone_number : current.next_of_kin_phone_number,
      next_of_kin_address: incomingMap.next_of_kin_address !== undefined ? incomingMap.next_of_kin_address : current.next_of_kin_address,
    };

    // 1. Update `employees` table
    await sql`
      UPDATE employees
      SET 
        name = ${newFullName},
        email = ${newEmail},
        department = ${newDept},
        position = ${newPos},
        status = ${newStatus},
        company_id = ${newCompanyId},
        department_id = ${newDepartmentId},
        metadata = ${JSON.stringify(updatedMeta)}::jsonb,
        updated_at = NOW()
      WHERE id = ${currentRow.id}
    `;

    // 2. Upsert `employee_contact_info`
    const phoneVal = incomingMap.telephoneno !== undefined ? incomingMap.telephoneno : current.telephoneno;
    const addrVal = incomingMap.residence_address !== undefined ? incomingMap.residence_address : current.residence_address;
    const maritalVal = incomingMap.maritalstatus !== undefined ? incomingMap.maritalstatus : current.maritalstatus;
    const nokName = incomingMap.next_of_kin_name !== undefined ? incomingMap.next_of_kin_name : current.next_of_kin_name;
    const nokRel = incomingMap.next_of_kin_relationship !== undefined ? incomingMap.next_of_kin_relationship : current.next_of_kin_relationship;
    const nokPhone = incomingMap.next_of_kin_phone_number !== undefined ? incomingMap.next_of_kin_phone_number : current.next_of_kin_phone_number;
    const nokAddr = incomingMap.next_of_kin_address !== undefined ? incomingMap.next_of_kin_address : current.next_of_kin_address;

    await sql`
      INSERT INTO employee_contact_info (
        employee_id, phone, address, marital_status,
        next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, next_of_kin_address, updated_at
      ) VALUES (
        ${currentRow.id}, ${phoneVal}, ${addrVal}, ${maritalVal},
        ${nokName}, ${nokRel}, ${nokPhone}, ${nokAddr}, NOW()
      )
      ON CONFLICT (employee_id) DO UPDATE SET
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        marital_status = EXCLUDED.marital_status,
        next_of_kin_name = EXCLUDED.next_of_kin_name,
        next_of_kin_relationship = EXCLUDED.next_of_kin_relationship,
        next_of_kin_phone = EXCLUDED.next_of_kin_phone,
        next_of_kin_address = EXCLUDED.next_of_kin_address,
        updated_at = NOW()
    `;

    // 3. Update `personal_info` if linked
    const regId = currentRow.registration_id || currentRow.id;
    if (regId) {
      await sql`
        UPDATE personal_info
        SET 
          first_name = ${newFirst},
          surname = ${newSurname},
          other_names = ${newMiddle},
          email = ${newEmail},
          phone_number = ${phoneVal},
          sex = ${incomingMap.gender !== undefined ? incomingMap.gender : current.gender},
          marital_status = ${maritalVal},
          state_of_origin = ${incomingMap.state_of_origin !== undefined ? incomingMap.state_of_origin : current.state_of_origin},
          address_state_of_residence = ${addrVal},
          next_of_kin_name = ${nokName},
          next_of_kin_relationship = ${nokRel},
          next_of_kin_phone_number = ${nokPhone},
          next_of_kin_address = ${nokAddr}
        WHERE registration_id = ${regId}
      `;
    }

    // 4. Update `employment_info` if linked
    if (regId) {
      await sql`
        UPDATE employment_info
        SET 
          rank_position = ${newPos},
          department = ${newDept},
          gl = ${incomingMap.grade_level !== undefined ? incomingMap.grade_level : current.grade_level},
          step = ${incomingMap.step !== undefined ? incomingMap.step : current.step}
        WHERE registration_id = ${regId}
      `;
    }

    // 5. Record Audit Trail in `audit_logs`
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "Employee record update";
    const ip = clientIp(req) === "unknown" ? null : clientIp(req);

    if (changes.length > 0) {
      await sql`
        INSERT INTO audit_logs (
          actor_id, actor_username, action, target_type, target_id, reason, details, ip_address, created_at
        ) VALUES (
          ${auth.ctx.userId},
          ${auth.ctx.user.username},
          'UPDATE',
          'employee',
          ${String(currentRow.id)},
          ${reason},
          ${JSON.stringify({ changes })}::jsonb,
          ${ip},
          NOW()
        )
      `;
    }

    // If status transitioned to terminated, trigger official disengagement notification email
    if (newStatus === "terminated" && String(current.status || "").toLowerCase() !== "terminated") {
      const targetEmail = newEmail || current.email;
      if (targetEmail) {
        sendTerminationEmail({
          to: targetEmail,
          fullName: newFullName || current.firstname || "Civil Service Officer",
          employeeId: String(currentRow.id),
          position: newPos || current.position,
          department: newDept || current.department,
          mdaName: current.mda,
          terminationType: typeof body.termination_type === "string" ? body.termination_type : "Standard Termination",
          terminationReason: reason,
          terminationDate: typeof body.termination_date === "string" ? body.termination_date : new Date().toISOString().slice(0, 10),
        }).catch((err) => {
          console.error("Automated status termination email failed:", err);
        });
      }
    }

    // Re-fetch updated employee
    const updatedRow = await fetchEmployeeRecord(currentRow.id);
    const updatedEmployee = assembleEmployeeData(updatedRow || currentRow);

    return withCors(req, {
      success: true,
      message: "Employee record updated successfully",
      data: updatedEmployee,
    });
  } catch (error: any) {
    console.error("UPDATE EMPLOYEE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to update employee", details: error?.message }, 500);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, "employees.records.update");
  if (!auth.ok) return auth.response;
  return handleUpdateEmployee(req, props, auth);
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, "employees.records.update");
  if (!auth.ok) return auth.response;
  return handleUpdateEmployee(req, props, auth);
}

// 4. DELETE: Soft delete employee (optional administrative action)
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(req, "employees.records.delete");
    if (!auth.ok) return auth.response;

    const params = await props.params;
    const rawId = decodeURIComponent(params.id || "").trim();
    if (!rawId) {
      return withCors(req, { success: false, error: "Employee ID is required" }, 400);
    }

    const currentRow = await fetchEmployeeRecord(rawId);
    if (!currentRow) {
      return withCors(req, { success: false, error: `Employee '${rawId}' not found` }, 404);
    }

    const sc = recordScope(auth.ctx, "employees.records.delete");
    const isAllowed = sc.all || currentRow.company_id == null || inScope(sc, currentRow.company_id, currentRow.department_id);
    if (!isAllowed) {
      return withCors(req, { success: false, error: OUT_OF_SCOPE }, 403);
    }

    await sql`
      UPDATE employees
      SET status = 'deleted', updated_at = NOW()
      WHERE id = ${currentRow.id}
    `;

    const ip = clientIp(req) === "unknown" ? null : clientIp(req);
    await sql`
      INSERT INTO audit_logs (
        actor_id, actor_username, action, target_type, target_id, reason, details, ip_address, created_at
      ) VALUES (
        ${auth.ctx.userId},
        ${auth.ctx.user.username},
        'DELETE',
        'employee',
        ${String(currentRow.id)},
        'Employee marked as deleted',
        ${JSON.stringify({ status: "deleted" })}::jsonb,
        ${ip},
        NOW()
      )
    `;

    return withCors(req, {
      success: true,
      message: "Employee deleted successfully",
    });
  } catch (error: any) {
    console.error("DELETE EMPLOYEE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to delete employee", details: error?.message }, 500);
  }
}
