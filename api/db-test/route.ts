import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const result = await db.query("SELECT 1 + 1 AS result");
    return NextResponse.json({ dbTest: result.rows[0] });
  } catch (error) {
    console.error("DB Test Failed:", error);
    return NextResponse.json({ error: "DB connection failed" }, { status: 500 });
  }
}


