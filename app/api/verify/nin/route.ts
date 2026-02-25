import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../lib/cors";

export const dynamic = "force-dynamic";

// Type for the request body
type VerifyNinBody = {
  nin: string;
};

// Mock NIN validation function
function validateNIN(nin: string) {
  // NIN must be exactly 11 digits
  const regex = /^\d{11}$/;
  if (!regex.test(nin)) {
    return { valid: false, message: "Invalid keys" };
  }
  return { valid: true, message: "NIN validated successfully" };
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// =========================
// POST: Verify NIN
// =========================
export async function POST(req: NextRequest) {
  try {
    const body: VerifyNinBody = (await req.json()) as VerifyNinBody;

    const { nin } = body;

    if (!nin) {
      return withCors(req, {
        success: false,
        error: "NIN is required",
      }, 400);
    }

    const validation = validateNIN(nin);

    if (!validation.valid) {
      return withCors(req, {
        success: false,
        error: "NIN validation failed",
        details: {
          error: true,
          message: validation.message,
        },
      }, 400);
    }

    // Success
    return withCors(req, {
      success: true,
      message: "NIN validated successfully",
      data: {
        nin,
        verified: true,
      },
    }, 200);

  } catch (error) {
    console.error("NIN verification error:", error);
    return withCors(req, {
      success: false,
      error: "Failed to verify NIN",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}