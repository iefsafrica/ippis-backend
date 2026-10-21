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
      return createErrorResult(`Invalid JSON from API (Status: ${response.status}): ${raw.substring(0, 200)}`, response.status);
    }

    if (!response.ok) {
      return createErrorResult(
        data.message || "API request failed",
        response.status,
        data
      );
    }

    return normalizeResponse(data);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return createErrorResult("Request timed out");
    }

    return createErrorResult(`Unexpected error during verification: ${err?.message || String(err)}`, 500, {
      stack: err?.stack
    });
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
function extractPhoto(data: any): string | null {
  if (!data) return null;
  const candidates = [
    data.photo,
    data.data?.photo,
    data.photo_base64,
    data.data?.photo_base64,
    data.photoBase64,
    data.data?.photoBase64,
    data.image,
    data.data?.image,
    data.passport,
    data.data?.passport,
    data.picture,
    data.data?.picture,
    data.avatar,
    data.data?.avatar,
    data.selfie,
    data.data?.selfie,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const trimmed = candidate.trim();
      if (
        trimmed.startsWith("data:image/") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
      ) {
        return trimmed;
      }
      return `data:image/jpeg;base64,${trimmed}`;
    }
  }

  return null;
}

function normalizeResponse(data: NetAppsNINResponse): VerificationResult {
  const photo = extractPhoto(data);
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
    if (photo && typeof data.data === "object") {
      data.data.photo = photo;
      data.data.photo_base64 = photo;
      data.data.image = photo;
      data.data.passport = photo;
      data.data.profileImage = photo;
    }
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
    if (photo && typeof data.data === "object") {
      data.data.photo = photo;
      data.data.photo_base64 = photo;
      data.data.image = photo;
      data.data.passport = photo;
      data.data.profileImage = photo;
    }
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
        ...data,
        nin: ninValue,
        firstname: data.firstname ?? data.first_name ?? null,
        surname: data.surname ?? data.last_name ?? null,
        middlename: data.middlename ?? data.middle_name ?? null,
        gender: data.gender ?? data.sex ?? null,
        birthdate: data.birthdate ?? data.date_of_birth ?? data.birth_date ?? data.dateOfBirth ?? data.dob ?? null,
        telephoneno: data.telephoneno ?? data.phone ?? data.phone_number ?? null,
        residenceAdressLine1: data.residenceAdressLine1 ?? data.residence_address ?? null,
        residenceTown: data.residenceTown ?? null,
        residenceLga: data.residenceLga ?? data.lga ?? null,
        residenceState: data.residenceState ?? data.state ?? null,
        ...(photo ? { photo, photo_base64: photo, image: photo, passport: photo, profileImage: photo } : {}),
      },
    };
  }

  /**
   * FAIL CASE
   */
  return {
    verified: false,
    message: data?.message || "NIN verification failed",
    data: data, // pass the raw response back to inspect the exact failure
  };
}

/**
 * ERROR HELPER (fixes exactOptionalPropertyTypes issue)
 */
function createErrorResult(
  message: string,
  statusCode?: number,
  errorData?: any
): VerificationResult {
  const result: VerificationResult = {
    verified: false,
    message,
    data: errorData || null,
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