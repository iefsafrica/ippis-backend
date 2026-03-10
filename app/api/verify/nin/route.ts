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
verifiedAt?: string;
data?: {
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
  return withCors(
    req,
    {
      success: false,
      error: "nin is required",
    },
    400
  );
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

// If NIN is not verified or API returned error
if (!response.ok || data.error) {
  return withCors(
    req,
    {
      success: true,
      verified: false,
      message:
        "NIN could not be verified. You can continue filling the form manually.",
    },
    200
  );
}

// Verified successfully
return withCors(
  req,
  {
    success: true,
    verified: true,
    message: "NIN verified successfully",
    data: data.data,
  },
  200
);
} catch (error) {
console.error("NetApps WhiteLabel Error:", error);

// Network/API failure should not block the form
return withCors(
  req,
  {
    success: true,
    verified: false,
    message:
      "NIN verification service unavailable. Please continue filling the form manually.",
  },
  200
);

}
}
