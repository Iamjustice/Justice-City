interface SmileIdVerificationPayload {
  mode: "kyc" | "biometric";
  userId: string;
  country?: string;
  idType?: string;
  idNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  selfieImageBase64?: string;
  callbackUrl?: string;
}

interface SmileIdVerificationResult {
  provider: "smile-id" | "mock";
  status: "approved" | "pending";
  jobId: string;
  smileJobId?: string;
  message: string;
}

const DEFAULT_BASE_URL = "https://api.smileidentity.com";

function requiredEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function getModePath(mode: SmileIdVerificationPayload["mode"]): string {
  if (mode === "kyc") {
    return process.env.SMILE_ID_KYC_PATH || "/v1/biometric_kyc";
  }

  return process.env.SMILE_ID_BIOMETRIC_PATH || "/v1/biometric_kyc";
}

export async function submitSmileIdVerification(
  payload: SmileIdVerificationPayload,
): Promise<SmileIdVerificationResult> {
  const partnerId = requiredEnv("SMILE_ID_PARTNER_ID");
  const apiKey = requiredEnv("SMILE_ID_API_KEY");

  if (!partnerId || !apiKey) {
    if (isProduction()) {
      throw new Error(
        "Smile ID credentials are required in production. Set SMILE_ID_PARTNER_ID and SMILE_ID_API_KEY.",
      );
    }

    return {
      provider: "mock",
      status: "approved",
      jobId: `mock-${Date.now()}`,
      message:
        "Smile ID credentials are not configured. Running in safe mock mode for local development.",
    };
  }

  const baseUrl = process.env.SMILE_ID_BASE_URL || DEFAULT_BASE_URL;
  const callbackUrl = payload.callbackUrl || process.env.SMILE_ID_CALLBACK_URL;

  if (!callbackUrl) {
    if (isProduction()) {
      throw new Error(
        "SMILE_ID_CALLBACK_URL is required in production when payload.callbackUrl is not provided.",
      );
    }
  }

  const response = await fetch(`${baseUrl}${getModePath(payload.mode)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "smile-partner-id": partnerId,
    },
    body: JSON.stringify({
      partner_id: partnerId,
      partner_params: {
        user_id: payload.userId,
      },
      callback_url: callbackUrl ?? "https://justicecityltd.com/api/verification/smile-id/callback",
      country: payload.country,
      id_type: payload.idType,
      id_number: payload.idNumber,
      first_name: payload.firstName,
      last_name: payload.lastName,
      dob: payload.dateOfBirth,
      selfie_image: payload.selfieImageBase64,
      verification_mode: payload.mode,
    }),
  });

  const responseText = await response.text();
  let parsedResponse: Record<string, unknown> = {};

  try {
    parsedResponse = responseText ? JSON.parse(responseText) : {};
  } catch {
    parsedResponse = { raw: responseText };
  }

  if (!response.ok) {
    const message =
      typeof parsedResponse.message === "string"
        ? parsedResponse.message
        : `Smile ID request failed with status ${response.status}`;

    throw new Error(message);
  }

  return {
    provider: "smile-id",
    status: "pending",
    jobId: String(parsedResponse.job_id ?? parsedResponse.jobId ?? Date.now()),
    smileJobId: String(parsedResponse.smile_job_id ?? ""),
    message: "Verification submitted to Smile ID.",
  };
}

export type { SmileIdVerificationPayload, SmileIdVerificationResult };
