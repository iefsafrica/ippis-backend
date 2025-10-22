import { type NextRequest, NextResponse } from "next/server";
import { verifyNIN } from "@lib/verification-service";

// Initialize Prisma
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const NIN_REGEX = /^\d{11}$/;

// Define the expected request body type
interface VerifyNINRequestBody {
  nin: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as VerifyNINRequestBody;
    const nin = typeof body.nin === "string" ? body.nin.trim() : "";

    console.log('🔍 Verifying NIN:', nin);

    if (!NIN_REGEX.test(nin)) {
      return NextResponse.json(
        {
          success: false,
          message: "NIN must be exactly 11 digits.",
        },
        { status: 400 }
      );
    }

    // Verify NIN with external service
    const result = await verifyNIN(nin);
    
    console.log("✅ API Verification Result:", {
      verified: result.verified,
      message: result.message,
      hasData: !!result.data
    });

    if (!result || typeof result.verified !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid response from verification service.",
        },
        { status: 502 }
      );
    }

    // If verification failed, return early
    if (!result.verified) {
      return NextResponse.json({
        success: true,
        verified: false,
        message: result.message,
        data: result.data
      });
    }

    console.log(' NIN verified successfully, processing data...');

    // Extract verification fields
    const verificationFields = result.data ? extractVerificationFields(result.data) : {};

    console.log('Extracted fields:', Object.keys(verificationFields));

    // Find or create registration
    let existingRegistration = await prisma.registrations.findFirst({
      where: { nin },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });

    if (!existingRegistration) {
      const registration_Id = generateRegistrationId();
      console.log('🆕 Creating new registration with ID:', registration_Id);
      
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
      console.log('New registration created:', newRegistration);
    }

    // Clean data function
    function cleanData(obj: any): any {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === "string") {
        return obj.replace(/\u0000/g, "").trim() || null;
      }
      if (typeof obj === "object") {
        const cleaned: any = {};
        for (const key in obj) {
          if (obj[key] !== null && obj[key] !== undefined) {
            cleaned[key] = cleanData(obj[key]);
          }
        }
        return cleaned;
      }
      return obj;
    }

    // Prepare data for upsert
    const createData = cleanData({
      nin,
      ...verificationFields,
      updatedAt: new Date(),
      registration_id: existingRegistration.id,
    });

    console.log('💾 Upserting verification data for registration:', existingRegistration.id);
    console.log('📝 Data to upsert:', JSON.stringify(createData, null, 2));

    // Try with minimal fields first to isolate the issue
    const minimalFields = {
      vnin: createData.vnin,
      title: createData.title,
      surname: createData.surname,
      firstname: createData.firstname,
      middlename: createData.middlename,
      gender: createData.gender,
      birthdate: createData.birthdate,
      updatedAt: createData.updatedAt,
    };

    const savedVerification = await prisma.verificationData.upsert({
      where: { registration_id: existingRegistration.id },
      update: minimalFields,
      create: {
        ...minimalFields,
        nin: createData.nin,
        registration_id: createData.registration_id,
      },
    });

    console.log('✅ Verification data saved:', savedVerification.id);

    return NextResponse.json({
      success: true,
      verified: result.verified,
      message: result.message,
      data: result.data,
      verificationId: savedVerification.id,
    });

  } catch (err) {
    console.error("❌ NIN verification error:", err);
    if (err instanceof Error) {
      console.error("Full error stack:", err.stack);
      console.error("Error details:", JSON.stringify(err, null, 2));
    }
    
    return NextResponse.json(
      {
        success: false,
        message: "Verification failed",
        error: err instanceof Error ? err.message : "Unknown error",
        errorType: "Database Error"
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Helper functions
function generateRegistrationId() {
  const part1 = Math.floor(100000 + Math.random() * 900000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `IPPIS-${part1}-${part2}`;
}

function extractVerificationFields(data: Record<string, any>) {
  // Format birthdate properly - convert "31-08-1991" to "1991-08-31"
  let formattedBirthdate = data.birthdate || data.birthDate || data.BirthDate;
  
  if (formattedBirthdate && typeof formattedBirthdate === 'string') {
    const dateMatch = formattedBirthdate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dateMatch) {
      // Convert DD-MM-YYYY to YYYY-MM-DD
      formattedBirthdate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      console.log('📅 Formatted birthdate:', formattedBirthdate);
    }
  }

  return {
    vnin: data.vnin || data.VNIN,
    title: data.title || data.Title,
    surname: data.surname || data.Surname || data.lastname || data.LastName,
    firstname: data.firstname || data.Firstname || data.firstname || data.FirstName,
    middlename: data.middlename || data.Middlename || data.middleName || data.MiddleName,
    email: data.email || data.Email,
    gender: data.gender || data.Gender,
    state_of_origin: data.state_of_origin || data.stateOfOrigin || data.StateOfOrigin,
    religion: data.religion || data.Religion,
    profession: data.profession || data.Profession,
    residence_address: data.residence_address || data.residenceAddress || data.ResidenceAddress,
    residence_lga: data.residence_lga || data.residenceLga || data.ResidenceLGA,
    residence_state: data.residence_state || data.residenceState || data.ResidenceState,
    nok_surname: data.nok_surname || data.nokSurname || data.NOKSurname,
    nok_lga: data.nok_lga || data.nokLga || data.NOKLGA,
    nok_state: data.nok_state || data.nokState || data.NOKState,
    nok_town: data.nok_town || data.nokTown || data.NOKTown,
    maiden_name: data.maiden_name || data.maidenName || data.MaidenName,
    tracking_id: data.tracking_id || data.trackingId || data.TrackingID,
    birthcountry: data.birthcountry || data.birthCountry || data.BirthCountry,
    birthdate: formattedBirthdate, // Use the formatted date
    birthlga: data.birthlga || data.birthLga || data.BirthLGA,
    birthstate: data.birthstate || data.birthState || data.BirthState,
    central_iD: data.central_iD || data.centralID || data.centralId || data.CentralID,
    educationallevel: data.educationallevel || data.educationalLevel || data.EducationalLevel,
    employmentstatus: data.employmentstatus || data.employmentStatus || data.EmploymentStatus,
    heigth: data.heigth || data.height || data.Height,
    lga_origin: data.lga_origin || data.lgaOrigin || data.LGAOrigin,
    maritalstatus: data.maritalstatus || data.maritalStatus || data.MaritalStatus,
    nok_address1: data.nok_address1 || data.nokAddress1 || data.NOKAddress1,
    nok_address2: data.nok_address2 || data.nokAddress2 || data.NOKAddress2,
    nok_firstname: data.nok_firstname || data.nokFirstname || data.NOKFirstname,
    nok_middlename: data.nok_middlename || data.nokMiddlename || data.NOKMiddlename,
    nok_postalcode: data.nok_postalcode || data.nokPostalcode || data.NOKPostalCode,
    nspokenlang: data.nspokenlang || data.nspokenLang || data.NSpokenLang,
    ospokenlang: data.ospokenlang || data.ospokenLang || data.OSpokenLang,
    pfirstname: data.pfirstname || data.pFirstname || data.PFirstname,
    photo: data.photo || data.Photo,
    pmiddlename: data.pmiddlename || data.pMiddlename || data.PMiddlename,
    psurname: data.psurname || data.pSurname || data.PSurname,
    residence_AdressLine1: data.residence_AdressLine1 || data.residenceAddressLine1 || data.ResidenceAddressLine1,
    residence_Town: data.residence_Town || data.residenceTown || data.ResidenceTown,
    residencestatus: data.residencestatus || data.residenceStatus || data.ResidenceStatus,
    self_origin_lga: data.self_origin_lga || data.selfOriginLga || data.SelfOriginLGA,
    self_origin_place: data.self_origin_place || data.selfOriginPlace || data.SelfOriginPlace,
    self_origin_state: data.self_origin_state || data.selfOriginState || data.SelfOriginState,
    signature: data.signature || data.Signature,
    spoken_language: data.spoken_language || data.spokenLanguage || data.SpokenLanguage,
    telephoneno: data.telephoneno || data.telephoneNo || data.TelephoneNo,
    userid: data.userid || data.userId || data.UserID,
  };
}