import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
const TRANSACTIONS_TABLE = process.env.SUPABASE_TRANSACTIONS_TABLE || "transactions";
const CHAT_ACTIONS_TABLE = process.env.SUPABASE_CHAT_ACTIONS_TABLE || "chat_actions";
const TX_STATUS_HISTORY_TABLE =
  process.env.SUPABASE_TRANSACTION_STATUS_HISTORY_TABLE || "transaction_status_history";
const PAYOUT_LEDGER_TABLE = process.env.SUPABASE_PAYOUT_LEDGER_TABLE || "payout_ledger";
const TX_RATINGS_TABLE = process.env.SUPABASE_TRANSACTION_RATINGS_TABLE || "transaction_ratings";

export type TransactionKind = "sale" | "rent" | "service" | "booking";
export type ClosingMode = "agent_led" | "direct" | null;

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

export type ChatActionType =
  | "inspection_request"
  | "escrow_payment_request"
  | "upload_payment_proof"
  | "contract_prompt"
  | "request_signed_contract"
  | "schedule_meeting_request"
  | "upload_signed_closing_contract"
  | "mark_delivered"
  | "accept_delivery"
  | "service_intake_form"
  | "service_quote"
  | "upload_service_deliverable"
  | "rating_request";

export type ChatActionStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "submitted"
  | "expired"
  | "cancelled";

export type AppRole = "buyer" | "seller" | "agent" | "owner" | "renter" | "admin" | "support";

