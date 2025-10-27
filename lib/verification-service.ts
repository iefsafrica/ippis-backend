interface VerificationResult {
  verified: boolean;
  message: string;
  data: any | null;
}

interface NetAppsNINResponse {
  status?: string;
  message?: string;
  data?: any;
  error?: string;
  code?: number;
}

const NIN_REGEX = /^\d{11}$/;
const VERIFICATION_URL = process.env.NETAPPS_URL || "https://kyc-api.netapps.ng/api/v1/kyc/nin";

/**
 *  Verifies NIN with NetApps KYC API
 */
export async function verifyNIN(nin: string): Promise<VerificationResult> {
  // Step 1: Validate NIN format
  const validationError = validateNIN(nin);
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
      body: JSON.stringify({ nin }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Step 4: Handle HTTP errors
    if (!response.ok) {
      const text = await response.text();
      console.error("NIN verification HTTP error:", response.status, text);
      return createErrorResult(`API request failed (${response.status}): ${text}`);
    }

    // Step 5: Safely parse response
    let data: NetAppsNINResponse;
try {
  data = (await response.json()) as NetAppsNINResponse;
} catch {
  const raw = await response.text();
  console.error("Invalid JSON response from NetApps:", raw);
  return createErrorResult("Invalid JSON response from verification API.");
}


    console.log("NIN verification response:", data);

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

/**
 * Interprets API response
 */
function processAPIResponse(data: NetAppsNINResponse): VerificationResult {
  const status = data?.status?.toLowerCase();
  const hasValidData = data?.data && typeof data.data === "object";

  if (status === "successful" && hasValidData) {
    return {
      verified: true,
      message: data.message || "NIN verified successfully.",
      data: data.data,
    };
  }

  // Handle specific known messages from API
  const message = data?.message || data?.error || "NIN verification failed.";

  return {
    verified: false,
    message,
    data: null,
  };
}

/**
 *  Creates standardized error result
 */
function createErrorResult(message: string): VerificationResult {
  return { verified: false, message, data: null };
}

/**
 * Placeholder for BVN verification (to be implemented)
 */
export async function verifyBVN(bvn: string): Promise<VerificationResult> {
  return createErrorResult("BVN verification not implemented yet.");
}
