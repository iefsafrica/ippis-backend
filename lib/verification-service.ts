interface VerificationResult {
  verified: boolean;
  message: string;
  data: any | null;
  statusCode?: number;
}

interface NetAppsNINResponse {
  status?: string;
  message?: string;
  data?: any;
  error?: string | boolean;
  code?: number;

  nin?: string | number;
  firstname?: string;
  surname?: string;
  middlename?: string;
  gender?: string;
  birthdate?: string;
  telephoneno?: string;
  residenceAdressLine1?: string;
  residenceTown?: string;
  residenceLga?: string;
  residenceState?: string;

  [key: string]: any;
}

const NIN_REGEX = /^\d{11}$/;

const VERIFICATION_URL =
  process.env.NETAPPS_URL ||
  "https://kyc-api.netapps.ng/api/v1/kyc/nin";

/**
 * MAIN FUNCTION
 */
export async function verifyNIN(
  nin: string
): Promise<VerificationResult> {
  const normalizedNin = nin?.trim();

  const validationError = validateNIN(normalizedNin);
  if (validationError) {
    return createErrorResult(validationError);
  }

  const apiKey = process.env.NETAPPS_SECRET_KEY?.trim();
  if (!apiKey) {
    return createErrorResult("Missing NETAPPS_SECRET_KEY in environment.");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(VERIFICATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nin: normalizedNin }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const raw = await response.text();
    console.log("NETAPPS RAW RESPONSE:", raw);

    const data = safeParse(raw);

    if (!data) {
      return createErrorResult("Invalid JSON from API", response.status);
    }

    if (!response.ok) {
      return createErrorResult(
        data.message || "API request failed",
        response.status
      );
    }

    return normalizeResponse(data);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return createErrorResult("Request timed out");
    }

    return createErrorResult("Unexpected error during verification");
  }
}

/**
 * VALIDATION
 */
function validateNIN(nin: string): string | null {
  if (!nin || typeof nin !== "string") return "NIN must be a string";
  if (!NIN_REGEX.test(nin)) return "NIN must be exactly 11 digits";
  return null;
}

/**
 * SAFE JSON PARSE
 */
function safeParse(raw: string): NetAppsNINResponse | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 🔥 FIXED RESPONSE NORMALIZER (MAIN FIX IS HERE)
 */
function normalizeResponse(data: NetAppsNINResponse): VerificationResult {
  console.log("PARSED NETAPPS RESPONSE:", data);

  const status = data?.status?.toLowerCase();

  const hasDataObject =
    data?.data && typeof data.data === "object";

  const isSuccessStatus =
    status === "success" || status === "successful";

  const isBooleanSuccess =
    data?.error === false;

  // ✅ FIXED ROOT NIN HANDLING
  const ninValue =
    data?.nin !== undefined && data?.nin !== null
      ? String(data.nin).trim()
      : null;

  const hasRootNin =
    ninValue !== null && NIN_REGEX.test(ninValue);

  /**
   * CASE 1: wrapped success response
   */
  if (isSuccessStatus && hasDataObject) {
    return {
      verified: true,
      message: data.message || "NIN verified successfully",
      data: data.data,
    };
  }

  /**
   * CASE 2: boolean success response
   */
  if (isBooleanSuccess && hasDataObject) {
    return {
      verified: true,
      message: data.message || "NIN verified successfully",
      data: data.data,
    };
  }

  /**
   * CASE 3: ROOT LEVEL RESPONSE (YOUR REAL NETAPPS RESPONSE)
   */
  if (hasRootNin) {
    return {
      verified: true,
      message: "NIN verified successfully",
      data: {
        nin: ninValue,
        firstname: data.firstname ?? null,
        surname: data.surname ?? null,
        middlename: data.middlename ?? null,
        gender: data.gender ?? null,
        birthdate: data.birthdate ?? null,
        telephoneno: data.telephoneno ?? null,
        residenceAdressLine1: data.residenceAdressLine1 ?? null,
        residenceTown: data.residenceTown ?? null,
        residenceLga: data.residenceLga ?? null,
        residenceState: data.residenceState ?? null,
      },
    };
  }

  /**
   * FAIL CASE
   */
  return {
    verified: false,
    message: data?.message || "NIN verification failed",
    data: null,
  };
}

/**
 * ERROR HELPER (fixes exactOptionalPropertyTypes issue)
 */
function createErrorResult(
  message: string,
  statusCode?: number
): VerificationResult {
  const result: VerificationResult = {
    verified: false,
    message,
    data: null,
  };

  if (typeof statusCode === "number") {
    result.statusCode = statusCode;
  }

  return result;
}

/**
 * BVN placeholder
 */
export async function verifyBVN(
  bvn: string
): Promise<VerificationResult> {
  return {
    verified: false,
    message: "BVN verification not implemented yet",
    data: null,
  };
}