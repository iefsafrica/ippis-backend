import { type NextRequest, NextResponse } from "next/server"
import { verifyBVN } from "@/lib/verification-service"

export async function POST(request: NextRequest) {
  try {
    const { bvn } = await request.json()

    if (!bvn || bvn.trim().length !== 11) {
      return NextResponse.json({ success: false, message: "Invalid BVN format" }, { status: 400 })
    }

    // In a real application, this would call an external API
    // For now, we'll simulate the verification
    const result = await verifyBVN(bvn)

    return NextResponse.json({
      success: true,
      verified: result.verified,
      message: result.message,
    })
  } catch (error) {
    console.error("BVN verification error:", error)
    const errorMessage = typeof error === "object" && error !== null && "message" in error
      ? (error as { message: string }).message
      : String(error);
    return NextResponse.json({ success: false, message: "Verification failed", error: errorMessage }, { status: 500 })
  }
}
