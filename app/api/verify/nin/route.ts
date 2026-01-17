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
  data?: {
    title?: string;
    firstname?: string;
    middlename?: string;
    surname?: string;
    nin?: string;
    photo?: string;
    [key: string]: any;
  };
  timestamp?: string;
};

/* =========================
   Preflight
========================= */

export async function OPTIONS(req: Request) {
  return handleOptions(req as unknown as NextRequest);
}

/* =========================
   POST /api/kyc/nin
========================= */

export async function POST(req: NextRequest) {
  try {
    /* ---------- Parse body ---------- */
    const body = (await req.json()) as NinRequestBody;
    const { nin } = body;

    /* ---------- Validate input ---------- */
    if (!nin) {
      return withCors(
        req,
        { success: false, error: "NIN is required" },
        400
      );
    }

    if (!/^\d{11}$/.test(nin)) {
      return withCors(
        req,
        { success: false, error: "NIN must be 11 digits" },
        400
      );
    }

    /* ---------- Load env vars ---------- */
    const NETAPPS_URL = process.env.NETAPPS_URL;
    const NETAPPS_SECRET_KEY = process.env.NETAPPS_SECRET_KEY;

    if (!NETAPPS_URL || !NETAPPS_SECRET_KEY) {
      return withCors(
        req,
        {
          success: false,
          error: "Netapps KYC service is not configured",
        },
        500
      );
    }

    /* ---------- Call Netapps ---------- */
    const response = await fetch(NETAPPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": NETAPPS_SECRET_KEY, // ✅ CORRECT AUTH HEADER
      },
      body: JSON.stringify({ nin }),
    });

    const data = (await response.json()) as NetappsNinResponse;

    /* ---------- Handle Netapps failure ---------- */
    if (!response.ok || data?.error) {
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
