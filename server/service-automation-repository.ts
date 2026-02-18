import { createHash, randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  transitionTransactionStatus,
  type TransactionStatus,
} from "./transaction-flow-repository";

const TRANSACTIONS_TABLE = process.env.SUPABASE_TRANSACTIONS_TABLE || "transactions";
const TX_DISPUTES_TABLE = process.env.SUPABASE_TRANSACTION_DISPUTES_TABLE || "transaction_disputes";
const SERVICE_PDF_JOBS_TABLE = process.env.SUPABASE_SERVICE_PDF_JOBS_TABLE || "service_pdf_jobs";
const SERVICE_PROVIDER_LINKS_TABLE =
  process.env.SUPABASE_SERVICE_PROVIDER_LINKS_TABLE || "service_provider_links";
const SERVICE_REQUESTS_TABLE =
  process.env.SUPABASE_SERVICE_REQUESTS_TABLE || "service_request_records";
const CONVERSATIONS_TABLE = process.env.SUPABASE_CHAT_CONVERSATIONS_TABLE || "chat_conversations";
const CONVERSATION_MESSAGES_TABLE = process.env.SUPABASE_CHAT_MESSAGES_TABLE || "chat_messages";
const CONVERSATION_ATTACHMENTS_TABLE =
  process.env.SUPABASE_CONVERSATION_ATTACHMENTS_TABLE || "conversation_file_attachments";
const CONVERSATION_TRANSCRIPTS_TABLE =
  process.env.SUPABASE_CONVERSATION_TRANSCRIPTS_TABLE || "conversation_transcripts";
const DEFAULT_TRANSCRIPT_BUCKET = "conversation-transcripts";

type TransactionTimeoutCandidate = {
  id: string;
  conversationId: string;
  acceptanceDueAt: string;
  status: string;
  escrowFrozen: boolean;
};

export type DisputeRecord = {
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

export type ServicePdfJobRecord = {
  id: string;
  conversationId: string;
  serviceRequestId: string | null;
  transactionId: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  attemptCount: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  outputBucket: string;
  outputPath: string | null;
  errorMessage: string | null;
  createdByUserId: string | null;
  processedAt: string | null;
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

export type ProviderLinkRecord = {
  id: string;
  conversationId: string;
  serviceRequestId: string | null;
  providerUserId: string | null;
  tokenHint: string | null;
  expiresAt: string;
  status: "active" | "opened" | "revoked" | "expired";
  openedAt: string | null;
  payload: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

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

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeIso(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return new Date().toISOString();
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function hashProviderToken(token: string): string {
  const salt = String(process.env.SERVICE_PROVIDER_LINK_SALT ?? "").trim();
  return createHash("sha256").update(`${salt}|${token}`).digest("hex");
}

function mapDisputeRow(row: Record<string, unknown>): DisputeRecord {
  return {
    id: String(row.id ?? ""),
    transactionId: String(row.transaction_id ?? ""),
    conversationId: String(row.conversation_id ?? ""),
    openedByUserId: row.opened_by_user_id ? String(row.opened_by_user_id) : null,
    againstUserId: row.against_user_id ? String(row.against_user_id) : null,
    reason: String(row.reason ?? ""),
    details: row.details ? String(row.details) : null,
    status: String(row.status ?? "open") as DisputeRecord["status"],
    resolution: row.resolution ? String(row.resolution) : null,
    resolutionTargetStatus: row.resolution_target_status
      ? String(row.resolution_target_status)
      : null,
    resolvedByUserId: row.resolved_by_user_id ? String(row.resolved_by_user_id) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    metadata: toObject(row.metadata),
    createdAt: normalizeIso(row.created_at),
    updatedAt: normalizeIso(row.updated_at),
  };
}

function mapPdfJobRow(row: Record<string, unknown>): ServicePdfJobRecord {
  return {
    id: String(row.id ?? ""),
    conversationId: String(row.conversation_id ?? ""),
    serviceRequestId: row.service_request_id ? String(row.service_request_id) : null,
    transactionId: row.transaction_id ? String(row.transaction_id) : null,
    status: String(row.status ?? "queued") as ServicePdfJobRecord["status"],
    attemptCount: Math.max(0, Number(row.attempt_count ?? 0)),
    maxAttempts: Math.max(1, Number(row.max_attempts ?? 5)),
    payload: toObject(row.payload),
    outputBucket: String(row.output_bucket ?? DEFAULT_TRANSCRIPT_BUCKET),
    outputPath: row.output_path ? String(row.output_path) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    processedAt: row.processed_at ? String(row.processed_at) : null,
    createdAt: normalizeIso(row.created_at),
    updatedAt: normalizeIso(row.updated_at),
  };
}

function mapProviderLinkRow(row: Record<string, unknown>): ProviderLinkRecord {
  return {
    id: String(row.id ?? ""),
    conversationId: String(row.conversation_id ?? ""),
    serviceRequestId: row.service_request_id ? String(row.service_request_id) : null,
    providerUserId: row.provider_user_id ? String(row.provider_user_id) : null,
    tokenHint: row.token_hint ? String(row.token_hint) : null,
    expiresAt: normalizeIso(row.expires_at),
    status: String(row.status ?? "active") as ProviderLinkRecord["status"],
    openedAt: row.opened_at ? String(row.opened_at) : null,
    payload: toObject(row.payload),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdAt: normalizeIso(row.created_at),
    updatedAt: normalizeIso(row.updated_at),
  };
}

function sanitizeFileName(input: string): string {
  const safe = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || "file.bin";
}

function escapePdfText(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdf(lines: string[]): Buffer {
  const normalizedLines = lines
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .slice(0, 180);
  if (normalizedLines.length === 0) {
    normalizedLines.push("Justice City service transcript");
  }

  const contentParts: string[] = ["BT", "/F1 11 Tf", "48 780 Td"];
  normalizedLines.forEach((line, index) => {
    if (index > 0) contentParts.push("0 -14 Td");
    contentParts.push(`(${escapePdfText(line)}) Tj`);
  });
  contentParts.push("ET");
  const contentStream = contentParts.join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets[index + 1] = Buffer.byteLength(output, "utf8");
    output += obj;
  });

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "utf8");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? "").trim(),
  );
}

