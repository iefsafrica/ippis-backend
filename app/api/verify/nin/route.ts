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

    // --- 1️⃣ Verify NIN Externally ---
    const result = await verifyNIN(nin);

    if (!result || typeof result.verified !== "boolean") {
      return errorResponse("Invalid response from verification service.", 502);
    }

    const data = result.data ?? {};
    const verificationFields = result.verified ? extractVerificationFields(data) : {};

    // --- 2️⃣ Check or Create Registration ---
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

    // --- 3️⃣ Sanitize Payload ---
    const rawPayload = {
      ...verificationFields,
      nin,
      registration_id: existingRegistration.id,
    };

    const safePayload = sanitizeForPostgres(rawPayload);

    // Detect null byte values
    const nullByteFields = findNullBytes(safePayload);
    if (nullByteFields.length > 0) {
      console.warn("⚠️ Null bytes detected in:", nullByteFields);
    }

    // --- 4️⃣ Remove timestamp fields before upsert ---
    const { created_at, updated_at, createdAt, updatedAt, ...cleanPayload } = safePayload as any;

    // --- 5️⃣ UPSERT into DB ---
    const savedVerification = await prisma.verificationData.upsert({
      where: { registration_id: existingRegistration.id },
      update: cleanPayload,
      create: { ...cleanPayload, registration_id: existingRegistration.id },
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
    return errorResponse(
      "Verification failed",
      500,
      err instanceof Error ? err.message : undefined
    );
  }
}

/* ------------------ Helpers ------------------ */

function errorResponse(message: string, status: number, detail?: string) {
  return NextResponse.json(
    { success: false, message, ...(detail && { error: detail }) },
    { status }
  );
}

function generateRegistrationId() {
  const part1 = Math.floor(100000 + Math.random() * 900000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `IPPIS-${part1}-${part2}`;
}

/* ------------------ Sanitization ------------------ */

function sanitizeForPostgres(value: any): any {
  if (value == null) return null;

  if (typeof value === "string") {
    const cleaned = value.replace(/\u0000/g, "").replace(/[\x00-\x1F\x7F]/g, "");
    return cleaned.trim() || null;
  }

  if (Array.isArray(value)) return value.map(sanitizeForPostgres);
  if (value instanceof Date || value instanceof Buffer) return value;

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

function findNullBytes(obj: any, path = ""): string[] {
  const fields: string[] = [];

  if (typeof obj === "string" && obj.includes("\u0000")) {
    fields.push(path || "root");
    return fields;
  }

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => fields.push(...findNullBytes(v, `${path}[${i}]`)));
  } else if (typeof obj === "object" && obj !== null) {
    for (const key in obj) {
      fields.push(...findNullBytes(obj[key], path ? `${path}.${key}` : key));
    }
  }

  return fields;
}

/* ------------------ Field Mapping ------------------ */

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
    birthdate: parseDate(data.birthDate) ?? new Date(),
    photo: base64ToBuffer(data.photo),
    signature: base64ToBuffer(data.signature),
  };
}

function parseDate(str: any): Date | null {
  if (!str || typeof str !== "string") return null;
  const [day, month, year] = str.split("-").map(Number);
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