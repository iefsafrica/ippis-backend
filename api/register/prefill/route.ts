import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const registrationId = searchParams.get("registrationId");

  if (!registrationId) {
    return NextResponse.json({ error: "Missing registrationId" }, { status: 400 });
  }

  try {
    const result = await db.query(
      `SELECT nin_data FROM verification_data WHERE registration_id = $1`,
      [registrationId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "No data found" }, { status: 404 });
    }

    const ninData = result.rows[0].nin_data;

    return NextResponse.json({
      success: true,
      data: JSON.parse(ninData),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