async function createSignedUrl(
  client: SupabaseClient,
  bucketId: string,
  storagePath: string,
  ttlSec: number,
): Promise<string | undefined> {
  const normalizedBucket = String(bucketId ?? "").trim();
  const normalizedPath = String(storagePath ?? "").trim();
  if (!normalizedBucket || !normalizedPath) return undefined;

  const { data, error } = await client.storage
    .from(normalizedBucket)
    .createSignedUrl(normalizedPath, ttlSec);
  if (error || !data?.signedUrl) return undefined;
  return String(data.signedUrl);
}

async function resolveServiceRequestByConversation(
  client: SupabaseClient,
  conversationId: string,
): Promise<{
  id: string;
  serviceCode: string | null;
  requesterId: string | null;
  providerId: string | null;
  folderRoot: string | null;
} | null> {
  const { data, error } = await client
    .from(SERVICE_REQUESTS_TABLE)
    .select("id, service_code, requester_id, provider_id, folder_root")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    if (isMissingTableOrColumnError(error)) return null;
    throw new Error(`Failed to load service request record: ${error.message}`);
  }
  if (!data) return null;

  return {
    id: String(data.id ?? ""),
    serviceCode: data.service_code ? String(data.service_code) : null,
    requesterId: data.requester_id ? String(data.requester_id) : null,
    providerId: data.provider_id ? String(data.provider_id) : null,
    folderRoot: data.folder_root ? String(data.folder_root) : null,
  };
}

