import { createHmac } from "crypto";

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

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
  }
  return "";
}

function requiredEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function generateSmileSignature(
  timestampIso: string,
  partnerId: string,
  signatureApiKey: string,
): string {
  const hmac = createHmac("sha256", signatureApiKey);
  hmac.update(timestampIso, "utf8");
  hmac.update(partnerId, "utf8");
  hmac.update("sid_request", "utf8");
  return hmac.digest("base64");
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
  const resolvedPartnerId = partnerId;
  const resolvedApiKey = apiKey;
  const signatureApiKey = requiredEnv("SMILE_ID_SIGNATURE_API_KEY") || resolvedApiKey;

  const baseUrl = process.env.SMILE_ID_BASE_URL || DEFAULT_BASE_URL;
  const callbackUrl = payload.callbackUrl || process.env.SMILE_ID_CALLBACK_URL;
  const timestamp = new Date().toISOString();
  const signature = generateSmileSignature(timestamp, resolvedPartnerId, signatureApiKey);

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
      "x-api-key": resolvedApiKey,
      "smile-partner-id": resolvedPartnerId,
    },
    body: JSON.stringify({
      partner_id: resolvedPartnerId,
      timestamp,
      signature,
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

  const responseData = toRecord(parsedResponse.data);
  const responseResult = toRecord(parsedResponse.result);

  const resolvedJobId =
    pickString(
      parsedResponse.job_id,
      parsedResponse.jobId,
      parsedResponse.smile_job_id,
      parsedResponse.smileJobId,
      responseData?.job_id,
      responseData?.jobId,
      responseData?.smile_job_id,
      responseData?.smileJobId,
      responseResult?.job_id,
      responseResult?.jobId,
      responseResult?.smile_job_id,
      responseResult?.smileJobId,
    ) || `smile-${Date.now()}`;

  const resolvedSmileJobId = pickString(
    parsedResponse.smile_job_id,
    parsedResponse.smileJobId,
    responseData?.smile_job_id,
    responseData?.smileJobId,
    responseResult?.smile_job_id,
    responseResult?.smileJobId,
    parsedResponse.job_id,
    parsedResponse.jobId,
    responseData?.job_id,
    responseData?.jobId,
    responseResult?.job_id,
    responseResult?.jobId,
  );

  return {
    provider: "smile-id",
    status: "pending",
    jobId: resolvedJobId,
    smileJobId: resolvedSmileJobId || undefined,
    message: "Verification submitted to Smile ID.",
  };
}

export type { SmileIdVerificationPayload, SmileIdVerificationResult };
