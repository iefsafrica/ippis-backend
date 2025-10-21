import { NextResponse } from "next/server"

export async function GET() {
  return new NextResponse(JSON.stringify({ success: true, message: "Service workers disabled" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Service-Worker-Allowed": "false",
    },
  })
}