function toServiceSegment(serviceCodeRaw: string | null | undefined): string {
  const serviceCode = String(serviceCodeRaw ?? "").trim().toLowerCase();
  const known: Record<string, string> = {
    land_surveying: "Land-Surveying",
    snagging: "Snagging",
    real_estate_valuation: "Property-Valuation",
    land_verification: "Land-Verification",
    general_service: "General-Service",
  };
  if (known[serviceCode]) return known[serviceCode];
  if (!serviceCode) return known.general_service;
  return serviceCode
    .replace(/[^a-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("-");
}

function buildServiceFolderRoot(args: {
  serviceCode?: string | null;
  requesterId?: string | null;
  conversationId: string;
}): string {
  const serviceSegment = toServiceSegment(args.serviceCode);
  const requesterSegment = String(args.requesterId ?? "unknown-requester").trim() || "unknown-requester";
  return `Services/${serviceSegment}/${requesterSegment}/${args.conversationId}`;
}

export async function setTransactionAcceptanceDueAt(
  transactionId: string,
  dueAtIso: string | null,
): Promise<void> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) return;

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const { error } = await client
    .from(TRANSACTIONS_TABLE)
    .update({
      acceptance_due_at: dueAtIso ? normalizeIso(dueAtIso) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", normalizedTransactionId);

  if (error && !isMissingTableOrColumnError(error)) {
    throw new Error(`Failed to update transaction acceptance due time: ${error.message}`);
  }
}

export async function listDirectAcceptanceTimeoutCandidates(
  options?: { limit?: number; nowIso?: string },
): Promise<TransactionTimeoutCandidate[]> {
  const client = getClient();
  if (!client) return [];

  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 50)));
  const nowIso = normalizeIso(options?.nowIso ?? new Date().toISOString());

  const { data, error } = await client
    .from(TRANSACTIONS_TABLE)
    .select("id, conversation_id, acceptance_due_at, status, escrow_frozen")
    .eq("closing_mode", "direct")
    .in("status", ["delivered", "acceptance_pending"])
    .lte("acceptance_due_at", nowIso)
    .order("acceptance_due_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableOrColumnError(error)) return [];
    throw new Error(`Failed to list direct acceptance timeout candidates: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => ({
      id: String((row as Record<string, unknown>).id ?? ""),
      conversationId: String((row as Record<string, unknown>).conversation_id ?? ""),
      acceptanceDueAt: normalizeIso((row as Record<string, unknown>).acceptance_due_at),
      status: String((row as Record<string, unknown>).status ?? ""),
      escrowFrozen: Boolean((row as Record<string, unknown>).escrow_frozen),
    }))
    .filter((row) => row.id && row.conversationId && row.acceptanceDueAt);
}

export async function completeDirectTransactionByTimeout(input: {
  transactionId: string;
  actorUserId?: string;
}): Promise<boolean> {
  const transactionId = String(input.transactionId ?? "").trim();
  if (!transactionId) return false;

  const client = getClient();
  if (!client) return false;

  const { data: row, error: loadError } = await client
    .from(TRANSACTIONS_TABLE)
    .select("status, escrow_frozen")
    .eq("id", transactionId)
    .maybeSingle<{ status?: string; escrow_frozen?: boolean }>();

  if (loadError) {
    if (isMissingTableOrColumnError(loadError)) return false;
    throw new Error(`Failed to check direct transaction timeout state: ${loadError.message}`);
  }
  if (!row) return false;
  if (Boolean(row.escrow_frozen)) return false;

  const currentStatus = String(row.status ?? "").trim().toLowerCase();
  if (currentStatus !== "delivered" && currentStatus !== "acceptance_pending") return false;

  await transitionTransactionStatus({
    transactionId,
    toStatus: "completed",
    actorUserId: input.actorUserId,
    reason: "Auto-completed after acceptance window elapsed with no dispute.",
    metadata: { source: "scheduler", kind: "direct_acceptance_timeout" },
  });

  return true;
}

export async function setEscrowFrozenState(input: {
  transactionId: string;
  frozen: boolean;
  reason?: string;
}): Promise<void> {
  const transactionId = String(input.transactionId ?? "").trim();
  if (!transactionId) return;

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const payload: Record<string, unknown> = {
    escrow_frozen: input.frozen,
    escrow_frozen_at: input.frozen ? new Date().toISOString() : null,
    escrow_frozen_reason: input.frozen ? String(input.reason ?? "").trim() || null : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client.from(TRANSACTIONS_TABLE).update(payload).eq("id", transactionId);
  if (error && !isMissingTableOrColumnError(error)) {
    throw new Error(`Failed to update escrow freeze state: ${error.message}`);
  }
}

export async function isEscrowFrozen(transactionId: string): Promise<boolean> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) return false;

  const client = getClient();
  if (!client) return false;

  const { data, error } = await client
    .from(TRANSACTIONS_TABLE)
    .select("escrow_frozen")
    .eq("id", normalizedTransactionId)
    .maybeSingle<{ escrow_frozen?: boolean }>();

  if (error) {
    if (isMissingTableOrColumnError(error)) return false;
    throw new Error(`Failed to check escrow freeze state: ${error.message}`);
  }
  return Boolean(data?.escrow_frozen);
}

export async function openTransactionDispute(input: {
  transactionId: string;
  conversationId: string;
  openedByUserId?: string;
  againstUserId?: string;
  reason: string;
  details?: string;
  metadata?: Record<string, unknown>;
}): Promise<DisputeRecord> {
  const transactionId = String(input.transactionId ?? "").trim();
  const conversationId = String(input.conversationId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  if (!transactionId || !conversationId || !reason) {
    throw new Error("transactionId, conversationId, and reason are required.");
  }

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const { data: existingOpen, error: existingError } = await client
    .from(TX_DISPUTES_TABLE)
    .select(
      "id, transaction_id, conversation_id, opened_by_user_id, against_user_id, reason, details, status, resolution, resolution_target_status, resolved_by_user_id, resolved_at, metadata, created_at, updated_at",
    )
    .eq("transaction_id", transactionId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Record<string, unknown>>();

  if (existingError && !isMissingTableOrColumnError(existingError)) {
    throw new Error(`Failed to check existing disputes: ${existingError.message}`);
  }
  if (existingOpen) {
    return mapDisputeRow(existingOpen);
  }

  const { data, error } = await client
    .from(TX_DISPUTES_TABLE)
    .insert({
      transaction_id: transactionId,
      conversation_id: conversationId,
      opened_by_user_id: String(input.openedByUserId ?? "").trim() || null,
      against_user_id: String(input.againstUserId ?? "").trim() || null,
      reason,
      details: String(input.details ?? "").trim() || null,
      status: "open",
      metadata: input.metadata ?? {},
    })
    .select(
      "id, transaction_id, conversation_id, opened_by_user_id, against_user_id, reason, details, status, resolution, resolution_target_status, resolved_by_user_id, resolved_at, metadata, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to create dispute: ${error.message}`);
  }

  await setEscrowFrozenState({
    transactionId,
    frozen: true,
    reason: reason,
  });
  await transitionTransactionStatus({
    transactionId,
    toStatus: "disputed",
    actorUserId: String(input.openedByUserId ?? "").trim() || undefined,
    reason: "Dispute opened.",
    metadata: { source: "dispute_open" },
  });

  return mapDisputeRow(data);
}

