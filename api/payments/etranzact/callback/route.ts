
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const data = await req.json()
  console.log("eTranzact Callback Data:", data)

  // TODO: Verify, update payment record in DB, log transaction, etc.

  return NextResponse.json({ success: true })
}
