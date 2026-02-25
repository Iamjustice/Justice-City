import { apiRequest } from "@/lib/queryClient";

export type TransactionStatus =
  | "initiated"
  | "in_negotiation"
  | "escrow_requested"
  | "escrow_funded_pending_verification"
  | "escrow_funded"
  | "fulfillment_pending"
  | "delivered"
  | "acceptance_pending"
  | "completed"
  | "closing_scheduled"
  | "closing_pending_confirmation"
  | "closed"
  | "service_intake_pending"
  | "service_intake_submitted"
  | "quote_pending"
  | "quote_sent"
  | "quote_accepted"
  | "escrow_paid_pending_verification"
  | "mobilization_scheduled"
  | "mobilization_started"
  | "site_visit_completed"
  | "in_progress"
  | "deliverable_submitted"
  | "cancelled"
  | "disputed";

export type TransactionSummary = {
  id: string;
  conversationId: string;
  transactionKind: "sale" | "rent" | "service" | "booking";
  closingMode: "agent_led" | "direct" | null;
  status: TransactionStatus;
};

export type TransactionAction = {
  id: string;
  transactionId: string;
  conversationId: string;
  actionType: string;
  targetRole: string;
  status: "pending" | "accepted" | "declined" | "submitted" | "expired" | "cancelled";
  payload: Record<string, unknown>;
  expiresAt: string | null;
};

