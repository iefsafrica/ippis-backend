import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || "all"
    const type = searchParams.get("type") || "all"
    const employeeId = searchParams.get("employeeId") || ""
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "10")
    const offset = (page - 1) * limit

    // Build the query with filters
    let query = `
      SELECT 
        d.id,
        d.registration_id,
        CASE 
          WHEN d.appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
          WHEN d.educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
          WHEN d.promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
          WHEN d.other_documents_path IS NOT NULL THEN 'Other Document'
          WHEN d.profile_image_path IS NOT NULL THEN 'Profile Image'
          WHEN d.signature_path IS NOT NULL THEN 'Signature'
        END as type,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) as employee_name,
        r.registration_id as employee_id,
        CASE 
          WHEN r.status = 'approved' THEN 'verified'
          WHEN r.status = 'rejected' THEN 'rejected'
          ELSE 'pending'
        END as status,
        d.upload_date
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
    `

    // Add search filter
    if (search) {
      query += ` AND (
        p.first_name ILIKE '%${search}%' OR 
        p.surname ILIKE '%${search}%' OR 
        r.registration_id ILIKE '%${search}%'
      )`
    }

    // Add status filter
    if (status !== "all") {
      if (status === "verified") {
        query += ` AND r.status = 'approved'`
      } else if (status === "rejected") {
        query += ` AND r.status = 'rejected'`
      } else {
        query += ` AND r.status = 'pending_approval'`
      }
    }

    // Add type filter
    if (type !== "all") {
      if (type === "Appointment Letter") {
        query += ` AND d.appointment_letter_path IS NOT NULL`
      } else if (type === "Educational Certificate") {
        query += ` AND d.educational_certificates_path IS NOT NULL`
      } else if (type === "Promotion Letter") {
        query += ` AND d.promotion_letter_path IS NOT NULL`
      } else if (type === "Other Document") {
        query += ` AND d.other_documents_path IS NOT NULL`
      } else if (type === "Profile Image") {
        query += ` AND d.profile_image_path IS NOT NULL`
      } else if (type === "Signature") {
        query += ` AND d.signature_path IS NOT NULL`
      }
    }

    // Add employee filter
    if (employeeId) {
      query += ` AND r.registration_id = '${employeeId}'`
    }

    // Add order by and pagination
    query += ` ORDER BY d.upload_date DESC LIMIT ${limit} OFFSET ${offset}`

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM document_uploads d
      JOIN registrations r ON d.registration_id = r.registration_id
      JOIN personal_info p ON r.registration_id = p.registration_id
      WHERE 1=1
    `

    // Add search filter to count query
    if (search) {
      countQuery += ` AND (
        p.first_name ILIKE '%${search}%' OR 
        p.surname ILIKE '%${search}%' OR 
        r.registration_id ILIKE '%${search}%'
      )`
    }

    // Add status filter to count query
    if (status !== "all") {
      if (status === "verified") {
        countQuery += ` AND r.status = 'approved'`
      } else if (status === "rejected") {
        countQuery += ` AND r.status = 'rejected'`
      } else {
        countQuery += ` AND r.status = 'pending_approval'`
      }
    }

    // Add type filter to count query
    if (type !== "all") {
      if (type === "Appointment Letter") {
        countQuery += ` AND d.appointment_letter_path IS NOT NULL`
      } else if (type === "Educational Certificate") {
        countQuery += ` AND d.educational_certificates_path IS NOT NULL`
      } else if (type === "Promotion Letter") {
        countQuery += ` AND d.promotion_letter_path IS NOT NULL`
      } else if (type === "Other Document") {
        countQuery += ` AND d.other_documents_path IS NOT NULL`
      } else if (type === "Profile Image") {
        countQuery += ` AND d.profile_image_path IS NOT NULL`
      } else if (type === "Signature") {
        countQuery += ` AND d.signature_path IS NOT NULL`
      }
    }

    // Add employee filter to count query
    if (employeeId) {
      countQuery += ` AND r.registration_id = '${employeeId}'`
    }

    const [result, countResult] = await Promise.all([db.execute(query), db.execute(countQuery)])

    const total = Number.parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      success: true,
      data: {
        documents: result.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    })
  } catch (error) {
    console.error("Documents list error:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch documents",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