export type TransactionRecord = {
  id: string;
  conversationId: string;
  transactionKind: TransactionKind;
  closingMode: ClosingMode;
  status: TransactionStatus;
  buyerUserId: string | null;
  sellerUserId: string | null;
  agentUserId: string | null;
  providerUserId: string | null;
  currency: string;
  principalAmount: number | null;
  inspectionFeeAmount: number;
  inspectionFeeRefundable: boolean;
  inspectionFeeStatus: string;
  escrowReference: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TransactionStatusHistoryRecord = {
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

export type PayoutLedgerRecord = {
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

export type ChatActionRecord = {
  id: string;
  transactionId: string;
  conversationId: string;
  actionType: ChatActionType;
  targetRole: AppRole;
  status: ChatActionStatus;
  payload: Record<string, unknown>;
  createdByUserId: string | null;
  resolvedByUserId: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpsertTransactionInput = {
  conversationId: string;
  transactionKind: TransactionKind;
  closingMode?: ClosingMode;
  status?: TransactionStatus;
  buyerUserId?: string;
  sellerUserId?: string;
  agentUserId?: string;
  providerUserId?: string;
  currency?: string;
  principalAmount?: number | null;
  inspectionFeeAmount?: number;
  inspectionFeeRefundable?: boolean;
  inspectionFeeStatus?: string;
  metadata?: Record<string, unknown>;
};

type CreateChatActionInput = {
  transactionId: string;
  conversationId: string;
  actionType: ChatActionType;
  targetRole: AppRole;
  payload?: Record<string, unknown>;
  createdByUserId?: string;
  expiresAt?: string;
};

type ResolveChatActionInput = {
  actionId: string;
  actorUserId: string;
  actorRole: AppRole;
  decision: "accept" | "decline" | "submit";
  payload?: Record<string, unknown>;
};

type TransitionTransactionStatusInput = {
  transactionId: string;
  toStatus: TransactionStatus;
  actorUserId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

type ClaimPayoutInput = {
  transactionId: string;
  ledgerType: "payout" | "refund" | "commission";
  idempotencyKey: string;
  amount: number;
  currency?: string;
  recipientUserId?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  actorUserId?: string;
  reason?: string;
};

type UpdatePayoutLedgerStatusInput = {
  entryId: string;
  status: PayoutLedgerStatus;
  actorUserId?: string;
  reason?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
};

type UpsertTransactionRatingInput = {
  transactionId: string;
  raterUserId: string;
  stars: number;
  review?: string;
  ratedUserId?: string;
};

const RATING_EDIT_WINDOW_DAYS = Number.parseInt(
  String(process.env.TRANSACTION_RATING_EDIT_WINDOW_DAYS ?? "7"),
  10,
);

const ALLOWED_ACTION_TYPES = new Set<ChatActionType>([
  "inspection_request",
  "escrow_payment_request",
  "upload_payment_proof",
  "contract_prompt",
  "request_signed_contract",
  "schedule_meeting_request",
  "upload_signed_closing_contract",
  "mark_delivered",
  "accept_delivery",
  "service_intake_form",
  "service_quote",
  "upload_service_deliverable",
  "rating_request",
]);

function getClient(): SupabaseClient | null {
  const url = String(process.env.SUPABASE_URL ?? "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingTableOrColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function isDuplicateError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? "").trim();
  if (code === "23505") return true;
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return message.includes("duplicate key");
}

function normalizeRole(raw: unknown): AppRole {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (value === "admin") return "admin";
  if (value === "agent") return "agent";
  if (value === "seller") return "seller";
  if (value === "owner") return "owner";
  if (value === "renter") return "renter";
  if (value === "support") return "support";
  return "buyer";
}

function normalizeStatus(raw: unknown): TransactionStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "initiated";
  return value as TransactionStatus;
}

function normalizeTransactionKind(raw: unknown): TransactionKind {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "rent") return "rent";
  if (value === "service") return "service";
  if (value === "booking") return "booking";
  return "sale";
}

function normalizeClosingMode(raw: unknown): ClosingMode {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "direct") return "direct";
  if (value === "agent_led") return "agent_led";
  return null;
}

function normalizeActionType(raw: unknown): ChatActionType {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase() as ChatActionType;
  if (!ALLOWED_ACTION_TYPES.has(value)) {
    throw new Error("Unsupported action type.");
  }
  return value;
}

function normalizeActionStatus(raw: unknown): ChatActionStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase() as ChatActionStatus;
  if (
    value === "accepted" ||
    value === "declined" ||
    value === "submitted" ||
    value === "expired" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "pending";
}

function normalizeCurrency(raw: unknown): string {
  const value = String(raw ?? "NGN")
    .trim()
    .toUpperCase();
  return value || "NGN";
}

function normalizePayoutLedgerStatus(raw: unknown): PayoutLedgerStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "paid") return "paid";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "claimed";
}

function normalizeIsoTimestamp(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toPositiveNumberOrZero(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function toObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function mapTransactionRow(row: Record<string, unknown>): TransactionRecord {
  return {
    id: String(row.id ?? ""),
    conversationId: String(row.conversation_id ?? ""),
    transactionKind: normalizeTransactionKind(row.transaction_kind),
    closingMode: normalizeClosingMode(row.closing_mode),
    status: normalizeStatus(row.status),
    buyerUserId: row.buyer_user_id ? String(row.buyer_user_id) : null,
    sellerUserId: row.seller_user_id ? String(row.seller_user_id) : null,
    agentUserId: row.agent_user_id ? String(row.agent_user_id) : null,
    providerUserId: row.provider_user_id ? String(row.provider_user_id) : null,
    currency: normalizeCurrency(row.currency),
    principalAmount: toNumberOrNull(row.principal_amount),
    inspectionFeeAmount: toPositiveNumberOrZero(row.inspection_fee_amount),
    inspectionFeeRefundable: Boolean(row.inspection_fee_refundable ?? true),
    inspectionFeeStatus: String(row.inspection_fee_status ?? "not_applicable"),
    escrowReference: row.escrow_reference ? String(row.escrow_reference) : null,
    metadata: toObject(row.metadata),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapChatActionRow(row: Record<string, unknown>): ChatActionRecord {
  return {
    id: String(row.id ?? ""),
    transactionId: String(row.transaction_id ?? ""),
    conversationId: String(row.conversation_id ?? ""),
    actionType: normalizeActionType(row.action_type),
    targetRole: normalizeRole(row.target_role),
    status: normalizeActionStatus(row.status),
    payload: toObject(row.payload),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    resolvedByUserId: row.resolved_by_user_id ? String(row.resolved_by_user_id) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapStatusHistoryRow(row: Record<string, unknown>): TransactionStatusHistoryRecord {
  return {
    id: String(row.id ?? ""),
    transactionId: String(row.transaction_id ?? ""),
    fromStatus: row.from_status ? String(row.from_status) : null,
    toStatus: String(row.to_status ?? ""),
    changedByUserId: row.changed_by_user_id ? String(row.changed_by_user_id) : null,
    reason: row.reason ? String(row.reason) : null,
    metadata: toObject(row.metadata),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapPayoutLedgerRow(row: Record<string, unknown>): PayoutLedgerRecord {
  const normalizedLedgerType = String(row.ledger_type ?? "").trim().toLowerCase();
  const ledgerType: "payout" | "refund" | "commission" =
    normalizedLedgerType === "refund"
      ? "refund"
      : normalizedLedgerType === "commission"
        ? "commission"
        : "payout";

  return {
    id: String(row.id ?? ""),
    transactionId: String(row.transaction_id ?? ""),
    ledgerType,
    idempotencyKey: String(row.idempotency_key ?? ""),
    amount: toPositiveNumberOrZero(row.amount),
    currency: normalizeCurrency(row.currency),
    recipientUserId: row.recipient_user_id ? String(row.recipient_user_id) : null,
    status: normalizePayoutLedgerStatus(row.status),
    reference: row.reference ? String(row.reference) : null,
    metadata: toObject(row.metadata),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function normalizeNextActionStatus(decision: "accept" | "decline" | "submit"): ChatActionStatus {
  if (decision === "accept") return "accepted";
  if (decision === "decline") return "declined";
  return "submitted";
}

function isTerminalStatus(status: TransactionStatus): boolean {
  return status === "completed" || status === "closed" || status === "cancelled";
}

function resolveAllowedTransitions(
  transactionKind: TransactionKind,
  closingMode: ClosingMode,
  currentStatus: TransactionStatus,
): Set<TransactionStatus> {
  const terminal = new Set<TransactionStatus>();
  if (isTerminalStatus(currentStatus)) return terminal;

  if (transactionKind === "service") {
    const serviceTransitions: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
      initiated: ["service_intake_pending", "service_intake_submitted", "quote_pending", "cancelled"],
      service_intake_pending: ["service_intake_submitted", "cancelled"],
      service_intake_submitted: ["quote_pending", "quote_sent", "cancelled"],
      quote_pending: ["quote_sent", "cancelled"],
      quote_sent: ["quote_accepted", "cancelled"],
      quote_accepted: ["escrow_requested", "cancelled"],
      escrow_requested: ["escrow_paid_pending_verification", "disputed", "cancelled"],
      escrow_paid_pending_verification: ["escrow_funded", "disputed", "cancelled"],
      escrow_funded: ["mobilization_scheduled", "disputed", "cancelled"],
      mobilization_scheduled: ["mobilization_started", "disputed", "cancelled"],
      mobilization_started: ["site_visit_completed", "in_progress", "disputed", "cancelled"],
      site_visit_completed: ["in_progress", "deliverable_submitted", "disputed", "cancelled"],
      in_progress: ["deliverable_submitted", "disputed", "cancelled"],
      deliverable_submitted: ["completed", "disputed", "cancelled"],
      disputed: ["completed", "closed", "cancelled"],
    };
    return new Set(serviceTransitions[currentStatus] ?? []);
  }

  const isDirect = closingMode === "direct";
  const directTransitions: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
    initiated: ["in_negotiation", "escrow_requested", "cancelled"],
    in_negotiation: ["escrow_requested", "cancelled"],
    escrow_requested: ["escrow_funded_pending_verification", "disputed", "cancelled"],
    escrow_funded_pending_verification: ["escrow_funded", "disputed", "cancelled"],
    escrow_funded: ["fulfillment_pending", "disputed", "cancelled"],
    fulfillment_pending: ["delivered", "acceptance_pending", "disputed", "cancelled"],
    delivered: ["acceptance_pending", "completed", "disputed"],
    acceptance_pending: ["completed", "disputed"],
    disputed: ["completed", "cancelled"],
  };
  const agentLedTransitions: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
    initiated: ["in_negotiation", "escrow_requested", "cancelled"],
    in_negotiation: ["escrow_requested", "cancelled"],
    escrow_requested: ["escrow_funded_pending_verification", "disputed", "cancelled"],
    escrow_funded_pending_verification: ["escrow_funded", "disputed", "cancelled"],
    escrow_funded: ["closing_scheduled", "disputed", "cancelled"],
    closing_scheduled: ["closing_pending_confirmation", "disputed", "cancelled"],
    closing_pending_confirmation: ["closed", "disputed", "cancelled"],
    disputed: ["closed", "cancelled"],
  };

  const table = isDirect ? directTransitions : agentLedTransitions;
  return new Set(table[currentStatus] ?? []);
}

async function getTransactionById(client: SupabaseClient, transactionId: string): Promise<TransactionRecord> {
  const { data, error } = await client
    .from(TRANSACTIONS_TABLE)
    .select(
      "id, conversation_id, transaction_kind, closing_mode, status, buyer_user_id, seller_user_id, agent_user_id, provider_user_id, currency, principal_amount, inspection_fee_amount, inspection_fee_refundable, inspection_fee_status, escrow_reference, metadata, created_at, updated_at",
    )
    .eq("id", transactionId)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to load transaction: ${error.message}`);
  }
  if (!data) {
    throw new Error("Transaction not found.");
  }

  return mapTransactionRow(data);
}

async function insertStatusHistory(
  client: SupabaseClient,
  payload: {
    transactionId: string;
    fromStatus?: string;
    toStatus: string;
    actorUserId?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from(TX_STATUS_HISTORY_TABLE).insert({
    transaction_id: payload.transactionId,
    from_status: payload.fromStatus ?? null,
    to_status: payload.toStatus,
    changed_by_user_id: payload.actorUserId ?? null,
    reason: payload.reason ?? null,
    metadata: payload.metadata ?? {},
  });
  if (error && !isMissingTableOrColumnError(error)) {
    throw new Error(`Failed to write transaction history: ${error.message}`);
  }
}

function resolveEscrowReference(conversationId: string): string {
  const compact = conversationId.replace(/-/g, "").slice(0, 10).toUpperCase();
  return `TXN-${compact || randomUUID().slice(0, 10).toUpperCase()}`;
}

export async function upsertTransaction(input: UpsertTransactionInput): Promise<TransactionRecord> {
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) {
    throw new Error("conversationId is required.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const nowIso = new Date().toISOString();
  const status = normalizeStatus(input.status ?? "initiated");
  const payload = {
    conversation_id: conversationId,
    transaction_kind: normalizeTransactionKind(input.transactionKind),
    closing_mode: normalizeClosingMode(input.closingMode),
    status,
    buyer_user_id: input.buyerUserId ?? null,
    seller_user_id: input.sellerUserId ?? null,
    agent_user_id: input.agentUserId ?? null,
    provider_user_id: input.providerUserId ?? null,
    currency: normalizeCurrency(input.currency),
    principal_amount: toNumberOrNull(input.principalAmount),
    inspection_fee_amount: toPositiveNumberOrZero(input.inspectionFeeAmount),
    inspection_fee_refundable: input.inspectionFeeRefundable ?? true,
    inspection_fee_status: String(input.inspectionFeeStatus ?? "not_applicable"),
    escrow_reference: resolveEscrowReference(conversationId),
    metadata: input.metadata ?? {},
    updated_at: nowIso,
  };

  const { data, error } = await client
    .from(TRANSACTIONS_TABLE)
    .upsert(payload, { onConflict: "conversation_id" })
    .select(
      "id, conversation_id, transaction_kind, closing_mode, status, buyer_user_id, seller_user_id, agent_user_id, provider_user_id, currency, principal_amount, inspection_fee_amount, inspection_fee_refundable, inspection_fee_status, escrow_reference, metadata, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to upsert transaction: ${error.message}`);
  }

  return mapTransactionRow(data);
}

export async function getTransactionByConversationId(conversationId: string): Promise<TransactionRecord | null> {
  const normalizedConversationId = String(conversationId ?? "").trim();
  if (!normalizedConversationId) return null;

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await client
    .from(TRANSACTIONS_TABLE)
    .select(
      "id, conversation_id, transaction_kind, closing_mode, status, buyer_user_id, seller_user_id, agent_user_id, provider_user_id, currency, principal_amount, inspection_fee_amount, inspection_fee_refundable, inspection_fee_status, escrow_reference, metadata, created_at, updated_at",
    )
    .eq("conversation_id", normalizedConversationId)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to load transaction: ${error.message}`);
  }

  return data ? mapTransactionRow(data) : null;
}

export async function getTransactionByIdPublic(transactionId: string): Promise<TransactionRecord> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) throw new Error("transactionId is required.");

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  return getTransactionById(client, normalizedTransactionId);
}

export async function transitionTransactionStatus(
  input: TransitionTransactionStatusInput,
): Promise<TransactionRecord> {
  const transactionId = String(input.transactionId ?? "").trim();
  const nextStatus = normalizeStatus(input.toStatus);
  if (!transactionId) throw new Error("transactionId is required.");

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const transaction = await getTransactionById(client, transactionId);
  if (transaction.status === nextStatus) return transaction;

  const allowed = resolveAllowedTransitions(
    transaction.transactionKind,
    transaction.closingMode,
    transaction.status,
  );
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `Invalid status transition from ${transaction.status} to ${nextStatus} for ${transaction.transactionKind}.`,
    );
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from(TRANSACTIONS_TABLE)
    .update({ status: nextStatus, updated_at: nowIso })
    .eq("id", transactionId)
    .eq("status", transaction.status)
    .select(
      "id, conversation_id, transaction_kind, closing_mode, status, buyer_user_id, seller_user_id, agent_user_id, provider_user_id, currency, principal_amount, inspection_fee_amount, inspection_fee_refundable, inspection_fee_status, escrow_reference, metadata, created_at, updated_at",
    )
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to update transaction status: ${error.message}`);
  }
  if (!data) {
    return getTransactionById(client, transactionId);
  }

  await insertStatusHistory(client, {
    transactionId,
    fromStatus: transaction.status,
    toStatus: nextStatus,
    actorUserId: input.actorUserId,
    reason: input.reason,
    metadata: input.metadata,
  });

  return mapTransactionRow(data);
}

export async function listTransactionStatusHistory(
  transactionId: string,
  options?: { limit?: number },
): Promise<TransactionStatusHistoryRecord[]> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) return [];

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const numericLimit = Number(options?.limit);
  const limit =
    Number.isFinite(numericLimit) && numericLimit > 0
      ? Math.max(1, Math.min(Math.trunc(numericLimit), 200))
      : 100;

  const { data, error } = await client
    .from(TX_STATUS_HISTORY_TABLE)
    .select("id, transaction_id, from_status, to_status, changed_by_user_id, reason, metadata, created_at")
    .eq("transaction_id", normalizedTransactionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list transaction status history: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => mapStatusHistoryRow(row as Record<string, unknown>));
}

export async function listPayoutLedgerEntries(
  transactionId: string,
  options?: { limit?: number },
): Promise<PayoutLedgerRecord[]> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) return [];

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const numericLimit = Number(options?.limit);
  const limit =
    Number.isFinite(numericLimit) && numericLimit > 0
      ? Math.max(1, Math.min(Math.trunc(numericLimit), 200))
      : 100;

  const { data, error } = await client
    .from(PAYOUT_LEDGER_TABLE)
    .select(
      "id, transaction_id, ledger_type, idempotency_key, amount, currency, recipient_user_id, status, reference, metadata, created_at, updated_at",
    )
    .eq("transaction_id", normalizedTransactionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list payout ledger entries: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => mapPayoutLedgerRow(row as Record<string, unknown>));
}