export async function listTransactionDisputes(
  transactionId: string,
  options?: { status?: DisputeRecord["status"] | "all"; limit?: number },
): Promise<DisputeRecord[]> {
  const normalizedTransactionId = String(transactionId ?? "").trim();
  if (!normalizedTransactionId) return [];

  const client = getClient();
  if (!client) return [];

  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 50)));
  let query = client
    .from(TX_DISPUTES_TABLE)
    .select(
      "id, transaction_id, conversation_id, opened_by_user_id, against_user_id, reason, details, status, resolution, resolution_target_status, resolved_by_user_id, resolved_at, metadata, created_at, updated_at",
    )
    .eq("transaction_id", normalizedTransactionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const requestedStatus = String(options?.status ?? "").trim().toLowerCase();
  if (requestedStatus && requestedStatus !== "all") {
    query = query.eq("status", requestedStatus);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableOrColumnError(error)) return [];
    throw new Error(`Failed to list transaction disputes: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).map((row) => mapDisputeRow(row as Record<string, unknown>));
}

export async function listOpenDisputes(options?: { limit?: number }): Promise<DisputeRecord[]> {
  const client = getClient();
  if (!client) return [];

  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 100)));
  const { data, error } = await client
    .from(TX_DISPUTES_TABLE)
    .select(
      "id, transaction_id, conversation_id, opened_by_user_id, against_user_id, reason, details, status, resolution, resolution_target_status, resolved_by_user_id, resolved_at, metadata, created_at, updated_at",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableOrColumnError(error)) return [];
    throw new Error(`Failed to list open disputes: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).map((row) => mapDisputeRow(row as Record<string, unknown>));
}

function normalizeDisputeResolutionStatus(raw: unknown): "resolved" | "rejected" | "cancelled" {
  const normalized = String(raw ?? "resolved").trim().toLowerCase();
  if (normalized === "rejected") return "rejected";
  if (normalized === "cancelled") return "cancelled";
  return "resolved";
}

