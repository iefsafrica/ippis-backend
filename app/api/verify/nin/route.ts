import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../../lib/cors";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

type NetAppsWhiteLabelResponse = {
  error: boolean;
  message: string;
  kycType: string;
  kycTypeDisplayName: string;
  verifiedAt: string;
  data: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender?: string;
    phone?: string;
  };
};

export async function POST(req: NextRequest) {
  try {
    const jsonBody = await req.json();
    const body: { nin?: string } = jsonBody ?? {};

    if (!body.nin) {
      return withCors(req, {
        success: false,
        error: "nin is required",
      }, 400);
    }

    const response = await fetch(
      "https://kyc-api.netapps.ng/api/v1/whitelabel/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-secret-key": process.env.NETAPPS_SECRET_KEY as string,
        },
        body: JSON.stringify({
          kycType: "nin",
          nin: body.nin,
        }),
      }
    );

    const data = (await response.json()) as NetAppsWhiteLabelResponse;

    if (!response.ok || data.error) {
      return withCors(req, {
        success: false,
        error: "NIN verification failed",
        details: data,
      }, 400);
    }

    return withCors(req, {
      success: true,
      message: "NIN verified successfully",
      data,
    }, 200);

  } catch (error) {
    console.error("NetApps WhiteLabel Error:", error);

    return withCors(req, {
      success: false,
      error: "Failed to verify NIN",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}