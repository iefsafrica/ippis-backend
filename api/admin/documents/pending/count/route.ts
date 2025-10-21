import { NextResponse } from "next/server";
import { db } from "@/lib/db"; 
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export async function GET() {
  const session = await getServerSession(authOptions);
//   if (!session?.user) {
//     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
//   }

  try {
    const result = await db.query(
      `SELECT COUNT(*) AS pending_count FROM document_uploads WHERE status = 'pending'`
    );

    const count = Number(result.rows[0]?.pending_count ?? 0);

    return NextResponse.json({
      success: true,
      count,
      message: "Pending document count fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching pending document count:", error);
    return NextResponse.json(
      { error: "Failed to fetch count", details: String(error) },
      { status: 500 }
    );
  }
}