export async function resolveTransactionDispute(input: {
  disputeId: string;
  status: "resolved" | "rejected" | "cancelled";
  resolvedByUserId?: string;
  resolution?: string;
  resolutionTargetStatus?: TransactionStatus;
  metadata?: Record<string, unknown>;
  unfreezeEscrow?: boolean;
}): Promise<DisputeRecord> {
  const disputeId = String(input.disputeId ?? "").trim();
  if (!disputeId) {
    throw new Error("disputeId is required.");
  }

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const { data: loaded, error: loadError } = await client
    .from(TX_DISPUTES_TABLE)
    .select(
      "id, transaction_id, conversation_id, opened_by_user_id, against_user_id, reason, details, status, resolution, resolution_target_status, resolved_by_user_id, resolved_at, metadata, created_at, updated_at",
    )
    .eq("id", disputeId)
    .maybeSingle<Record<string, unknown>>();

  if (loadError) {
    throw new Error(`Failed to load dispute: ${loadError.message}`);
  }
  if (!loaded) {
    throw new Error("Dispute not found.");
  }

  const dispute = mapDisputeRow(loaded);
  if (dispute.status !== "open") {
    return dispute;
  }

  const nextStatus = normalizeDisputeResolutionStatus(input.status);
  const resolutionText = String(input.resolution ?? "").trim() || null;
  const targetStatus = String(input.resolutionTargetStatus ?? "").trim().toLowerCase() || null;
  const nowIso = new Date().toISOString();

  const mergedMetadata = {
    ...dispute.metadata,
    ...(input.metadata ?? {}),
    resolution: {
      status: nextStatus,
      resolvedAt: nowIso,
    },
  };

  const { data: updated, error: updateError } = await client
    .from(TX_DISPUTES_TABLE)
    .update({
      status: nextStatus,
      resolution: resolutionText,
      resolution_target_status: targetStatus,
      resolved_by_user_id: String(input.resolvedByUserId ?? "").trim() || null,
      resolved_at: nowIso,
      metadata: mergedMetadata,
      updated_at: nowIso,
    })
    .eq("id", disputeId)
    .eq("status", "open")
    .select(
      "id, transaction_id, conversation_id, opened_by_user_id, against_user_id, reason, details, status, resolution, resolution_target_status, resolved_by_user_id, resolved_at, metadata, created_at, updated_at",
    )
    .maybeSingle<Record<string, unknown>>();

  if (updateError) {
    throw new Error(`Failed to resolve dispute: ${updateError.message}`);
  }
  if (!updated) {
    throw new Error("Dispute resolution conflict. Please refresh and retry.");
  }

  const shouldUnfreeze = input.unfreezeEscrow ?? true;
  if (shouldUnfreeze) {
    await setEscrowFrozenState({ transactionId: dispute.transactionId, frozen: false });
  }

  if (targetStatus) {
    await transitionTransactionStatus({
      transactionId: dispute.transactionId,
      toStatus: targetStatus as TransactionStatus,
      actorUserId: String(input.resolvedByUserId ?? "").trim() || undefined,
      reason: resolutionText ?? `Dispute ${nextStatus}.`,
      metadata: {
        source: "dispute_resolution",
        disputeId,
      },
    });
  }

  return mapDisputeRow(updated);
}

export async function enqueueServicePdfJob(input: {
  conversationId: string;
  serviceRequestId?: string;
  transactionId?: string;
  createdByUserId?: string;
  payload?: Record<string, unknown>;
  outputBucket?: string;
  outputPath?: string;
  maxAttempts?: number;
}): Promise<ServicePdfJobRecord> {
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) {
    throw new Error("conversationId is required.");
  }

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const nowIso = new Date().toISOString();
  const serviceRequest = await resolveServiceRequestByConversation(client, conversationId);
  const serviceRequestId =
    String(input.serviceRequestId ?? "").trim() || String(serviceRequest?.id ?? "").trim() || null;
  const transactionId = String(input.transactionId ?? "").trim() || null;
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts ?? 5)));
  const outputBucket = String(input.outputBucket ?? "").trim() || DEFAULT_TRANSCRIPT_BUCKET;
  const outputPath =
    String(input.outputPath ?? "").trim() ||
    `${buildServiceFolderRoot({
      conversationId,
      serviceCode: serviceRequest?.serviceCode ?? null,
      requesterId: serviceRequest?.requesterId ?? null,
    })}/transcripts/${conversationId}.pdf`;

  const { data, error } = await client
    .from(SERVICE_PDF_JOBS_TABLE)
    .insert({
      conversation_id: conversationId,
      service_request_id: serviceRequestId,
      transaction_id: transactionId,
      status: "queued",
      attempt_count: 0,
      max_attempts: maxAttempts,
      payload: input.payload ?? {},
      output_bucket: outputBucket,
      output_path: outputPath,
      error_message: null,
      created_by_user_id: String(input.createdByUserId ?? "").trim() || null,
      processed_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "id, conversation_id, service_request_id, transaction_id, status, attempt_count, max_attempts, payload, output_bucket, output_path, error_message, created_by_user_id, processed_at, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to enqueue service PDF job: ${error.message}`);
  }
  return mapPdfJobRow(data);
}

