import { NextResponse } from "next/server";
import { prisma } from "@/lib/generated/prisma";
import { z } from "zod";

// Define schema for validation
const personalInfoSchema = z.object({
  registration_id: z.string().min(1, "Registration ID is required").max(50, "Registration ID is too long"),
  title: z.string().min(1, "Title is required").max(10, "Title is too long"),
  surname: z.string().min(1, "Surname is required").max(100, "Surname is too long"),
  first_name: z.string().min(1, "First name is required").max(100, "First name is too long"),
  other_names: z.string().max(100, "Other names are too long").optional().nullable(),
  phone_number: z
    .string()
    .min(11, "Phone number must be at least 11 digits")
    .max(20, "Phone number must not exceed 20 digits")
    .regex(/^[0-9]+$/, "Phone number must contain only numbers"),
  email: z.string().email("Invalid email address").max(100, "Email is too long"),
  date_of_birth: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid date of birth (use YYYY-MM-DD)",
  }),
  sex: z.enum(["MALE", "FEMALE"], { errorMap: () => ({ message: "Invalid gender (use MALE or FEMALE)" }) }),
  marital_status: z
    .enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"], {
      errorMap: () => ({ message: "Invalid marital status (use SINGLE, MARRIED, DIVORCED, or WIDOWED)" }),
    })
    .optional()
    .nullable(),
  state_of_origin: z.string().min(1, "State of origin is required").max(50, "State of origin is too long"),
  lga: z.string().min(1, "Local Government Area is required").max(100, "LGA is too long"),
  state_of_residence: z.string().min(1, "State of residence is required").max(50, "State of residence is too long"),
  address_state_of_residence: z.string().min(1, "Address is required").max(300, "Address is too long"),
  next_of_kin_name: z.string().min(1, "Next of kin name is required").max(200, "Next of kin name is too long"),
  next_of_kin_relationship: z
    .string()
    .min(1, "Next of kin relationship is required")
    .max(50, "Next of kin relationship is too long"),
  next_of_kin_phone_number: z
    .string()
    .min(11, "Next of kin phone must be at least 11 digits")
    .max(20, "Next of kin phone must not exceed 20 digits")
    .regex(/^[0-9]+$/, "Next of kin phone must contain only numbers"),
  next_of_kin_address: z.string().min(1, "Next of kin address is required").max(300, "Next of kin address is too long"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Validate input
    const parsed = personalInfoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid input",
          errors: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    const {
      registration_id,
      title,
      surname,
      first_name,
      other_names,
      phone_number,
      email,
      date_of_birth,
      sex,
      marital_status,
      state_of_origin,
      lga,
      state_of_residence,
      address_state_of_residence,
      next_of_kin_name,
      next_of_kin_relationship,
      next_of_kin_phone_number,
      next_of_kin_address,
    } = parsed.data;

    // Validate registration exists
    const registration = await prisma.registrations.findUnique({
      where: { registration_Id: registration_id },
    });

    if (!registration) {
      return NextResponse.json(
        { success: false, message: `Registration with ID ${registration_id} not found` },
        { status: 404 }
      );
    }

    // Prepare data for upsert
    const personalInfoData = {
      registration_id,
      title,
      surname,
      first_name,
      other_names,
      phone_number,
      email,
      date_of_birth: new Date(date_of_birth),
      sex,
      marital_status,
      state_of_origin,
      lga,
      state_of_residence,
      address_state_of_residence,
      next_of_kin_name,
      next_of_kin_relationship,
      next_of_kin_phone_number,
      next_of_kin_address,
    };

    // Upsert personal_info
    const info = await prisma.personal_info.upsert({
      where: { registration_id },
      update: personalInfoData,
      create: personalInfoData,
    });

    // Update registration step
    await prisma.registrations.update({
      where: { registration_Id: registration_id },
      data: {
        current_step: "employment_info",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Personal information saved successfully",
      data: info,
    });
  } catch (error) {
    console.error("Error in POST /api/register/personal-info-step:", error);
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: `Server error: ${error.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}