import { createHmac, randomUUID } from "crypto";

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

function toPositiveInt(rawValue: string | null, fallback: number): number {
  const parsed = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveSmileJobType(mode: SmileIdVerificationPayload["mode"]): number {
  if (mode === "kyc") {
    return toPositiveInt(requiredEnv("SMILE_ID_KYC_JOB_TYPE"), 6);
  }
  return toPositiveInt(requiredEnv("SMILE_ID_BIOMETRIC_JOB_TYPE"), 1);
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
    return process.env.SMILE_ID_KYC_PATH || "/v1/upload";
  }

  return process.env.SMILE_ID_BIOMETRIC_PATH || "/v1/upload";
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
  const sourceSdkVersion =
    String(process.env.SMILE_ID_SOURCE_SDK_VERSION ?? "").trim() || "1.0.0";
  const partnerJobId = `jc-${payload.mode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const jobType = resolveSmileJobType(payload.mode);

  if (!callbackUrl) {
    if (isProduction()) {
      throw new Error(
        "SMILE_ID_CALLBACK_URL is required in production when payload.callbackUrl is not provided.",
      );
    }
  }

  const requestBody: Record<string, unknown> = {
    partner_id: resolvedPartnerId,
    smile_client_id: resolvedPartnerId,
    timestamp,
    signature,
    source_sdk: "rest_api",
    source_sdk_version: sourceSdkVersion,
    partner_params: {
      user_id: payload.userId,
      job_id: partnerJobId,
      job_type: jobType,
    },
    model_parameters: {},
  };
  if (callbackUrl) {
    requestBody.callback_url = callbackUrl;
  }

  const response = await fetch(`${baseUrl}${getModePath(payload.mode)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": resolvedApiKey,
      "smile-partner-id": resolvedPartnerId,
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let parsedResponse: Record<string, unknown> = {};

  try {
    parsedResponse = responseText ? JSON.parse(responseText) : {};
  } catch {
    parsedResponse = { raw: responseText };
  }

  if (!response.ok) {
    const errorData = toRecord(parsedResponse.data);
    const errorResult = toRecord(parsedResponse.result);
    const smileErrorCode = pickString(
      parsedResponse.code,
      parsedResponse.result_code,
      parsedResponse.ResultCode,
      errorData?.code,
      errorData?.result_code,
      errorData?.ResultCode,
      errorResult?.code,
      errorResult?.result_code,
      errorResult?.ResultCode,
    );
    const smileErrorMessage = pickString(
      parsedResponse.message,
      parsedResponse.error,
      parsedResponse.ResultText,
      errorData?.message,
      errorData?.error,
      errorData?.ResultText,
      errorResult?.message,
      errorResult?.error,
      errorResult?.ResultText,
      typeof parsedResponse.raw === "string" ? parsedResponse.raw : "",
      response.statusText,
    );
    const codeSuffix = smileErrorCode ? ` (${smileErrorCode})` : "";
    const detail = smileErrorMessage || "Unknown Smile ID error";
    throw new Error(`Smile ID request failed with status ${response.status}${codeSuffix}: ${detail}`);
  }

  const responseData = toRecord(parsedResponse.data);
  const responseResult = toRecord(parsedResponse.result);
  const responsePartnerParams =
    toRecord(parsedResponse.partner_params) ??
    toRecord(responseData?.partner_params) ??
    toRecord(responseResult?.partner_params);

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
      responsePartnerParams?.job_id,
      responsePartnerParams?.jobId,
      partnerJobId,
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