export async function listServicePdfJobs(
  options?: { conversationId?: string; status?: ServicePdfJobRecord["status"] | "all"; limit?: number },
): Promise<ServicePdfJobRecord[]> {
  const client = getClient();
  if (!client) return [];

  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 50)));
  let query = client
    .from(SERVICE_PDF_JOBS_TABLE)
    .select(
      "id, conversation_id, service_request_id, transaction_id, status, attempt_count, max_attempts, payload, output_bucket, output_path, error_message, created_by_user_id, processed_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  const conversationId = String(options?.conversationId ?? "").trim();
  if (conversationId) query = query.eq("conversation_id", conversationId);

  const status = String(options?.status ?? "").trim().toLowerCase();
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableOrColumnError(error)) return [];
    throw new Error(`Failed to list service PDF jobs: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).map((row) => mapPdfJobRow(row as Record<string, unknown>));
}

async function claimNextQueuedServicePdfJob(client: SupabaseClient): Promise<ServicePdfJobRecord | null> {
  const { data, error } = await client
    .from(SERVICE_PDF_JOBS_TABLE)
    .select(
      "id, conversation_id, service_request_id, transaction_id, status, attempt_count, max_attempts, payload, output_bucket, output_path, error_message, created_by_user_id, processed_at, created_at, updated_at",
    )
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    if (isMissingTableOrColumnError(error)) return null;
    throw new Error(`Failed to list queued PDF jobs: ${error.message}`);
  }

  const candidates = (Array.isArray(data) ? data : []).map((row) => mapPdfJobRow(row as Record<string, unknown>));
  for (const candidate of candidates) {
    if (candidate.attemptCount >= candidate.maxAttempts) {
      continue;
    }

    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimError } = await client
      .from(SERVICE_PDF_JOBS_TABLE)
      .update({
        status: "processing",
        attempt_count: candidate.attemptCount + 1,
        error_message: null,
        updated_at: nowIso,
      })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select(
        "id, conversation_id, service_request_id, transaction_id, status, attempt_count, max_attempts, payload, output_bucket, output_path, error_message, created_by_user_id, processed_at, created_at, updated_at",
      )
      .maybeSingle<Record<string, unknown>>();

    if (claimError) {
      throw new Error(`Failed to claim PDF job: ${claimError.message}`);
    }
    if (claimed) {
      return mapPdfJobRow(claimed);
    }
  }

  return null;
}

async function updatePdfJobAfterProcessing(
  client: SupabaseClient,
  jobId: string,
  payload: {
    status: "queued" | "completed" | "failed";
    outputPath?: string | null;
    errorMessage?: string | null;
  },
): Promise<ServicePdfJobRecord> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from(SERVICE_PDF_JOBS_TABLE)
    .update({
      status: payload.status,
      output_path: payload.outputPath ?? null,
      error_message: payload.errorMessage ?? null,
      processed_at: payload.status === "completed" || payload.status === "failed" ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("id", jobId)
    .select(
      "id, conversation_id, service_request_id, transaction_id, status, attempt_count, max_attempts, payload, output_bucket, output_path, error_message, created_by_user_id, processed_at, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to update PDF job processing state: ${error.message}`);
  }
  return mapPdfJobRow(data);
}

