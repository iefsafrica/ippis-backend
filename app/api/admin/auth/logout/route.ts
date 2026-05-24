import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";

export async function POST(req: NextRequest) {
  const response = withCors(req, {
    success: true,
    message: "Logged out successfully",
    timestamp: new Date().toISOString()
  });

  // Clear common authentication cookies
  response.cookies.set("token", "", { expires: new Date(0), path: "/" });
  response.cookies.set("next-auth.session-token", "", { expires: new Date(0), path: "/" });
  response.cookies.set("next-auth.callback-url", "", { expires: new Date(0), path: "/" });
  response.cookies.set("next-auth.csrf-token", "", { expires: new Date(0), path: "/" });

  return response;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
