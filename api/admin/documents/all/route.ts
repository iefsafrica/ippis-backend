import { Router } from "express";

import { db } from "@lib/db";



const router = Router();

router.get("/all", async (req, res) => {
  try {
    const query = `
      WITH document_types AS (
        SELECT
          id,
          CASE
            WHEN appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
            WHEN educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
            WHEN promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
            WHEN other_documents_path IS NOT NULL THEN 'Other Document'
            WHEN profile_image_path IS NOT NULL THEN 'Profile Image'
            WHEN signature_path IS NOT NULL THEN 'Signature'
            ELSE 'Unknown Document'
          END AS name,
          CASE
            WHEN appointment_letter_path IS NOT NULL THEN 'Appointment Letter'
            WHEN educational_certificates_path IS NOT NULL THEN 'Educational Certificate'
            WHEN promotion_letter_path IS NOT NULL THEN 'Promotion Letter'
            WHEN other_documents_path IS NOT NULL THEN 'Other Document'
            WHEN profile_image_path IS NOT NULL THEN 'Profile Image'
            WHEN signature_path IS NOT NULL THEN 'Signature'
            ELSE 'unknown'
          END AS type
        FROM document_uploads
      )
      SELECT
        d.id,
        dt.name,
        dt.type,
        CONCAT(p.title, ' ', p.first_name, ' ', p.surname) AS employee_name,
        r.registration_id AS employee_id,
        d.status,
        d.upload_date
      FROM document_uploads d
      LEFT JOIN document_types dt ON d.id = dt.id
      LEFT JOIN registrations r ON d.registration_id = r.registration_id
      LEFT JOIN personal_info p ON r.registration_id = p.registration_id
      ORDER BY d.upload_date DESC
      LIMIT 100;
    `;
    const result = await db.query(query);
    res.json({ success: true, data: result.rows, message: "All documents fetched successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch all documents" });
  }
});

export default router;
