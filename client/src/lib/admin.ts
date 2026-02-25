import { apiRequest } from "@/lib/queryClient";

export type AdminVerificationStatus = "Awaiting Review" | "Approved" | "Rejected";
export type AdminFlaggedListingStatus = "Open" | "Under Review" | "Cleared";

export type AdminVerificationDocument = {
  name: string;
  url: string;
};

export type AdminVerificationRecord = {
  id: string;
  userId: string;
  user: string;
  type: "Agent" | "Seller";
  documents: AdminVerificationDocument[];
  status: AdminVerificationStatus;
  createdAt: string;
};

export type AdminFlaggedListingComment = {
  id: string;
  listingId: string;
  comment: string;
  problemTag: string;
  createdBy: string;
  createdAt: string;
  sentToChat: boolean;
};

export type AdminFlaggedListingRecord = {
  id: string;
  title: string;
  location: string;
  reason: string;
  status: AdminFlaggedListingStatus;
  affectedUserId: string;
  affectedUserName: string;
  comments: AdminFlaggedListingComment[];
  updatedAt: string;
};

export type AdminUserRecord = {
  id: string;
  name: string;
  role: "Buyer" | "Seller" | "Agent";
  email: string;
  status: "Active" | "Suspended";
  joinedAt: string;
};

export type AdminRevenueRecord = {
  id: string;
  month: string;
  date: string;
  source: string;
  grossAmount: number;
  netRevenue: number;
  status: "Received" | "Pending";
};

export type AdminRevenueTrendPoint = {
  label: string;
  amount: number;
};

export type AdminDashboardData = {
  overview: {
    commissionRate: number;
    totalUsers: number;
    pendingVerifications: number;
    flaggedListings: number;
    revenueJanLabel: string;
  };
  users: AdminUserRecord[];
  verifications: AdminVerificationRecord[];
  flaggedListings: AdminFlaggedListingRecord[];
  revenue: {
    records: AdminRevenueRecord[];
    trend: AdminRevenueTrendPoint[];
  };
};

export type AdminDisputeResolutionStatus = "resolved" | "rejected" | "cancelled";

export type AdminOpenDispute = {
  id: string;
  transactionId: string;
  conversationId: string;
  openedByUserId: string | null;
  againstUserId: string | null;
  reason: string;
  details: string | null;
  status: "open" | "resolved" | "rejected" | "cancelled";
  resolution: string | null;
  resolutionTargetStatus: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AdminServicePdfJob = {
  id: string;
  conversationId: string;
  serviceRequestId: string | null;
  transactionId: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  attemptCount: number;
  maxAttempts: number;
  outputBucket: string;
  outputPath: string | null;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const response = await apiRequest("GET", "/api/admin/dashboard");
  return response.json();
}

export async function updateAdminVerificationStatus(
  verificationId: string,
  status: AdminVerificationStatus,
): Promise<void> {
  await apiRequest("PATCH", `/api/admin/verifications/${verificationId}`, { status });
}

export async function updateAdminFlaggedListingStatus(
  listingId: string,
  status: AdminFlaggedListingStatus,
): Promise<void> {
  await apiRequest("PATCH", `/api/admin/flagged-listings/${listingId}/status`, { status });
}

export async function addAdminFlaggedListingComment(
  listingId: string,
  payload: { comment: string; problemTag: string; createdBy: string; createdById?: string },
): Promise<AdminFlaggedListingComment> {
  const response = await apiRequest("POST", `/api/admin/flagged-listings/${listingId}/comments`, payload);
  return response.json();
}

export async function fetchAdminOpenDisputes(options?: {
  limit?: number;
}): Promise<AdminOpenDispute[]> {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.trunc(options.limit))));
  }
  const query = params.toString();
  const response = await apiRequest("GET", `/api/disputes/open${query ? `?${query}` : ""}`);
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? (payload as AdminOpenDispute[]) : [];
}

export async function resolveAdminOpenDispute(
  disputeId: string,
  payload: {
    status: AdminDisputeResolutionStatus;
    resolution?: string;
    resolutionTargetStatus?: string;
    unfreezeEscrow?: boolean;
  },
): Promise<{ dispute: AdminOpenDispute; warnings?: string[] }> {
  const response = await apiRequest(
    "POST",
    `/api/disputes/${encodeURIComponent(disputeId)}/resolve`,
    payload,
  );
  return (await response.json()) as { dispute: AdminOpenDispute; warnings?: string[] };
}

export async function fetchAdminServicePdfJobs(options?: {
  status?: "queued" | "processing" | "completed" | "failed" | "all";
  limit?: number;
}): Promise<AdminServicePdfJob[]> {
  const params = new URLSearchParams();
  const status = String(options?.status ?? "all").trim().toLowerCase();
  if (
    status === "queued" ||
    status === "processing" ||
    status === "completed" ||
    status === "failed"
  ) {
    params.set("status", status);
  }
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.trunc(options.limit))));
  }
  const query = params.toString();
  const response = await apiRequest("GET", `/api/service-pdf-jobs${query ? `?${query}` : ""}`);
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? (payload as AdminServicePdfJob[]) : [];
}

export async function processNextAdminServicePdfJob(): Promise<{ job: AdminServicePdfJob | null }> {
  const response = await apiRequest("POST", "/api/service-pdf-jobs/process-next");
  return (await response.json()) as { job: AdminServicePdfJob | null };
}