export async function createChatAction(input: CreateChatActionInput): Promise<ChatActionRecord> {
  const transactionId = String(input.transactionId ?? "").trim();
  const conversationId = String(input.conversationId ?? "").trim();
  if (!transactionId || !conversationId) {
    throw new Error("transactionId and conversationId are required.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const expiresAt = normalizeIsoTimestamp(input.expiresAt);
  const payload = {
    transaction_id: transactionId,
    conversation_id: conversationId,
    action_type: normalizeActionType(input.actionType),
    target_role: normalizeRole(input.targetRole),
    status: "pending",
    payload: input.payload ?? {},
    created_by_user_id: input.createdByUserId ?? null,
    expires_at: expiresAt,
  };

  const { data, error } = await client
    .from(CHAT_ACTIONS_TABLE)
    .insert(payload)
    .select(
      "id, transaction_id, conversation_id, action_type, target_role, status, payload, created_by_user_id, resolved_by_user_id, expires_at, resolved_at, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to create chat action: ${error.message}`);
  }

  return mapChatActionRow(data);
}

export async function listTransactionActions(transactionId: string): Promise<ChatActionRecord[]> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) return [];

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await client
    .from(CHAT_ACTIONS_TABLE)
    .select(
      "id, transaction_id, conversation_id, action_type, target_role, status, payload, created_by_user_id, resolved_by_user_id, expires_at, resolved_at, created_at, updated_at",
    )
    .eq("transaction_id", normalizedTransactionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list chat actions: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => mapChatActionRow(row as Record<string, unknown>));
}

