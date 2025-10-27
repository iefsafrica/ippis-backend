import { type NextRequest, NextResponse } from "next/server";
import { verifyNIN } from "@lib/verification-service";
import { prisma } from "@lib/prisma";

const NIN_REGEX = /^\d{11}$/;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { nin?: string };
    const nin = typeof body.nin === "string" ? body.nin.trim() : "";

    if (!NIN_REGEX.test(nin)) {
      return errorResponse("NIN must be exactly 11 digits.", 400);
    }

    // Call external verification service
    const result = await verifyNIN(nin);

    if (!result || typeof result.verified !== "boolean") {
      return errorResponse("Invalid response from verification service.", 502);
    }

    const data = result.data ?? {};
    const verificationFields = result.verified ? extractVerificationFields(data) : {};

    // Check existing registration
    let existingRegistration = await prisma.registrations.findFirst({
      where: { nin },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });

    if (!existingRegistration) {
      const registration_Id = generateRegistrationId();
      existingRegistration = await prisma.registrations.create({
        data: {
          registration_Id,
          nin,
          status: "draft",
          current_step: "verification",
        },
        select: { id: true },
      });
    }

    // Prepare and sanitize payload
    const rawPayload = {
      ...verificationFields,
      nin,
      registration_id: existingRegistration.id,
    };
    const safePayload = sanitizeForPostgres(rawPayload);

    // Debug null bytes
    const nullByteFields = findNullBytes(safePayload);
    if (nullByteFields.length > 0) {
      console.warn("⚠️ Null bytes detected in fields:", nullByteFields);
    }

    // Prisma upsert (updatedAt handled automatically)
    const savedVerification = await prisma.verificationData.upsert({
      where: { registration_id: existingRegistration.id },
      update: safePayload,
      create: safePayload,
    });

    return NextResponse.json({
      success: true,
      verified: result.verified,
      message: result.message ?? "Verification completed",
      data,
      verificationId: savedVerification.id,
    });
  } catch (err) {
    console.error("❌ NIN verification error:", err);
    if (err instanceof Error) console.error(err.stack);
    return errorResponse(
      "Verification failed",
      500,
      err instanceof Error ? err.message : undefined
    );
  }
}

/* ------------------ Helpers ------------------ */
function errorResponse(message: string, status: number, errorDetail?: string) {
  return NextResponse.json(
    {
      success: false,
      message,
      ...(errorDetail && { error: errorDetail }),
    },
    { status }
  );
}

function generateRegistrationId() {
  const part1 = Math.floor(100000 + Math.random() * 900000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `IPPIS-${part1}-${part2}`;
}

// ------------------ Deep Sanitization for Postgres ------------------
function sanitizeForPostgres(obj: any): any {
  if (obj == null) return null;

  if (typeof obj === "string") {
    let s = obj.replace(/\u0000/g, "");
    s = s.replace(/[\x00-\x1F\x7F]/g, "");
    return s.trim() || null;
  }

  if (obj instanceof Buffer) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForPostgres);
  if (obj instanceof Date) return obj;
  if (typeof obj === "object") {
    const cleaned: Record<string, any> = {};
    for (const key in obj) {
      if (key === "photo" || key === "signature") {
        cleaned[key] = base64ToBuffer(obj[key]);
      } else {
        cleaned[key] = sanitizeForPostgres(obj[key]);
      }
    }
    return cleaned;
  }

  return obj;
}

function findNullBytes(obj: any, path = ""): string[] {
  const fields: string[] = [];
  if (obj == null) return fields;

  if (typeof obj === "string" && obj.includes("\u0000")) {
    fields.push(path || "root");
    return fields;
  }

  if (Array.isArray(obj)) {
    obj.forEach((v, idx) => {
      fields.push(...findNullBytes(v, `${path}[${idx}]`));
    });
    return fields;
  }

  if (typeof obj === "object") {
    for (const key in obj) {
      fields.push(...findNullBytes(obj[key], path ? `${path}.${key}` : key));
    }
    return fields;
  }

  return fields;
}

// ------------------ Verification Fields Mapping ------------------
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
    birthdate: parseDate(data.birthDate) ?? new Date(), // default to now if empty
    photo: base64ToBuffer(data.photo),
    signature: base64ToBuffer(data.signature),
  };
}

function parseDate(value: any): Date | null {
  if (!value || typeof value !== "string") return null;
  const parts = value.split("-");
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    if (day && month && year) return new Date(year, month - 1, day);
    return null;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function base64ToBuffer(base64?: string | null): Buffer | null {
  if (!base64) return null;
  try {
    return Buffer.from(base64.replace(/\u0000/g, ""), "base64");
  } catch {
    return null;
  }
}
