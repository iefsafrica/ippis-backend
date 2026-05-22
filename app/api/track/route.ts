import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import {
  buildRegistrationIdVariants,
  normalizeRegistrationId,
} from "@/lib/registration-id";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function findRegistrationRow(inputId: string) {
  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = await sql`
      SELECT id, registration_id, nin, status, current_step, declaration, created_at, updated_at, submitted_at, approved_at, rejected_at
      FROM registrations
      WHERE registration_id = ${candidate}
      LIMIT 1
    `;

    if (rows.length > 0) {
      return rows[0] as {
        id: number;
        registration_id: string;
        nin: string | null;
        status: string;
        current_step: string;
        declaration: boolean | null;
        created_at: string;
        updated_at: string;
        submitted_at: string | null;
        approved_at: string | null;
        rejected_at: string | null;
      };
    }
  }

  return null;
}

async function findPendingRow(inputId: string) {
  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = await sql`
      SELECT *
      FROM pending_employees
      WHERE registration_id = ${candidate}
      LIMIT 1
    `;

    if (rows.length > 0) {
      return rows[0];
    }
  }

  return null;
}

async function findEmployeeRow(inputId: string) {
  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = await sql`
      SELECT *
      FROM employees
      WHERE id = ${candidate}
         OR email = ${candidate}
         OR registration_id = ${candidate}
      LIMIT 1
    `;

    if (rows.length > 0) {
      return rows[0];
    }
  }

  return null;
}

async function getRegistrationBundleByEmail(email: string) {
  const verification = await sql`
    SELECT registration_id, nin, firstname, surname, email, gender, state_of_origin, profession, telephoneno, created_at, updated_at
    FROM "VerificationData"
    WHERE LOWER(email) = LOWER(${email})
    LIMIT 1
  `;

  const personal = await sql`
    SELECT *
    FROM personal_info
    WHERE LOWER(email) = LOWER(${email})
    LIMIT 1
  `;

  const registrationIdFromVerification = verification[0]?.registration_id;
  const registrationIdFromPersonal = personal[0]?.registration_id;
  const registrationId = registrationIdFromVerification ?? registrationIdFromPersonal ?? null;

  if (!registrationId) {
    return null;
  }

  const registration = await sql`
    SELECT id, registration_id, nin, status, current_step, declaration, created_at, updated_at, submitted_at, approved_at, rejected_at
    FROM registrations
    WHERE id = ${registrationId}
    LIMIT 1
  `;

  if (registration.length === 0) {
    return null;
  }

  const registrationRow = registration[0]!;

  const employment = await sql`
    SELECT *
    FROM employment_info
    WHERE registration_id = ${registrationRow.registration_id}
    LIMIT 1
  `;

  const documents = await sql`
    SELECT *
    FROM document_uploads
    WHERE registration_id = ${registrationRow.registration_id}
    LIMIT 1
  `;

  return {
    registration: registrationRow,
    verification: verification[0] ?? null,
    personal: personal[0] ?? null,
    employment: employment[0] ?? null,
    documents: documents[0] ?? null,
  };
}

async function trackByIdOrEmail(
  id?: string | null,
  email?: string | null
) {
  if (id) {
    const registration = await findRegistrationRow(id);
    if (registration) {
      const [verification, personal, employment, documents] = await Promise.all([
        sql`
          SELECT *
          FROM "VerificationData"
          WHERE registration_id = ${registration.id}
          LIMIT 1
        `,
        sql`
          SELECT *
          FROM personal_info
          WHERE registration_id = ${registration.registration_id}
          LIMIT 1
        `,
        sql`
          SELECT *
          FROM employment_info
          WHERE registration_id = ${registration.registration_id}
          LIMIT 1
        `,
        sql`
          SELECT *
          FROM document_uploads
          WHERE registration_id = ${registration.registration_id}
          LIMIT 1
        `,
      ]);

      return {
        success: true,
        type: "registration",
        status: registration.status,
        data: {
          registration,
          verification: verification[0] ?? null,
          personal: personal[0] ?? null,
          employment: employment[0] ?? null,
          documents: documents[0] ?? null,
        },
      };
    }

    const pending = await findPendingRow(id);
    if (pending) {
      return {
        success: true,
        type: "pending_employee",
        status: pending.status,
        data: pending,
      };
    }

    const employee = await findEmployeeRow(id);
    if (employee) {
      return {
        success: true,
        type: "employee",
        status: employee.status,
        data: employee,
      };
    }
  }

  if (email) {
    const bundle = await getRegistrationBundleByEmail(email);
    if (bundle) {
      return {
        success: true,
        type: "registration",
        status: bundle.registration.status,
        data: bundle,
      };
    }

    const pending = await sql`
      SELECT *
      FROM pending_employees
      WHERE LOWER(email) = LOWER(${email})
      LIMIT 1
    `;

    if (pending.length > 0) {
      return {
        success: true,
        type: "pending_employee",
        status: pending[0]!.status,
        data: pending[0]!,
      };
    }

    const employee = await sql`
      SELECT *
      FROM employees
      WHERE LOWER(email) = LOWER(${email})
      LIMIT 1
    `;

    if (employee.length > 0) {
      return {
        success: true,
        type: "employee",
        status: employee[0]!.status,
        data: employee[0]!,
      };
    }
  }

  return null;
}

function parseTrackRequest(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || url.searchParams.get("registrationId");
  const email = url.searchParams.get("email");
  return { id, email };
}

export async function GET(request: NextRequest) {
  try {
    const { id, email } = parseTrackRequest(request);

    if (!id && !email) {
      return withCors(request, { error: "IPPIS Number or Email is required" }, 400);
    }

    const result = await trackByIdOrEmail(id, email);

    if (!result) {
      return withCors(request, { error: "Application not found" }, 404);
    }

    return withCors(request, {
      ...result,
      tracked_id: id ?? email,
      normalized_id: id ? normalizeRegistrationId(id) : null,
    });
  } catch (error: any) {
    console.error("TRACKING GET ERROR:", error);
    return withCors(
      request,
      {
        error: "Internal Server Error",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { registrationId?: string; email?: string };
    const result = await trackByIdOrEmail(body.registrationId, body.email);

    if (!result) {
      return withCors(request, { error: "Application not found" }, 404);
    }

    return withCors(request, {
      ...result,
      tracked_id: body.registrationId ?? body.email,
      normalized_id: body.registrationId ? normalizeRegistrationId(body.registrationId) : null,
    });
  } catch (error: any) {
    console.error("TRACKING POST ERROR:", error);
    return withCors(
      request,
      {
        error: "Internal Server Error",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      500
    );
  }
}
