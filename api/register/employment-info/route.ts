import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const data = await request.json()
    const {
      registrationId,
      employmentIdNo,
      serviceNo,
      fileNo,
      rankPosition,
      department,
      organization,
      employmentType,
      probationPeriod,
      workLocation,
      dateOfFirstAppointment,
      gl,
      step,
      salaryStructure,
      cadre,
      nameOfBank,
      accountNumber,
      pfaName,
      rsapin,
      educationalBackground,
      certifications,
    } = data

    // Validate required fields
    if (
      !registrationId ||
      !employmentIdNo ||
      !serviceNo ||
      !fileNo ||
      !rankPosition ||
      !department ||
      !organization ||
      !employmentType ||
      !workLocation ||
      !dateOfFirstAppointment ||
      !gl ||
      !step ||
      !salaryStructure ||
      !cadre ||
      !nameOfBank ||
      !accountNumber ||
      !pfaName ||
      !rsapin
    ) {
      return NextResponse.json(
        {
          error: "Missing required fields",
        },
        { status: 400 },
      )
    }

    // Save employment information
    await db.execute(`
      INSERT INTO employment_info (
        registration_id, employment_id_no, service_no, file_no, rank_position,
        department, organization, employment_type, probation_period,
        work_location, date_of_first_appointment, gl, step, salary_structure,
        cadre, name_of_bank, account_number, pfa_name, rsapin,
        educational_background, certifications
      )
      VALUES (
        '${registrationId}', '${employmentIdNo}', '${serviceNo}', '${fileNo}', '${rankPosition}',
        '${department}', '${organization}', '${employmentType}', '${probationPeriod}',
        '${workLocation}', '${dateOfFirstAppointment}', '${gl}', '${step}', '${salaryStructure}',
        '${cadre}', '${nameOfBank}', '${accountNumber}', '${pfaName}', '${rsapin}',
        ${educationalBackground ? `'${educationalBackground}'` : "NULL"}, 
        ${certifications ? `'${certifications}'` : "NULL"}
      )
      ON CONFLICT (registration_id) 
      DO UPDATE SET 
        employment_id_no = '${employmentIdNo}',
        service_no = '${serviceNo}',
        file_no = '${fileNo}',
        rank_position = '${rankPosition}',
        department = '${department}',
        organization = '${organization}',
        employment_type = '${employmentType}',
        probation_period = '${probationPeriod}',
        work_location = '${workLocation}',
        date_of_first_appointment = '${dateOfFirstAppointment}',
        gl = '${gl}',
        step = '${step}',
        salary_structure = '${salaryStructure}',
        cadre = '${cadre}',
        name_of_bank = '${nameOfBank}',
        account_number = '${accountNumber}',
        pfa_name = '${pfaName}',
        rsapin = '${rsapin}',
        educational_background = ${educationalBackground ? `'${educationalBackground}'` : "NULL"},
        certifications = ${certifications ? `'${certifications}'` : "NULL"}
    `)

    // Update the registration step
    await db.execute(`
      UPDATE registrations 
      SET current_step = 'documents', updated_at = CURRENT_TIMESTAMP 
      WHERE registration_id = '${registrationId}'
    `)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error("Employment info error:", error)
    return NextResponse.json(
      {
        error: "Failed to save employment information",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
