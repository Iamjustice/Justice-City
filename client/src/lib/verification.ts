import { apiRequest } from "@/lib/queryClient";

export interface VerificationRequest {
  mode: "kyc" | "biometric";
  userId: string;
  verificationId?: string;
  country?: string;
  idType?: string;
  idNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  selfieImageBase64?: string;
}

export interface VerificationResponse {
  provider: "smile-id" | "mock";
  status: "approved" | "pending";
  jobId: string;
  smileJobId?: string;
  message: string;
}

export interface VerificationStatusResponse {
  userId: string;
  isVerified: boolean;
  userRowFound: boolean;
  latestStatus: "approved" | "pending" | "failed" | null;
  latestJobId: string | null;
  latestSmileJobId: string | null;
  latestProvider: "smile-id" | "mock" | null;
  latestMessage: string | null;
  latestUpdatedAt: string | null;
}

export interface PhoneOtpSendResponse {
  ok: boolean;
  status: string;
  to: string;
  channel: string;
  cooldownSec?: number;
}

export interface PhoneOtpCheckResponse {
  ok: boolean;
  valid: boolean;
  status: string;
  to: string;
  message?: string;
  attemptsRemaining?: number;
}

export interface PhoneOtpPolicy {
  sendCooldownSec: number;
  maxSendsPerWindow: number;
  sendWindowSec: number;
  maxVerifyAttempts: number;
  verifyBlockSec: number;
}

export interface VerificationDocumentUploadPayload {
  userId: string;
  documentType: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  contentBase64: string;
  verificationId?: string;
}

export interface VerificationDocumentUploadResponse {
  verificationId: string;
  documentId: string;
  bucketId: string;
  storagePath: string;
  previewUrl?: string;
}

export class VerificationApiError extends Error {
  status: number;
  retryAfterSec?: number;
  attemptsRemaining?: number;
  policy?: PhoneOtpPolicy;

  constructor(
    message: string,
    status: number,
    metadata?: {
      retryAfterSec?: number;
      attemptsRemaining?: number;
      policy?: PhoneOtpPolicy;
    },
  ) {
    super(message);
    this.name = "VerificationApiError";
    this.status = status;
    this.retryAfterSec = metadata?.retryAfterSec;
    this.attemptsRemaining = metadata?.attemptsRemaining;
    this.policy = metadata?.policy;
  }
}

export function getSmileLinkFallbackUrl(): string | null {
  const value = import.meta.env.VITE_SMILE_LINK_FALLBACK_URL;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function submitVerification(
  payload: VerificationRequest,
): Promise<VerificationResponse> {
  const response = await apiRequest("POST", "/api/verification/smile-id", payload);
  return response.json();
}

export async function fetchVerificationStatus(
  userId: string,
): Promise<VerificationStatusResponse> {
  const response = await apiRequest(
    "GET",
    `/api/verification/status/${encodeURIComponent(userId)}`,
  );
  return response.json();
}

async function requestVerificationJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message = String(payload.message ?? `Request failed with status ${response.status}`);
    const retryAfterSec =
      typeof payload.retryAfterSec === "number" && Number.isFinite(payload.retryAfterSec)
        ? Math.max(0, Math.floor(payload.retryAfterSec))
        : undefined;
    const attemptsRemaining =
      typeof payload.attemptsRemaining === "number" && Number.isFinite(payload.attemptsRemaining)
        ? Math.max(0, Math.floor(payload.attemptsRemaining))
        : undefined;
    const policy =
      typeof payload.policy === "object" && payload.policy !== null
        ? (payload.policy as PhoneOtpPolicy)
        : undefined;
    throw new VerificationApiError(message, response.status, {
      retryAfterSec,
      attemptsRemaining,
      policy,
    });
  }

  return payload as T;
}

export async function sendPhoneOtp(phone: string): Promise<PhoneOtpSendResponse> {
  return requestVerificationJson<PhoneOtpSendResponse>("/api/verification/phone/send", { phone });
}

export async function verifyPhoneOtp(
  phone: string,
  code: string,
  userId?: string,
): Promise<PhoneOtpCheckResponse> {
  const payload: { phone: string; code: string; userId?: string } = {
    phone,
    code,
  };
  if (userId) {
    payload.userId = userId;
  }

  return requestVerificationJson<PhoneOtpCheckResponse>("/api/verification/phone/check", payload);
}

export async function sendEmailOtp(email: string): Promise<PhoneOtpSendResponse> {
  return requestVerificationJson<PhoneOtpSendResponse>("/api/verification/email/send", { email });
}

export async function verifyEmailOtp(
  email: string,
  code: string,
  userId?: string,
): Promise<PhoneOtpCheckResponse> {
  const payload: { email: string; code: string; userId?: string } = {
    email,
    code,
  };
  if (userId) {
    payload.userId = userId;
  }
  return requestVerificationJson<PhoneOtpCheckResponse>("/api/verification/email/check", payload);
}

export async function uploadVerificationDocument(
  payload: VerificationDocumentUploadPayload,
): Promise<VerificationDocumentUploadResponse> {
  return requestVerificationJson<VerificationDocumentUploadResponse>(
    "/api/verification/documents/upload",
    payload as unknown as Record<string, unknown>,
  );
}
