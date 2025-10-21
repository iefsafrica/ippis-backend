import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const data = await request.json()
    const { registrationId, bvn, nin } = data

    if (!registrationId || !bvn || !nin) {
      return NextResponse.json(
        {
          error: "Missing required fields",
        },
        { status: 400 },
      )
    }

    // In a real app, you would verify BVN and NIN with external APIs
    // For now, we'll simulate verification
    const bvnVerified = bvn.length === 11
    const ninVerified = nin.length === 11

    // Save verification data
    await db.query(`
      INSERT INTO verification_data 
      (registration_id, bvn, bvn_verified, nin, nin_verified, verification_date)
      VALUES ('${registrationId}', '${bvn}', ${bvnVerified}, '${nin}', ${ninVerified}, CURRENT_TIMESTAMP)
      ON CONFLICT (registration_id) 
      DO UPDATE SET 
        bvn = '${bvn}',
        bvn_verified = ${bvnVerified},
        nin = '${nin}',
        nin_verified = ${ninVerified},
        verification_date = CURRENT_TIMESTAMP
    `)

    // Update the registration step if both are verified
    if (bvnVerified && ninVerified) {
      await db.execute(`
        UPDATE registrations 
        SET current_step = 'personal_info', updated_at = CURRENT_TIMESTAMP 
        WHERE registration_id = '${registrationId}'
      `)
    }

    return NextResponse.json({
      success: true,
      bvnVerified,
      ninVerified,
    })
  } catch (error) {
    console.error("Verification error:", error)
    return NextResponse.json(
      {
        error: "Failed to process verification",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
