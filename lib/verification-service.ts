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
const VERIFICATION_URL = "https://kyc-api.netapps.ng/api/v1/kyc/nin";

/**
 * Validates NIN format and verifies it with NetApps KYC API
 */
export async function verifyNIN(nin: string): Promise<VerificationResult> {
  // Validate input format
  const validationError = validateNIN(nin);
  if (validationError) {
    return createErrorResult(validationError);
  }

  // Check API key
  const apiKey = process.env.NETAPPS_SECRET_KEY;
  if (!apiKey) {
    return createErrorResult("NETAPPS_SECRET_KEY is missing in environment.");
  }

  try {
    // Make API request
    const response = await fetch(VERIFICATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": apiKey,
      },
      body: JSON.stringify({ nin }),
    });

    // Parse response with proper type handling
    const responseData = await response.json();
    const data = responseData as NetAppsNINResponse;
    
    console.log("NIN verification response:", data);

    // Process API response
    return processAPIResponse(data);
  } catch (error: any) {
    console.error("Error verifying NIN:", error?.message || error);
    return createErrorResult("Something went wrong during NIN verification.");
  }
}

/**
 * Validates NIN format
 */
function validateNIN(nin: string): string | null {
  if (!nin || typeof nin !== 'string') {
    return "NIN must be a string.";
  }

  if (!NIN_REGEX.test(nin.trim())) {
    return "Invalid NIN format. NIN must be exactly 11 digits.";
  }

  return null;
}

/**
 * Processes the API response and returns standardized result
 */
function processAPIResponse(data: NetAppsNINResponse): VerificationResult {
  const status = data?.status?.toLowerCase();
  const hasValidData = data?.data && typeof data.data === 'object';

  if (status === "successful" && hasValidData) {
    return {
      verified: true,
      message: data.message || "NIN verified successfully",
      data: data.data,
    };
  }

  return {
    verified: false,
    message: data?.message || data?.error || "NIN verification failed",
    data: null,
  };
}

/**
 * Creates a standardized error result
 */
function createErrorResult(message: string): VerificationResult {
  return {
    verified: false,
    message,
    data: null,
  };
}

/**
 * BVN verification placeholder
 */
export async function verifyBVN(bvn: string): Promise<VerificationResult> {
  // TODO: Implement BVN verification when ready
  return createErrorResult("BVN verification not implemented yet");
}