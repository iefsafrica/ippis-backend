interface VerificationResult {
  verified: boolean;
  message: string;
  data: any | null;
  statusCode?: number | undefined;
}

interface NetAppsNINResponse {
  status?: string;
  message?: string;
  data?: any;
  error?: string | boolean;
  code?: number;
}

const NIN_REGEX = /^\d{11}$/;
const VERIFICATION_URL = process.env.NETAPPS_URL || "https://kyc-api.netapps.ng/api/v1/kyc/nin";

/**
 *  Verifies NIN with NetApps KYC API
 */
export async function verifyNIN(nin: string): Promise<VerificationResult> {
  // Step 1: Validate NIN format
  const normalizedNin = nin.trim();
  const validationError = validateNIN(normalizedNin);
  if (validationError) return createErrorResult(validationError);

  // Step 2: Get and validate API key
  const apiKey = process.env.NETAPPS_SECRET_KEY?.trim();
  if (!apiKey) return createErrorResult("Missing NETAPPS_SECRET_KEY in environment.");

  try {
    // Step 3: Send verification request with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

    const response = await fetch(VERIFICATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": apiKey,
      },
      body: JSON.stringify(buildNinVerificationPayload(VERIFICATION_URL, normalizedNin)),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const raw = await response.text();
    const data = parseNetappsResponse(raw);

    if (!data) {
      console.error("Invalid JSON response from NetApps:", raw);
      return createErrorResult("Invalid JSON response from verification API.", response.status);
    }

    if (!response.ok) {
      console.error("NIN verification HTTP error:", response.status, data);
      return createErrorResult(
        data.message || String(data.error || `API request failed (${response.status}).`),
        response.status
      );
    }

    // Step 6: Process response
    return processAPIResponse(data);
  } catch (error: any) {
    if (error.name === "AbortError") {
      return createErrorResult("Verification request timed out. Please try again.");
    }
    console.error(" Error verifying NIN:", error);
    return createErrorResult("Something went wrong during NIN verification.");
  }
}

/**
 * Validates NIN input format
 */
function validateNIN(nin: string): string | null {
  if (!nin || typeof nin !== "string") return "NIN must be a string.";
  if (!NIN_REGEX.test(nin.trim())) return "Invalid NIN format. Must be exactly 11 digits.";
  return null;
}

function buildNinVerificationPayload(url: string, nin: string) {
  if (url.includes("/whitelabel/verify")) {
    return {
      kycType: "nin",
      nin,
    };
  }

  return { nin };
}

function parseNetappsResponse(raw: string): NetAppsNINResponse | null {
  try {
    return JSON.parse(raw) as NetAppsNINResponse;
  } catch {
    return null;
  }
}

/**
 * Interprets API response
 */
function processAPIResponse(data: NetAppsNINResponse): VerificationResult {
  const status = data?.status?.toLowerCase();
  const hasValidData = data?.data && typeof data.data === "object";
  const hasBooleanSuccess = data?.error === false && hasValidData;

  if ((status === "successful" || status === "success" || hasBooleanSuccess) && hasValidData) {
    return {
      verified: true,
      message: data.message || "NIN verified successfully.",
      data: data.data,
    };
  }

  // Handle specific known messages from API
  const message = data?.message || (data?.error && typeof data.error === "string" ? data.error : "") || "NIN verification failed.";

  return {
    verified: false,
    message,
    data: null,
  };
}

/**
 *  Creates standardized error result
 */
function createErrorResult(message: string, statusCode?: number): VerificationResult {
  return { verified: false, message, data: null, statusCode };
}

/**
 * Placeholder for BVN verification (to be implemented)
 */
export async function verifyBVN(bvn: string): Promise<VerificationResult> {
  return createErrorResult("BVN verification not implemented yet.");
}
