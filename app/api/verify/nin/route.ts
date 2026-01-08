import { type NextRequest, NextResponse } from "next/server";
import { verifyNIN } from "@lib/verification-service";
import { prisma } from "@lib/prisma";
import { withCors, handleOptions } from "../../../../lib/cors";

const NIN_REGEX = /^\d{11}$/;

/**
 * In-memory lock (prevents same-NIN concurrency per instance)
 */
const ninLocks = new Set<string>();

export async function POST(request: NextRequest) {
  let nin = "";

  try {
    const body = (await request.json()) as { nin?: string };
    nin = typeof body.nin === "string" ? body.nin.trim() : "";

    if (!NIN_REGEX.test(nin)) {
      return errorResponse("NIN must be exactly 11 digits.", 400);
    }

    /* ---------------- 1️⃣ BLOCK PARALLEL REQUESTS ---------------- */

    if (ninLocks.has(nin)) {
      const existing = await prisma.verificationData.findUnique({
        where: { nin },
        select: {
          registration: {
            select: { registration_Id: true }, // ✅ FIX
          },
        },
      });

      return conflictResponse(existing?.registration?.registration_Id);
    }

    ninLocks.add(nin);

    /* ---------------- 2️⃣ CHECK IF NIN ALREADY EXISTS ---------------- */

    const existingVerification = await prisma.verificationData.findUnique({
      where: { nin },
      select: {
        registration: {
          select: { registration_Id: true }, // ✅ FIX
        },
      },
    });

    if (existingVerification) {
      return conflictResponse(
        existingVerification.registration.registration_Id
      );
    }

    /* ---------------- 3️⃣ VERIFY NIN EXTERNALLY ---------------- */

    const result = await verifyNIN(nin);

    if (!result || typeof result.verified !== "boolean") {
      return errorResponse("Invalid response from verification service.", 502);
    }

    if (!result.verified) {
      return errorResponse(
        result.message ?? "NIN verification failed",
        400
      );
    }

    const verificationFields = extractVerificationFields(result.data ?? {});

    /* ---------------- 4️⃣ TRANSACTION (DB SAFE) ---------------- */

    const verification = await prisma.$transaction(async (tx) => {
      /* --- 4a. Get or create registration --- */

      let registration = await tx.registrations.findFirst({
        where: { nin },
        orderBy: { created_at: "desc" },
        select: { registration_Id: true }, // ✅ STRING ID ONLY
      });

      if (!registration) {
        registration = await tx.registrations.create({
          data: {
            registration_Id: generateRegistrationId(),
            nin,
            status: "draft",
            current_step: "verification",
          },
          select: { registration_Id: true },
        });
      }

      /* --- 4b. Prepare payload --- */

      const payload = sanitizeForPostgres({
        ...verificationFields,
        nin,
      });

      /* --- 4c. Create verification data --- */

      return tx.verificationData.create({
        data: {
          ...payload,
          registration_id: registration.registration_Id, // ✅ CORRECT LINK
        },
        select: {
          id: true,
          registration: {
            select: { registration_Id: true }, // ✅ RETURN PUBLIC ID
          },
        },
      });
    });

    /* ---------------- 5️⃣ SUCCESS ---------------- */

    return NextResponse.json({
      success: true,
      verified: true,
      message: "NIN verified successfully",
      registrationId: verification.registration.registration_Id, // ✅ FIX
      verificationId: verification.id,
    });
  } catch (err: any) {
    /* ---------------- HANDLE DB UNIQUE RACE CONDITION ---------------- */

    if (
      typeof err?.message === "string" &&
      err.message.includes("Unique constraint failed")
    ) {
      const existing = await prisma.verificationData.findUnique({
        where: { nin },
        select: {
          registration: {
            select: { registration_Id: true }, // ✅ FIX
          },
        },
      });

      return conflictResponse(existing?.registration?.registration_Id);
    }

    console.error("❌ NIN verification error:", err);

    return errorResponse(
      "Verification failed",
      500,
      err instanceof Error ? err.message : undefined
    );
  } finally {
    /* ---------------- ALWAYS RELEASE LOCK ---------------- */
    if (nin) ninLocks.delete(nin);
  }
}

/* ------------------ RESPONSES ------------------ */

function conflictResponse(registrationId?: string | null) {
  return NextResponse.json(
    {
      success: false,
      message: "This NIN has already been processed",
      registrationId: registrationId ?? null,
    },
    { status: 409 }
  );
}

function errorResponse(message: string, status: number, detail?: string) {
  return NextResponse.json(
    { success: false, message, ...(detail && { error: detail }) },
    { status }
  );
}

/* ------------------ HELPERS ------------------ */

function generateRegistrationId() {
  const part1 = Math.floor(100000 + Math.random() * 900000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `IPPIS-${part1}-${part2}`;
}

/* ------------------ SANITIZATION ------------------ */

function sanitizeForPostgres(value: any): any {
  if (value == null) return null;

  if (typeof value === "string") {
    const cleaned = value
      .replace(/\u0000/g, "")
      .replace(/[\x00-\x1F\x7F]/g, "")
      .trim();
    return cleaned || null;
  }

  if (value instanceof Date || value instanceof Buffer) return value;
  if (Array.isArray(value)) return value.map(sanitizeForPostgres);

  if (typeof value === "object") {
    const result: Record<string, any> = {};
    for (const key in value) {
      result[key] =
        key === "photo" || key === "signature"
          ? base64ToBuffer(value[key])
          : sanitizeForPostgres(value[key]);
    }
    return result;
  }

  return value;
}

/* ------------------ FIELD MAPPING ------------------ */

function extractVerificationFields(data: Record<string, any>) {
  return {
    vnin: data.vnin,
    title: data.title,
    surname: data.surname,
    firstname: data.firstname,
    middlename: data.middlename,
    email: data.email,
    gender: data.gender,
    state_of_origin: data.stateOfOrigin,
    religion: data.religion,
    profession: data.profession,
    residence_address: data.residenceAddress,
    residence_lga: data.residenceLga,
    residence_state: data.residenceState,
    birthdate: parseDate(data.birthDate),
    photo: base64ToBuffer(data.photo),
    signature: base64ToBuffer(data.signature),
  };
}

/* ------------------ UTILS ------------------ */

function parseDate(value: any): Date | null {
  if (!value || typeof value !== "string") return null;
  const [day, month, year] = value.split("-").map(Number);
  return day && month && year ? new Date(year, month - 1, day) : null;
}

function base64ToBuffer(base64?: string | null): Buffer | null {
  if (!base64) return null;
  try {
    return Buffer.from(base64.replace(/\u0000/g, ""), "base64");
  } catch {
    return null;
  }
}
