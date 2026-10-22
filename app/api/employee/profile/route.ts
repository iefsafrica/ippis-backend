import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { EDITABLE_FIELDS, MARITAL_STATUSES, currentProfileValues, type ProfileValues } from "@/lib/employee-profile";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Dates are selected as text (YYYY-MM-DD) so no time zone can shift them by a day
function dateOnly(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function maskAccount(value: unknown): string | null {
  const text = value == null ? "" : String(value);
  return text.length > 4 ? `${"*".repeat(text.length - 4)}${text.slice(-4)}` : text || null;
}

// The signed-in employee's own record. Personal and employment details come
// from their onboarding registration; contact details reflect any changes HR
// has approved through the portal.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    let personal: Record<string, any> | null = null;
    let employment: Record<string, any> | null = null;

    if (employee.registrationId) {
      try {
        const rows = await db`
          SELECT title, surname, first_name, other_names, phone_number, email, date_of_birth::date::text AS date_of_birth, sex,
                 marital_status, state_of_origin, lga, state_of_residence, address_state_of_residence,
                 next_of_kin_name, next_of_kin_relationship, next_of_kin_phone_number, next_of_kin_address
          FROM personal_info WHERE registration_id = ${employee.registrationId}
        `;
        personal = rows[0] ?? null;
      } catch (error) {
        console.error("EMPLOYEE PROFILE personal_info:", error);
      }

      try {
        const rows = await db`
          SELECT employment_id_no, service_no, file_no, rank_position, department, organization,
                 employment_type, work_location, date_of_first_appointment::date::text AS date_of_first_appointment, gl, step, cadre,
                 salary_structure, name_of_bank, account_number, pfa_name
          FROM employment_info WHERE registration_id = ${employee.registrationId}
        `;
        employment = rows[0] ?? null;
      } catch (error) {
        console.error("EMPLOYEE PROFILE employment_info:", error);
      }
    }

    // Contact details, the open change request and emergency contacts come from
    // the portal tables; if those are missing the profile still loads.
    let current: ProfileValues | null = null;
    let pendingChangeRequest: Record<string, any> | null = null;
    let emergencyContacts: Record<string, any>[] = [];
    try {
      current = await currentProfileValues(employee.id);
      const pending = await db`
        SELECT id, changes, employee_note, created_at
        FROM employee_profile_change_requests
        WHERE employee_id = ${employee.id} AND status = 'pending'
      `;
      pendingChangeRequest = pending[0] ?? null;
      emergencyContacts = await db`
        SELECT id, name, relationship, phone, alternate_phone, email, address, is_primary
        FROM employee_emergency_contacts
        WHERE employee_id = ${employee.id}
        ORDER BY is_primary DESC, created_at ASC
      `;
    } catch (error) {
      console.error("EMPLOYEE PROFILE portal tables:", error);
    }

    // The MDA and department the employee is linked to (empty until HR links them)
    let mda: { id: number; name: string; code: string | null } | null = null;
    let linkedDepartment: { id: number; name: string } | null = null;
    try {
      const rows = await db`
        SELECT c.id AS mda_id, c.name AS mda_name, c.company_code, d.id AS dept_id, d.name AS dept_name
        FROM employees e
        LEFT JOIN companies c ON c.id = e.company_id
        LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.id = ${employee.id}
      `;
      const link = rows[0];
      if (link?.mda_id != null) mda = { id: Number(link.mda_id), name: String(link.mda_name), code: link.company_code ?? null };
      if (link?.dept_id != null) linkedDepartment = { id: Number(link.dept_id), name: String(link.dept_name) };
    } catch (error) {
      console.error("EMPLOYEE PROFILE mda link:", error);
    }

    return withCors(req, {
      success: true,
      data: {
        employeeId: employee.id,
        mda,
        name: employee.name,
        email: employee.email,
        department: linkedDepartment?.name ?? employee.department ?? employment?.department ?? null,
        departmentId: linkedDepartment?.id ?? null,
        position: employee.position ?? employment?.rank_position ?? null,
        // No reporting line is recorded anywhere yet
        reportingManager: null,
        employmentStatus: employee.status,
        startDate: dateOnly(employment?.date_of_first_appointment) ?? employee.joinDate,
        contact: {
          phone: current?.phone ?? personal?.phone_number ?? null,
          email: employee.email,
          address: current?.address ?? personal?.address_state_of_residence ?? null,
          stateOfResidence: current?.state_of_residence ?? personal?.state_of_residence ?? null,
        },
        personal: personal
          ? {
              title: personal.title,
              surname: personal.surname,
              firstName: personal.first_name,
              otherNames: personal.other_names,
              dateOfBirth: dateOnly(personal.date_of_birth),
              sex: personal.sex,
              maritalStatus: current?.marital_status ?? personal.marital_status,
              stateOfOrigin: personal.state_of_origin,
              lga: personal.lga,
            }
          : null,
        nextOfKin: {
          name: current?.next_of_kin_name ?? personal?.next_of_kin_name ?? null,
          relationship: current?.next_of_kin_relationship ?? personal?.next_of_kin_relationship ?? null,
          phone: current?.next_of_kin_phone ?? personal?.next_of_kin_phone_number ?? null,
          address: current?.next_of_kin_address ?? personal?.next_of_kin_address ?? null,
        },
        emergencyContacts,
        pendingChangeRequest,
        // What the portal lets the employee ask to change; everything else goes through HR
        editableFields: EDITABLE_FIELDS,
        maritalStatusOptions: MARITAL_STATUSES,
        employment: employment
          ? {
              employmentNumber: employment.employment_id_no,
              serviceNumber: employment.service_no,
              fileNumber: employment.file_no,
              organization: employment.organization,
              employmentType: employment.employment_type,
              workLocation: employment.work_location,
              gradeLevel: employment.gl,
              step: employment.step,
              cadre: employment.cadre,
              salaryStructure: employment.salary_structure,
              bank: employment.name_of_bank,
              accountNumber: maskAccount(employment.account_number),
              pensionFundAdministrator: employment.pfa_name,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("EMPLOYEE PROFILE ERROR:", error);
    return withCors(req, { success: false, error: "Failed to load your profile" }, 500);
  }
}