export type TransactionDispute = {
  id: string;
  transactionId: string;
  conversationId: string;
  reason: string;
  details: string | null;
  status: "open" | "resolved" | "rejected" | "cancelled";
  resolution: string | null;
  resolutionTargetStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TransactionStatusHistoryItem = {
  id: string;
  transactionId: string;
  fromStatus: string | null;
  toStatus: string;
  changedByUserId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PayoutLedgerStatus = "claimed" | "paid" | "failed" | "cancelled";

export type PayoutLedgerEntry = {
  id: string;
  transactionId: string;
  ledgerType: "payout" | "refund" | "commission";
  idempotencyKey: string;
  amount: number;
  currency: string;
  recipientUserId: string | null;
  status: PayoutLedgerStatus;
  reference: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ServicePdfJob = {
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

export type ServiceProviderLink = {
  id: string;
  conversationId: string;
  serviceRequestId: string | null;
  providerUserId: string | null;
  tokenHint: string | null;
  expiresAt: string;
  status: "active" | "opened" | "revoked" | "expired";
  openedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderPackageFile = {
  bucketId: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  createdAt?: string;
  signedUrl?: string;
};

export type ProviderPackage = {
  linkId: string;
  conversationId: string;
  serviceRequestId: string | null;
  providerUserId: string | null;
  status: string;
  expiresAt: string;
  openedAt: string | null;
  payload: Record<string, unknown>;
  attachments: ProviderPackageFile[];
  transcript?: ProviderPackageFile;
};

export async function getTransactionByConversation(
  conversationId: string,
): Promise<TransactionSummary | null> {
  const response = await fetch(
    `/api/transactions/by-conversation/${encodeURIComponent(conversationId)}`,
    { credentials: "include" },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as TransactionSummary;
}

export async function upsertTransactionForConversation(payload: {
  conversationId: string;
  transactionKind: "sale" | "rent" | "service" | "booking";
  closingMode?: "agent_led" | "direct" | null;
  status?: TransactionStatus;
  buyerUserId?: string;
  sellerUserId?: string;
  agentUserId?: string;
  providerUserId?: string;
}): Promise<TransactionSummary> {
  const response = await apiRequest("POST", "/api/transactions/upsert", payload);
  return (await response.json()) as TransactionSummary;
}

export async function listTransactionActions(
  transactionId: string,
): Promise<TransactionAction[]> {
  const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}/actions`, {
    credentials: "include",
  });
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as TransactionAction[];
}

export async function resolveTransactionAction(input: {
  actionId: string;
  actorUserId: string;
  actorName?: string;
  actorRole?: string;
  decision: "accept" | "decline" | "submit";
  payload?: Record<string, unknown>;
}): Promise<{
  action: TransactionAction;
  transaction: TransactionSummary;
  warnings?: string[];
}> {
  const response = await apiRequest(
    "POST",
    `/api/chat-actions/${encodeURIComponent(input.actionId)}/resolve`,
    input,
  );
  return (await response.json()) as {
    action: TransactionAction;
    transaction: TransactionSummary;
    warnings?: string[];
  };
}

export async function openDispute(input: {
  transactionId: string;
  conversationId?: string;
  reason: string;
  details?: string;
  openedByUserId?: string;
  openedByName?: string;
  openedByRole?: string;
}): Promise<{ dispute: TransactionDispute; warnings?: string[] }> {
  const response = await apiRequest(
    "POST",
    `/api/transactions/${encodeURIComponent(input.transactionId)}/disputes`,
    input,
  );
  return (await response.json()) as { dispute: TransactionDispute; warnings?: string[] };
}

export async function listDisputes(transactionId: string): Promise<TransactionDispute[]> {
  const response = await fetch(
    `/api/transactions/${encodeURIComponent(transactionId)}/disputes`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as TransactionDispute[];
}

export async function listTransactionStatusHistory(
  transactionId: string,
  options?: { limit?: number },
): Promise<TransactionStatusHistoryItem[]> {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.trunc(options.limit))));
  }

  const query = params.toString();
  const response = await fetch(
    `/api/transactions/${encodeURIComponent(transactionId)}/status-history${query ? `?${query}` : ""}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as TransactionStatusHistoryItem[];
}

export async function listPayoutLedger(
  transactionId: string,
  options?: { limit?: number },
): Promise<PayoutLedgerEntry[]> {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.trunc(options.limit))));
  }

  const query = params.toString();
  const response = await fetch(
    `/api/transactions/${encodeURIComponent(transactionId)}/payout-ledger${query ? `?${query}` : ""}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as PayoutLedgerEntry[];
}

export async function updatePayoutLedgerStatus(input: {
  entryId: string;
  status: PayoutLedgerStatus;
  actorRole?: string;
  actorUserId?: string;
  reason?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}): Promise<PayoutLedgerEntry> {
  const response = await apiRequest(
    "POST",
    `/api/payout-ledger/${encodeURIComponent(input.entryId)}/status`,
    {
      status: input.status,
      actorRole: input.actorRole,
      actorUserId: input.actorUserId,
      reason: input.reason,
      reference: input.reference,
      metadata: input.metadata,
    },
  );
  return (await response.json()) as PayoutLedgerEntry;
}

export async function queueServicePdfJob(input: {
  conversationId: string;
  transactionId?: string;
  serviceRequestId?: string;
  createdByUserId?: string;
  actorRole?: string;
}): Promise<ServicePdfJob> {
  const response = await apiRequest("POST", "/api/service-pdf-jobs", input);
  return (await response.json()) as ServicePdfJob;
}

export async function listServicePdfJobsByConversation(
  conversationId: string,
): Promise<ServicePdfJob[]> {
  const response = await fetch(
    `/api/service-pdf-jobs?conversationId=${encodeURIComponent(conversationId)}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as ServicePdfJob[];
}

export async function createProviderLink(input: {
  conversationId: string;
  providerUserId?: string;
  serviceRequestId?: string;
  createdByUserId?: string;
  createdByRole?: string;
  expiresAt?: string;
  payload?: Record<string, unknown>;
}): Promise<{
  link: ServiceProviderLink;
  token: string;
  packageUrl: string;
}> {
  const response = await apiRequest("POST", "/api/provider-links", input);
  return (await response.json()) as {
    link: ServiceProviderLink;
    token: string;
    packageUrl: string;
  };
}

export async function listProviderLinks(conversationId: string): Promise<ServiceProviderLink[]> {
  const response = await fetch(
    `/api/provider-links/by-conversation/${encodeURIComponent(conversationId)}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as ServiceProviderLink[];
}

export async function revokeProviderLink(linkId: string, actorRole: string): Promise<ServiceProviderLink> {
  const response = await apiRequest(
    "POST",
    `/api/provider-links/${encodeURIComponent(linkId)}/revoke`,
    { actorRole },
  );
  return (await response.json()) as ServiceProviderLink;
}

export async function fetchProviderPackage(token: string): Promise<ProviderPackage> {
  const response = await fetch(`/api/provider-package/${encodeURIComponent(token)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as ProviderPackage;
}