export async function processNextServicePdfJob(): Promise<ServicePdfJobRecord | null> {
  const client = getClient();
  if (!client) return null;

  const job = await claimNextQueuedServicePdfJob(client);
  if (!job) return null;

  try {
    const { data: conversation } = await client
      .from(CONVERSATIONS_TABLE)
      .select("id, subject")
      .eq("id", job.conversationId)
      .maybeSingle<Record<string, unknown>>();

    const { data: messages } = await client
      .from(CONVERSATION_MESSAGES_TABLE)
      .select("created_at, sender_id, content")
      .eq("conversation_id", job.conversationId)
      .order("created_at", { ascending: true })
      .limit(250);

    const serviceRequest = await resolveServiceRequestByConversation(client, job.conversationId);
    const transcriptPath =
      String(job.outputPath ?? "").trim() ||
      `${buildServiceFolderRoot({
        conversationId: job.conversationId,
        serviceCode: serviceRequest?.serviceCode ?? null,
        requesterId: serviceRequest?.requesterId ?? null,
      })}/transcripts/${job.conversationId}.pdf`;
    const transcriptBucket = String(job.outputBucket ?? "").trim() || DEFAULT_TRANSCRIPT_BUCKET;

    const transcriptLines = [
      "Justice City Service Transcript",
      `Conversation: ${job.conversationId}`,
      `Generated At: ${new Date().toISOString()}`,
      `Subject: ${String(conversation?.subject ?? "Service Conversation").trim() || "Service Conversation"}`,
      `Service: ${String(serviceRequest?.serviceCode ?? "general_service")}`,
      "------------------------------",
      ...((Array.isArray(messages) ? messages : []).map((row) => {
        const createdAt = normalizeIso((row as Record<string, unknown>).created_at);
        const senderId = String((row as Record<string, unknown>).sender_id ?? "system").slice(0, 12);
        const content = String((row as Record<string, unknown>).content ?? "").replace(/\s+/g, " ").trim();
        return `${createdAt} | ${senderId}: ${content || "[empty]"}`;
      })),
    ];

    const pdfBytes = buildSimplePdf(transcriptLines);
    const { error: uploadError } = await client.storage
      .from(transcriptBucket)
      .upload(transcriptPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`PDF upload failed: ${uploadError.message}`);
    }

    const { error: transcriptError } = await client
      .from(CONVERSATION_TRANSCRIPTS_TABLE)
      .upsert({
        conversation_id: job.conversationId,
        transcript_format: "pdf",
        bucket_id: transcriptBucket,
        storage_path: transcriptPath,
        generated_at: new Date().toISOString(),
      }, { onConflict: "conversation_id" });

    if (transcriptError && !isMissingTableOrColumnError(transcriptError)) {
      throw new Error(`Failed to upsert transcript metadata: ${transcriptError.message}`);
    }

    return await updatePdfJobAfterProcessing(client, job.id, {
      status: "completed",
      outputPath: transcriptPath,
      errorMessage: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF job processing error";
    const nextStatus: "queued" | "failed" = job.attemptCount < job.maxAttempts ? "queued" : "failed";
    return await updatePdfJobAfterProcessing(client, job.id, {
      status: nextStatus,
      outputPath: job.outputPath,
      errorMessage: message,
    });
  }
}

function resolveProviderTokenTtlSec(): number {
  const ttl = Number(process.env.SERVICE_PROVIDER_PACKAGE_SIGNED_URL_TTL_SEC ?? "3600");
  if (!Number.isFinite(ttl) || ttl < 60) return 3600;
  return Math.min(24 * 60 * 60, Math.trunc(ttl));
}

function resolveProviderLinkExpiresAt(raw: unknown): string {
  const parsed = Date.parse(String(raw ?? "").trim());
  if (Number.isFinite(parsed) && parsed > Date.now()) {
    return new Date(parsed).toISOString();
  }
  const defaultHours = Number(process.env.SERVICE_PROVIDER_LINK_DEFAULT_EXPIRY_HOURS ?? "72");
  const hours = Number.isFinite(defaultHours) && defaultHours > 0 ? defaultHours : 72;
  return new Date(Date.now() + Math.min(168, hours) * 60 * 60 * 1000).toISOString();
}

export async function createServiceProviderLink(input: {
  conversationId: string;
  serviceRequestId?: string;
  providerUserId?: string;
  expiresAt?: string;
  payload?: Record<string, unknown>;
  createdByUserId?: string;
}): Promise<{ link: ProviderLinkRecord; token: string }> {
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) {
    throw new Error("conversationId is required.");
  }

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const serviceRequest = await resolveServiceRequestByConversation(client, conversationId);
  const providerUserId =
    String(input.providerUserId ?? "").trim() || String(serviceRequest?.providerId ?? "").trim() || null;
  const serviceRequestId =
    String(input.serviceRequestId ?? "").trim() || String(serviceRequest?.id ?? "").trim() || null;

  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
  const tokenHash = hashProviderToken(token);
  const expiresAt = resolveProviderLinkExpiresAt(input.expiresAt);
  const nowIso = new Date().toISOString();

  const { data, error } = await client
    .from(SERVICE_PROVIDER_LINKS_TABLE)
    .insert({
      conversation_id: conversationId,
      service_request_id: serviceRequestId,
      provider_user_id: providerUserId && isUuid(providerUserId) ? providerUserId : null,
      token_hash: tokenHash,
      token_hint: token.slice(0, 8),
      expires_at: expiresAt,
      status: "active",
      payload: input.payload ?? {},
      created_by_user_id: String(input.createdByUserId ?? "").trim() || null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "id, conversation_id, service_request_id, provider_user_id, token_hint, expires_at, status, opened_at, payload, created_by_user_id, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to create provider package link: ${error.message}`);
  }

  return { link: mapProviderLinkRow(data), token };
}

export async function listProviderLinksByConversation(
  conversationId: string,
  options?: { limit?: number },
): Promise<ProviderLinkRecord[]> {
  const normalizedConversationId = String(conversationId ?? "").trim();
  if (!normalizedConversationId) return [];

  const client = getClient();
  if (!client) return [];

  const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 20)));
  const { data, error } = await client
    .from(SERVICE_PROVIDER_LINKS_TABLE)
    .select(
      "id, conversation_id, service_request_id, provider_user_id, token_hint, expires_at, status, opened_at, payload, created_by_user_id, created_at, updated_at",
    )
    .eq("conversation_id", normalizedConversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableOrColumnError(error)) return [];
    throw new Error(`Failed to list provider links: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).map((row) =>
    mapProviderLinkRow(row as Record<string, unknown>),
  );
}

export async function revokeProviderLink(linkId: string): Promise<ProviderLinkRecord> {
  const normalizedLinkId = String(linkId ?? "").trim();
  if (!normalizedLinkId) throw new Error("linkId is required.");

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const { data, error } = await client
    .from(SERVICE_PROVIDER_LINKS_TABLE)
    .update({
      status: "revoked",
      updated_at: new Date().toISOString(),
    })
    .eq("id", normalizedLinkId)
    .select(
      "id, conversation_id, service_request_id, provider_user_id, token_hint, expires_at, status, opened_at, payload, created_by_user_id, created_at, updated_at",
    )
    .single<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to revoke provider link: ${error.message}`);
  }

  return mapProviderLinkRow(data);
}

