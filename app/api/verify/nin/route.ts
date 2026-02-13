import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../../lib/cors";

export const dynamic = "force-dynamic";

/* =========================
   Types
========================= */
type NinRequestBody = {
  nin: string;
};

type NetappsNinResponse = {
  error?: boolean;
  message?: string;
  data?: any;
  timestamp?: string;
};

/* =========================
   Preflight
========================= */
export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest);
}

/* =========================
   POST /api/verify/nin
========================= */
export async function POST(req: NextRequest) {
  try {
    console.log("---- NIN Verification Request Started ----");

    /* ---------- Parse body ---------- */
    const body = (await req.json()) as NinRequestBody;
    const { nin } = body;

    console.log("Incoming NIN:", nin);

    /* ---------- Validate input ---------- */
    if (!nin) {
      return withCors(req, { success: false, error: "NIN is required" }, 400);
    }

    if (!/^\d{11}$/.test(nin)) {
      return withCors(
        req,
        { success: false, error: "NIN must be 11 digits" },
        400
      );
    }

    /* ---------- Load env vars and clean key ---------- */
    const NETAPPS_URL = process.env.NETAPPS_URL;
    const rawKey = process.env.NETAPPS_SECRET_KEY;

    if (!NETAPPS_URL || !rawKey) {
      return withCors(
        req,
        { success: false, error: "Netapps KYC service is not configured" },
        500
      );
    }

    // Clean key: remove whitespace & zero-width characters
    const NETAPPS_SECRET_KEY = rawKey.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");

    console.log("Raw key length:", rawKey.length);
    console.log("Cleaned key length:", NETAPPS_SECRET_KEY.length);
    console.log("Key preview:", NETAPPS_SECRET_KEY.substring(0, 10) + "...");

    /* ---------- Call Netapps ---------- */
    const response = await fetch(NETAPPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": NETAPPS_SECRET_KEY,
      },
      body: JSON.stringify({ nin }),
    });

    console.log("Netapps response status:", response.status);

    const data = (await response.json()) as NetappsNinResponse;

    console.log("Netapps response body:", data);

    /* ---------- Handle failure ---------- */
    if (!response.ok || data?.error) {
      console.log("Netapps validation failed.");
      return withCors(
        req,
        {
          success: false,
          error: "NIN validation failed",
          details: data,
        },
        response.status || 400
      );
    }

    /* ---------- Success ---------- */
    console.log("NIN validation successful.");
    return withCors(req, {
      success: true,
      message: data.message ?? "NIN validated successfully",
      data: data.data,
      timestamp: data.timestamp,
    });
  } catch (error) {
    console.error("NIN Validation Error:", error);
    return withCors(
      req,
      {
        success: false,
        error: "Server error",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