export async function resolveChatAction(input: ResolveChatActionInput): Promise<{
  action: ChatActionRecord;
  transaction: TransactionRecord;
}> {
  const actionId = String(input.actionId ?? "").trim();
  const actorUserId = String(input.actorUserId ?? "").trim();
  if (!actionId || !actorUserId) {
    throw new Error("actionId and actorUserId are required.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data: rawAction, error: loadError } = await client
    .from(CHAT_ACTIONS_TABLE)
    .select(
      "id, transaction_id, conversation_id, action_type, target_role, status, payload, created_by_user_id, resolved_by_user_id, expires_at, resolved_at, created_at, updated_at",
    )
    .eq("id", actionId)
    .maybeSingle<Record<string, unknown>>();

  if (loadError) {
    throw new Error(`Failed to load chat action: ${loadError.message}`);
  }
  if (!rawAction) {
    throw new Error("Chat action not found.");
  }

  const action = mapChatActionRow(rawAction);
  if (action.status !== "pending") {
    throw new Error(`This action is already ${action.status}.`);
  }

  const expiresAtMs = action.expiresAt ? Date.parse(action.expiresAt) : NaN;
  if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
    await client
      .from(CHAT_ACTIONS_TABLE)
      .update({
        status: "expired",
        resolved_by_user_id: actorUserId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", action.id)
      .eq("status", "pending");
    throw new Error("This action has expired.");
  }

  const normalizedActorRole = normalizeRole(input.actorRole);
  if (normalizedActorRole !== "admin" && normalizedActorRole !== action.targetRole) {
    throw new Error("FORBIDDEN: You are not allowed to resolve this action.");
  }

  const nextStatus = normalizeNextActionStatus(input.decision);
  const mergedPayload = {
    ...action.payload,
    resolution: {
      decision: input.decision,
      payload: input.payload ?? {},
      actorRole: normalizedActorRole,
      actorUserId,
      resolvedAt: new Date().toISOString(),
    },
  };

  const { data: updatedRow, error: updateError } = await client
    .from(CHAT_ACTIONS_TABLE)
    .update({
      status: nextStatus,
      resolved_by_user_id: actorUserId,
      resolved_at: new Date().toISOString(),
      payload: mergedPayload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id)
    .eq("status", "pending")
    .select(
      "id, transaction_id, conversation_id, action_type, target_role, status, payload, created_by_user_id, resolved_by_user_id, expires_at, resolved_at, created_at, updated_at",
    )
    .maybeSingle<Record<string, unknown>>();

  if (updateError) {
    throw new Error(`Failed to resolve chat action: ${updateError.message}`);
  }
  if (!updatedRow) {
    const latest = await listTransactionActions(action.transactionId);
    const found = latest.find((item) => item.id === action.id);
    if (!found) throw new Error("Action resolution conflict.");
    throw new Error(`This action is already ${found.status}.`);
  }

  const transaction = await getTransactionById(client, action.transactionId);

  return {
    action: mapChatActionRow(updatedRow),
    transaction,
  };
}

export async function claimPayoutLedgerEntry(input: ClaimPayoutInput): Promise<{
  claimed: boolean;
  idempotencyKey: string;
  entryId: string;
}> {
  const transactionId = String(input.transactionId ?? "").trim();
  const idempotencyKey = String(input.idempotencyKey ?? "").trim();
  if (!transactionId || !idempotencyKey) {
    throw new Error("transactionId and idempotencyKey are required.");
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("amount must be a non-negative number.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const payload = {
    transaction_id: transactionId,
    ledger_type: input.ledgerType,
    idempotency_key: idempotencyKey,
    amount,
    currency: normalizeCurrency(input.currency),
    recipient_user_id: input.recipientUserId ?? null,
    reference: input.reference ?? null,
    metadata: input.metadata ?? {},
    status: "claimed",
  };

  const { data, error } = await client
    .from(PAYOUT_LEDGER_TABLE)
    .insert(payload)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (isDuplicateError(error)) {
      const { data: existing, error: existingError } = await client
        .from(PAYOUT_LEDGER_TABLE)
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle<{ id: string }>();
      if (existingError) {
        throw new Error(`Failed to reload payout ledger by idempotency key: ${existingError.message}`);
      }
      return {
        claimed: false,
        idempotencyKey,
        entryId: String(existing?.id ?? ""),
      };
    }
    throw new Error(`Failed to claim payout ledger entry: ${error.message}`);
  }

  const transaction = await getTransactionById(client, transactionId);
  await insertStatusHistory(client, {
    transactionId,
    fromStatus: transaction.status,
    toStatus: transaction.status,
    actorUserId: input.actorUserId,
    reason: input.reason || `Payout ledger ${input.ledgerType} claimed.`,
    metadata: {
      event: "payout_ledger_claimed",
      ledgerEntryId: String(data?.id ?? ""),
      ledgerType: input.ledgerType,
      idempotencyKey,
      amount,
      currency: normalizeCurrency(input.currency),
    },
  });

  return {
    claimed: true,
    idempotencyKey,
    entryId: String(data?.id ?? ""),
  };
}

export async function updatePayoutLedgerEntryStatus(
  input: UpdatePayoutLedgerStatusInput,
): Promise<PayoutLedgerRecord> {
  const entryId = String(input.entryId ?? "").trim();
  if (!entryId) {
    throw new Error("entryId is required.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data: existingRow, error: existingError } = await client
    .from(PAYOUT_LEDGER_TABLE)
    .select(
      "id, transaction_id, ledger_type, idempotency_key, amount, currency, recipient_user_id, status, reference, metadata, created_at, updated_at",
    )
    .eq("id", entryId)
    .maybeSingle<Record<string, unknown>>();

  if (existingError) {
    throw new Error(`Failed to load payout ledger entry: ${existingError.message}`);
  }
  if (!existingRow) {
    throw new Error("Payout ledger entry not found.");
  }

  const existing = mapPayoutLedgerRow(existingRow);
  const nextStatus = normalizePayoutLedgerStatus(input.status);
  if (existing.status === nextStatus) {
    return existing;
  }

  const nowIso = new Date().toISOString();
  const mergedMetadata = {
    ...existing.metadata,
    ...(input.metadata ?? {}),
  };

  const { data: updatedRow, error: updateError } = await client
    .from(PAYOUT_LEDGER_TABLE)
    .update({
      status: nextStatus,
      reference: String(input.reference ?? "").trim() || existing.reference,
      metadata: mergedMetadata,
      updated_at: nowIso,
    })
    .eq("id", entryId)
    .select(
      "id, transaction_id, ledger_type, idempotency_key, amount, currency, recipient_user_id, status, reference, metadata, created_at, updated_at",
    )
    .maybeSingle<Record<string, unknown>>();

  if (updateError) {
    throw new Error(`Failed to update payout ledger status: ${updateError.message}`);
  }
  if (!updatedRow) {
    const { data: reloaded, error: reloadError } = await client
      .from(PAYOUT_LEDGER_TABLE)
      .select(
        "id, transaction_id, ledger_type, idempotency_key, amount, currency, recipient_user_id, status, reference, metadata, created_at, updated_at",
      )
      .eq("id", entryId)
      .maybeSingle<Record<string, unknown>>();
    if (reloadError) {
      throw new Error(`Payout ledger updated but reload failed: ${reloadError.message}`);
    }
    if (!reloaded) {
      throw new Error("Payout ledger updated but record could not be reloaded.");
    }
    return mapPayoutLedgerRow(reloaded);
  }

  const updated = mapPayoutLedgerRow(updatedRow);
  const transaction = await getTransactionById(client, updated.transactionId);
  await insertStatusHistory(client, {
    transactionId: updated.transactionId,
    fromStatus: transaction.status,
    toStatus: transaction.status,
    actorUserId: input.actorUserId,
    reason:
      input.reason ||
      `Payout ledger ${updated.ledgerType} status updated: ${existing.status} -> ${updated.status}.`,
    metadata: {
      event: "payout_ledger_status_updated",
      ledgerEntryId: updated.id,
      ledgerType: updated.ledgerType,
      previousStatus: existing.status,
      nextStatus: updated.status,
      reference: updated.reference,
    },
  });

  return updated;
}

export async function upsertTransactionRating(
  input: UpsertTransactionRatingInput,
): Promise<{ created: boolean; ratingId: string; editableUntil: string | null }> {
  const transactionId = String(input.transactionId ?? "").trim();
  const raterUserId = String(input.raterUserId ?? "").trim();
  if (!transactionId || !raterUserId) {
    throw new Error("transactionId and raterUserId are required.");
  }

  const stars = Math.trunc(Number(input.stars));
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    throw new Error("stars must be between 1 and 5.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const transaction = await getTransactionById(client, transactionId);
  if (transaction.status !== "completed" && transaction.status !== "closed") {
    throw new Error("Ratings are allowed only after transaction completion.");
  }

  const eligibleRaterIds = new Set<string>();
  if (transaction.buyerUserId) eligibleRaterIds.add(transaction.buyerUserId);
  if (!eligibleRaterIds.has(raterUserId)) {
    throw new Error("Only the buyer/renter on this transaction can submit a rating.");
  }

  const resolvedRatedUserId =
    String(input.ratedUserId ?? "").trim() ||
    transaction.agentUserId ||
    transaction.sellerUserId ||
    transaction.providerUserId ||
    "";
  if (!resolvedRatedUserId) {
    throw new Error("No valid rated user is linked to this transaction.");
  }

  const { data: existing, error: existingError } = await client
    .from(TX_RATINGS_TABLE)
    .select("id, editable_until")
    .eq("transaction_id", transactionId)
    .eq("rater_user_id", raterUserId)
    .maybeSingle<{ id: string; editable_until?: string | null }>();

  if (existingError) {
    throw new Error(`Failed to read existing rating: ${existingError.message}`);
  }

  const nowMs = Date.now();
  const editableUntil = new Date(
    nowMs +
      Math.max(1, Number.isFinite(RATING_EDIT_WINDOW_DAYS) ? RATING_EDIT_WINDOW_DAYS : 7) *
        24 *
        60 *
        60 *
        1000,
  ).toISOString();

  if (existing?.id) {
    const existingEditableUntilMs = existing.editable_until ? Date.parse(existing.editable_until) : NaN;
    if (Number.isFinite(existingEditableUntilMs) && nowMs > existingEditableUntilMs) {
      throw new Error("Rating edit window has expired.");
    }

    const { error: updateError } = await client
      .from(TX_RATINGS_TABLE)
      .update({
        stars,
        review: String(input.review ?? "").trim() || null,
        rated_user_id: resolvedRatedUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update rating: ${updateError.message}`);
    }

    return {
      created: false,
      ratingId: existing.id,
      editableUntil: existing.editable_until ?? null,
    };
  }

  const { data: inserted, error: insertError } = await client
    .from(TX_RATINGS_TABLE)
    .insert({
      transaction_id: transactionId,
      rater_user_id: raterUserId,
      rated_user_id: resolvedRatedUserId,
      stars,
      review: String(input.review ?? "").trim() || null,
      editable_until: editableUntil,
    })
    .select("id, editable_until")
    .single<{ id: string; editable_until?: string | null }>();

  if (insertError) {
    throw new Error(`Failed to create rating: ${insertError.message}`);
  }

  return {
    created: true,
    ratingId: String(inserted.id ?? ""),
    editableUntil: inserted.editable_until ?? editableUntil,
  };
}

export async function ensureUserExistsForOtp(
  userId: string,
  updates: Partial<{ emailVerified: boolean; phoneVerified: boolean; email: string; phone: string }>,
): Promise<void> {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return;

  const client = getClient();
  if (!client) return;

  const payload: Record<string, unknown> = {};
  if (typeof updates.emailVerified === "boolean") payload.email_verified = updates.emailVerified;
  if (typeof updates.phoneVerified === "boolean") payload.phone_verified = updates.phoneVerified;
  if (typeof updates.email === "string" && updates.email.trim()) payload.email = updates.email.trim();
  if (typeof updates.phone === "string" && updates.phone.trim()) payload.phone = updates.phone.trim();

  if (Object.keys(payload).length === 0) return;

  const { error } = await client.from(USERS_TABLE).update(payload).eq("id", normalizedUserId);
  if (error && !isMissingTableOrColumnError(error)) {
    throw new Error(`Failed to update user verification flags: ${error.message}`);
  }
}
