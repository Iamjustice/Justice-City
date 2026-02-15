import { apiRequest } from "@/lib/queryClient";

export interface VerificationRequest {
  mode: "kyc" | "biometric";
  userId: string;
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
