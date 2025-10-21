import { type NextRequest, NextResponse } from "next/server";
import { verifyNIN } from "@/lib/verification-service";
import { prisma } from "@/lib/prisma";

const NIN_REGEX = /^\d{11}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const nin = typeof body.nin === "string" ? body.nin.trim() : "";

    if (!NIN_REGEX.test(nin)) {
      return errorResponse("NIN must be exactly 11 digits.", 400);
    }

    const result = await verifyNIN(nin);
    if (!result || typeof result.verified !== "boolean") {
      return errorResponse("Invalid response from verification service.", 502);
    }

    const data = result.data ?? {};
    const verificationFields = result.verified ? extractVerificationFields(data) : {};

    let existingRegistration = await prisma.registrations.findFirst({
      where: { nin },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });

    if (!existingRegistration) {
      const registration_Id = generateRegistrationId();
      const newRegistration = await prisma.registrations.create({
        data: {
          registration_Id,
          nin,
          status: "draft",
          current_step: "verification",
          created_at: new Date(),
          updated_at: new Date(),
        },
        select: { id: true },
      });
      existingRegistration = newRegistration;
    }

    // Deep clean + null-byte removal
    function deepClean(value: any): any {
      if (value === null || value === undefined) {
        return null;
      }
      if (value instanceof Date) {
        return value;
      }
      if (typeof value === "string") {
        // remove all null bytes
        return value.replace(/\u0000/g, "");
      }
      if (Array.isArray(value)) {
        return value.map(deepClean);
      }
      if (typeof value === "object") {
        const out: any = {};
        for (const key in value) {
          const v = value[key];
          out[key] = deepClean(v);
        }
        return out;
      }
      // boolean, number, etc
      return value;
    }

    function findNullByteFields(obj: any, path = ""): string[] {
      const fields: string[] = [];
      if (obj === null || obj === undefined) {
        return fields;
      }
      if (typeof obj === "string") {
        if (obj.includes("\u0000")) {
          fields.push(path || "root");
        }
        return fields;
      }
      if (Array.isArray(obj)) {
        obj.forEach((v, idx) => {
          fields.push(...findNullByteFields(v, `${path}[${idx}]`));
        });
        return fields;
      }
      if (typeof obj === "object") {
        for (const key in obj) {
          const v = obj[key];
          fields.push(...findNullByteFields(v, path ? `${path}.${key}` : key));
        }
        return fields;
      }
      return fields;
    }

    const rawPayload = {
      nin,
      ...verificationFields,
      updatedAt: new Date(),
      registration_id: existingRegistration.id,
    };

    const updatePayload = deepClean({
      ...verificationFields,
      updatedAt: new Date(),
    });

    const createPayload = deepClean(rawPayload);

    const badFields = findNullByteFields(createPayload);
    if (badFields.length > 0) {
      console.warn("⚠️ Null byte found in fields:", badFields);
      for (const key of badFields) {
        console.warn(`Field "${key}" value:`, JSON.stringify((createPayload as any)[key]));
      }
    } else {
      console.log("No null bytes present in createPayload");
    }

    console.log("Final createPayload to upsert:", JSON.stringify(createPayload, null, 2));

    const savedVerification = await prisma.verificationData.upsert({
      where: { registration_id: existingRegistration.id },
      update: updatePayload,
      create: createPayload,
    });

    return NextResponse.json({
      success: true,
      verified: result.verified,
      message: result.message ?? "Verification completed",
      data,
      verificationId: savedVerification.id,
    });
  } catch (err) {
    console.error(" NIN verification error:", err);
    if (err instanceof Error) {
      console.error("Full error:", err.stack);
    }
    return errorResponse("Verification failed", 500, err instanceof Error ? err.message : undefined);
  }
}

// --- Helpers ---

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
    nok_surname: data.nokSurname,
    nok_lga: data.nokLga,
    nok_state: data.nokState,
    nok_town: data.nokTown,
    maiden_name: data.maidenName,
    tracking_id: data.trackingId,
    birthcountry: data.birthCountry,
    birthdate: parseDate(data.birthDate),
    birthlga: data.birthLga,
    birthstate: data.birthState,
    central_iD: data.centralId,
    educationallevel: data.educationalLevel,
    employmentstatus: data.employmentStatus,
    heigth: data.height,
    lga_origin: data.lgaOrigin,
    maritalstatus: data.maritalStatus,
    nok_address1: data.nokAddress1,
    nok_address2: data.nokAddress2,
    nok_firstname: data.nokFirstname,
    nok_middlename: data.nokMiddlename,
    nok_postalcode: data.nokPostalcode,
    nspokenlang: data.nspokenLang,
    ospokenlang: data.ospokenLang,
    pfirstname: data.pfirstname,
    photo: data.photo,
    pmiddlename: data.pmiddlename,
    psurname: data.psurname,
    residence_AdressLine1: data.residenceAddressLine1,
    residence_Town: data.residenceTown,
    residencestatus: data.residenceStatus,
    self_origin_lga: data.selfOriginLga,
    self_origin_place: data.selfOriginPlace,
    self_origin_state: data.selfOriginState,
    signature: data.signature,
    spoken_language: data.spokenLanguage,
    telephoneno: data.telephoneNo,
    userid: data.userId,
  };
}

function parseDate(value: any): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