export async function resolveProviderPackageByToken(token: string): Promise<ProviderPackage> {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) throw new Error("token is required.");

  const client = getClient();
  if (!client) throw new Error("Supabase service client is not configured.");

  const tokenHash = hashProviderToken(normalizedToken);
  const { data: row, error } = await client
    .from(SERVICE_PROVIDER_LINKS_TABLE)
    .select(
      "id, conversation_id, service_request_id, provider_user_id, token_hint, expires_at, status, opened_at, payload, created_by_user_id, created_at, updated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    throw new Error(`Failed to resolve provider link: ${error.message}`);
  }
  if (!row) {
    throw new Error("Provider package link was not found.");
  }

  const link = mapProviderLinkRow(row);
  if (link.status === "revoked") {
    throw new Error("This provider package link has been revoked.");
  }

  const nowMs = Date.now();
  const expiresMs = Date.parse(link.expiresAt);
  if (!Number.isFinite(expiresMs) || nowMs > expiresMs) {
    await client
      .from(SERVICE_PROVIDER_LINKS_TABLE)
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", link.id)
      .in("status", ["active", "opened"]);
    throw new Error("This provider package link has expired.");
  }

  let openedAt = link.openedAt;
  if (link.status === "active") {
    openedAt = new Date().toISOString();
    await client
      .from(SERVICE_PROVIDER_LINKS_TABLE)
      .update({
        status: "opened",
        opened_at: openedAt,
        updated_at: openedAt,
      })
      .eq("id", link.id)
      .eq("status", "active");
  }

  const { data: attachmentsData, error: attachmentsError } = await client
    .from(CONVERSATION_ATTACHMENTS_TABLE)
    .select("bucket_id, storage_path, file_name, mime_type, created_at")
    .eq("conversation_id", link.conversationId)
    .order("created_at", { ascending: true });

  if (attachmentsError && !isMissingTableOrColumnError(attachmentsError)) {
    throw new Error(`Failed to load provider package attachments: ${attachmentsError.message}`);
  }

  const ttlSec = resolveProviderTokenTtlSec();
  const attachments: ProviderPackageFile[] = [];
  for (const raw of Array.isArray(attachmentsData) ? attachmentsData : []) {
    const rowMap = raw as Record<string, unknown>;
    const bucketId = String(rowMap.bucket_id ?? "").trim();
    const storagePath = String(rowMap.storage_path ?? "").trim();
    if (!bucketId || !storagePath) continue;
    attachments.push({
      bucketId,
      storagePath,
      fileName: String(rowMap.file_name ?? "attachment"),
      mimeType: rowMap.mime_type ? String(rowMap.mime_type) : undefined,
      createdAt: rowMap.created_at ? normalizeIso(rowMap.created_at) : undefined,
      signedUrl: await createSignedUrl(client, bucketId, storagePath, ttlSec),
    });
  }

  const { data: transcriptData, error: transcriptError } = await client
    .from(CONVERSATION_TRANSCRIPTS_TABLE)
    .select("bucket_id, storage_path, generated_at")
    .eq("conversation_id", link.conversationId)
    .maybeSingle<Record<string, unknown>>();

  if (transcriptError && !isMissingTableOrColumnError(transcriptError)) {
    throw new Error(`Failed to load provider package transcript: ${transcriptError.message}`);
  }

  let transcript: ProviderPackageFile | undefined;
  if (transcriptData) {
    const bucketId = String(transcriptData.bucket_id ?? "").trim();
    const storagePath = String(transcriptData.storage_path ?? "").trim();
    if (bucketId && storagePath) {
      transcript = {
        bucketId,
        storagePath,
        fileName: sanitizeFileName(storagePath.split("/").pop() || "service_transcript.pdf"),
        mimeType: "application/pdf",
        createdAt: transcriptData.generated_at ? normalizeIso(transcriptData.generated_at) : undefined,
        signedUrl: await createSignedUrl(client, bucketId, storagePath, ttlSec),
      };
    }
  }

  return {
    linkId: link.id,
    conversationId: link.conversationId,
    serviceRequestId: link.serviceRequestId,
    providerUserId: link.providerUserId,
    status: link.status === "active" ? "opened" : link.status,
    expiresAt: link.expiresAt,
    openedAt,
    payload: link.payload,
    attachments,
    transcript,
  };
}
