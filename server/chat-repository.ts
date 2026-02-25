import { createHash, randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
const CHAT_CONVERSATIONS_TABLE =
  process.env.SUPABASE_CHAT_CONVERSATIONS_TABLE || "chat_conversations";
const CHAT_MEMBERS_TABLE =
  process.env.SUPABASE_CHAT_CONVERSATION_MEMBERS_TABLE || "chat_conversation_members";
const CHAT_MESSAGES_TABLE = process.env.SUPABASE_CHAT_MESSAGES_TABLE || "chat_messages";
const SERVICE_CATALOG_TABLE = process.env.SUPABASE_SERVICE_CATALOG_TABLE || "service_catalog";
const SERVICE_REQUESTS_TABLE =
  process.env.SUPABASE_SERVICE_REQUESTS_TABLE || "service_request_records";
const CONVERSATION_ATTACHMENTS_TABLE =
  process.env.SUPABASE_CONVERSATION_ATTACHMENTS_TABLE || "conversation_file_attachments";
const CONVERSATION_TRANSCRIPTS_TABLE =
  process.env.SUPABASE_CONVERSATION_TRANSCRIPTS_TABLE || "conversation_transcripts";

const SYSTEM_MESSAGE =
  "This chat is monitored by Justice City for your safety. Do not share financial details off-platform.";
const FORBIDDEN_PREFIX = "FORBIDDEN:";

type ChatMessageType = "text" | "system" | "issue_card";
type ChatSender = "me" | "them" | "system";
type ChatRole = "buyer" | "seller" | "agent" | "admin" | "support" | "owner" | "renter";
type ConversationScope = "listing" | "renting" | "service" | "support";

type UpsertConversationInput = {
  requesterId: string;
  requesterName: string;
  requesterRole?: string;
  recipientId?: string;
  recipientName: string;
  recipientRole?: string;
  subject?: string;
  listingId?: string;
  initialMessage?: string;
  conversationScope?: string;
  serviceCode?: string;
};

type ConversationAttachmentInput = {
  bucketId?: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
};

type IssueCardMetadata = {
  title?: string;
  message?: string;
  problemTag?: string;
  status?: string;
  listingId?: string;
  listingTitle?: string;
};

type MessageMetadata = {
  attachments?: ConversationAttachmentInput[];
  issueCard?: IssueCardMetadata;
  [key: string]: unknown;
};

type SendConversationMessageInput = {
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  content: string;
  messageType?: ChatMessageType;
  metadata?: MessageMetadata;
  attachments?: ConversationAttachmentInput[];
};

export type ChatMessageRecord = {
  id: string;
  sender: ChatSender;
  content: string;
  time: string;
  createdAt: string;
  senderId?: string;
  messageType: ChatMessageType;
  metadata?: MessageMetadata;
  attachments?: Array<
    ConversationAttachmentInput & {
      previewUrl?: string;
    }
  >;
};

export type ConversationFileRecord = {
  id: string;
  kind: "attachment" | "transcript";
  bucketId: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  createdAt: string;
  uploadedBy?: string;
  previewUrl?: string;
};

export type ChatConversationListItem = {
  id: string;
  subject: string | null;
  listingId: string | null;
  updatedAt: string;
  participants: Array<{
    id: string;
    name: string;
  }>;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

export type UpsertConversationResult = {
  conversation: {
    id: string;
    subject: string | null;
    listingId: string | null;
  };
  requester: {
    id: string;
    name: string;
  };
  recipient: {
    id: string;
    name: string;
  };
};

type FallbackConversation = {
  id: string;
  listingId: string | null;
  subject: string | null;
  requesterId: string;
  recipientId: string;
  requesterName: string;
  recipientName: string;
  requesterRole: ChatRole;
  recipientRole: ChatRole;
  status: "open" | "closed";
  closedAt: string | null;
  closedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type FallbackMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  content: string;
  messageType: ChatMessageType;
  createdAt: string;
};

type FallbackUser = {
  id: string;
  name: string;
  role: ChatRole;
};

const fallbackConversations = new Map<string, FallbackConversation>();
const fallbackMessages = new Map<string, FallbackMessage[]>();
const fallbackUsers = new Map<string, FallbackUser>();

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isTableMissingError(error: { message?: string } | null): boolean {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

function isColumnMissingError(error: { message?: string } | null): boolean {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

function isDuplicateError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return String(error.message ?? "").toLowerCase().includes("duplicate key");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function deterministicUuid(seed: string): string {
  const digest = createHash("md5").update(seed).digest("hex");
  const part3 = `4${digest.slice(13, 16)}`;
  const part4 = `a${digest.slice(17, 20)}`;
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${part3}-${part4}-${digest.slice(20, 32)}`;
}

function normalizeUserId(rawId: string | undefined, fallbackSeed: string): string {
  const candidate = String(rawId ?? "").trim();
  if (candidate && isUuid(candidate)) return candidate;
  return deterministicUuid(candidate || fallbackSeed || randomUUID());
}

function normalizeListingId(rawListingId: string | undefined): string | null {
  const value = String(rawListingId ?? "").trim();
  if (!value) return null;
  return isUuid(value) ? value : null;
}

function sanitizeUsername(displayName: string, userId: string): string {
  const safeName = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = userId.replace(/-/g, "").slice(0, 10);
  const prefix = safeName.length > 0 ? safeName.slice(0, 20) : "chat_user";
  return `${prefix}_${suffix}`;
}

function formatMessageTime(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeRole(rawRole: string | undefined): ChatRole {
  const value = String(rawRole ?? "")
    .trim()
    .toLowerCase();

  if (value.includes("admin")) return "admin";
  if (value.includes("agent")) return "agent";
  if (value.includes("support")) return "support";
  if (value.includes("owner")) return "owner";
  if (value.includes("rent")) return "renter";
  if (value.includes("seller")) return "seller";
  return "buyer";
}

function normalizeConversationScope(
  rawScope: string | undefined,
  listingId: string | null,
): ConversationScope {
  const value = String(rawScope ?? "")
    .trim()
    .toLowerCase();

  if (value === "service") return "service";
  if (value === "renting") return "renting";
  if (value === "support") return "support";
  if (value === "listing") return "listing";
  if (listingId) return "listing";
  return "support";
}

function normalizeServiceCode(rawValue: string | undefined, fallbackSubject?: string): string {
  const candidate = String(rawValue ?? fallbackSubject ?? "")
    .trim()
    .toLowerCase();

  if (!candidate) return "general_service";
  if (candidate.includes("survey")) return "land_surveying";
  if (candidate.includes("snag")) return "snagging";
  if (candidate.includes("valuation") || candidate.includes("valuer")) {
    return "real_estate_valuation";
  }
  if (candidate.includes("verification") || candidate.includes("verify")) {
    return "land_verification";
  }

  const slug = candidate
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "general_service";
}

function toServiceFolderSegment(serviceCodeRaw: string): string {
  const serviceCode = normalizeServiceCode(serviceCodeRaw);
  const known: Record<string, string> = {
    land_surveying: "Land-Surveying",
    snagging: "Snagging",
    real_estate_valuation: "Property-Valuation",
    land_verification: "Land-Verification",
    general_service: "General-Service",
  };

  if (known[serviceCode]) return known[serviceCode];

  return serviceCode
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("-");
}

function buildServiceFolderRoot(serviceCode: string, requesterId: string, conversationId: string): string {
  return `Services/${toServiceFolderSegment(serviceCode)}/${requesterId}/${conversationId}`;
}

function toServiceDisplayName(serviceCode: string, fallbackSubject?: string): string {
  const explicit = String(fallbackSubject ?? "").trim();
  if (explicit) return explicit;

  return serviceCode
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function toDbRole(rawRole: string | undefined): "buyer" | "seller" | "agent" | "admin" | "owner" | "renter" {
  const normalized = normalizeRole(rawRole);
  if (normalized === "owner") return "owner";
  if (normalized === "renter") return "renter";
  if (normalized === "seller") return "seller";
  if (normalized === "agent") return "agent";
  if (normalized === "admin") return "admin";
  return "buyer";
}

function isAdminRole(rawRole: string | null | undefined): boolean {
  return String(rawRole ?? "")
    .trim()
    .toLowerCase() === "admin";
}

function registerFallbackUser(userId: string, name: string, roleRaw?: string): void {
  const existing = fallbackUsers.get(userId);
  fallbackUsers.set(userId, {
    id: userId,
    name: name || existing?.name || "User",
    role: normalizeRole(roleRaw || existing?.role),
  });
}

function throwForbidden(message: string): never {
  throw new Error(`${FORBIDDEN_PREFIX} ${message}`);
}

function throwServiceSchemaMissing(tableName: string): never {
  throw new Error(
    `Missing ${tableName}. Run supabase/agent_roles_listings_storage.sql to enable service records.`,
  );
}

function isClosedConversationStatus(rawStatus: string | null | undefined): boolean {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toLowerCase();
  return normalized === "closed" || normalized === "resolved" || normalized === "archived";
}

function getFallbackUserRole(userId: string): ChatRole {
  return fallbackUsers.get(userId)?.role || "buyer";
}

function normalizeAttachment(input: unknown): ConversationAttachmentInput | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const storagePath = String(payload.storagePath ?? "").trim();
  const fileName = String(payload.fileName ?? "").trim();
  if (!storagePath || !fileName) return null;

  const fileSizeBytesRaw = payload.fileSizeBytes;
  const fileSizeBytes =
    typeof fileSizeBytesRaw === "number" && Number.isFinite(fileSizeBytesRaw)
      ? Math.max(0, Math.trunc(fileSizeBytesRaw))
      : undefined;

  const bucketIdRaw = String(payload.bucketId ?? "").trim();
  const bucketId =
    bucketIdRaw ||
    (storagePath.toLowerCase().startsWith("services/") ? "service-records" : "chat-attachments");

  return {
    bucketId,
    storagePath,
    fileName,
    mimeType: String(payload.mimeType ?? "").trim() || undefined,
    fileSizeBytes,
  };
}

function buildFileNameFromStoragePath(storagePath: string, fallback: string): string {
  const candidate = String(storagePath ?? "").trim().split("/").pop() ?? "";
  const normalized = String(candidate).trim();
  if (normalized) return normalized;
  return fallback;
}

function normalizeMessageMetadata(input: unknown): MessageMetadata | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return { ...(input as Record<string, unknown>) } as MessageMetadata;
}

function extractAttachmentsFromMetadata(metadata: MessageMetadata | undefined): ConversationAttachmentInput[] {
  const attachmentsRaw = metadata?.attachments;
  if (!Array.isArray(attachmentsRaw)) return [];

  return attachmentsRaw
    .map((item) => normalizeAttachment(item))
    .filter((item): item is ConversationAttachmentInput => Boolean(item));
}

function mergeMessageMetadata(
  metadata: MessageMetadata | undefined,
  attachments: ConversationAttachmentInput[] | undefined,
): MessageMetadata | undefined {
  const normalizedMetadata = normalizeMessageMetadata(metadata);
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  if (!normalizedMetadata && normalizedAttachments.length === 0) return undefined;

  const merged: MessageMetadata = { ...(normalizedMetadata ?? {}) };
  if (normalizedAttachments.length > 0) {
    merged.attachments = normalizedAttachments;
  }
  return merged;
}

async function buildAttachmentPreviews(
  client: SupabaseClient,
  attachments: ConversationAttachmentInput[],
): Promise<Array<ConversationAttachmentInput & { previewUrl?: string }>> {
  if (attachments.length === 0) return [];

  const signed = await Promise.all(
    attachments.map(async (attachment) => {
      const bucketId = String(attachment.bucketId ?? "").trim();
      const storagePath = String(attachment.storagePath ?? "").trim();
      if (!bucketId || !storagePath) {
        return attachment;
      }

      const { data, error } = await client.storage
        .from(bucketId)
        .createSignedUrl(storagePath, 60 * 60);

      if (error || !data?.signedUrl) {
        return attachment;
      }

      return {
        ...attachment,
        previewUrl: data.signedUrl,
      };
    }),
  );

  return signed;
}

async function buildSignedStorageUrl(
  client: SupabaseClient,
  bucketId: string | undefined,
  storagePath: string | undefined,
): Promise<string | undefined> {
  const safeBucketId = String(bucketId ?? "").trim();
  const safeStoragePath = String(storagePath ?? "").trim();
  if (!safeBucketId || !safeStoragePath) return undefined;

  const { data, error } = await client.storage
    .from(safeBucketId)
    .createSignedUrl(safeStoragePath, 60 * 60);
  if (error || !data?.signedUrl) return undefined;
  return data.signedUrl;
}

function mapFallbackMessage(message: FallbackMessage, viewerId: string): ChatMessageRecord {
  const sender: ChatSender =
    message.messageType === "system"
      ? "system"
      : message.senderId === viewerId
        ? "me"
        : "them";

  return {
    id: message.id,
    sender,
    content: message.content,
    time: formatMessageTime(message.createdAt),
    createdAt: message.createdAt,
    senderId: message.senderId ?? undefined,
    messageType: message.messageType,
  };
}

function getFallbackConversationAccess(conversationId: string, viewerId: string): {
  isAdmin: boolean;
  status: "open" | "closed";
} {
  const conversation = fallbackConversations.get(conversationId);
  if (!conversation) {
    throw new Error("Conversation was not found.");
  }

  const isAdmin = isAdminRole(getFallbackUserRole(viewerId));
  if (isAdmin) {
    return { isAdmin: true, status: conversation.status };
  }

  const isMember =
    conversation.requesterId === viewerId || conversation.recipientId === viewerId;

  if (!isMember) {
    throwForbidden("You do not have access to this conversation.");
  }

  return { isAdmin: false, status: conversation.status };
}

function buildFallbackConversationList(
  viewerId: string,
  options?: { includeAll?: boolean },
): ChatConversationListItem[] {
  const includeAll = options?.includeAll === true;
  const isAdmin = isAdminRole(getFallbackUserRole(viewerId));
  if (includeAll && !isAdmin) {
    throwForbidden("Only admins can view all conversations.");
  }

  const conversations = Array.from(fallbackConversations.values())
    .filter((conversation) => {
      if (includeAll) return true;
      return conversation.requesterId === viewerId || conversation.recipientId === viewerId;
    })
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });

  return conversations.map((conversation) => {
    const messages = fallbackMessages.get(conversation.id) ?? [];
    const latest = [...messages].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    })[0];

    return {
      id: conversation.id,
      subject: conversation.subject,
      listingId: conversation.listingId,
      updatedAt: conversation.updatedAt,
      participants: [
        { id: conversation.requesterId, name: conversation.requesterName },
        { id: conversation.recipientId, name: conversation.recipientName },
      ],
      lastMessage: latest?.content ?? null,
      lastMessageAt: latest?.createdAt ?? null,
    };
  });
}

async function ensureUserExists(
  client: SupabaseClient,
  userId: string,
  displayName: string,
  roleRaw?: string,
): Promise<void> {
  const { data, error } = await client
    .from(USERS_TABLE)
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (isTableMissingError(error)) return;
    throw error;
  }

  if (data?.id) return;

  const username = sanitizeUsername(displayName, userId);
  const requestedRole = toDbRole(roleRaw);
  const provisionedRole = requestedRole === "admin" ? "buyer" : requestedRole;
  const { error: insertError } = await client.from(USERS_TABLE).insert({
    id: userId,
    username,
    full_name: displayName,
    role: provisionedRole,
    password: "chat_placeholder_password",
  });

  if (insertError && !isDuplicateError(insertError) && !isTableMissingError(insertError)) {
    throw insertError;
  }
}

async function getUserRole(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client
    .from(USERS_TABLE)
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (isTableMissingError(error)) {
      return getFallbackUserRole(userId);
    }
    throw error;
  }

  if (!data) return null;
  return String(data.role ?? "");
}

async function isConversationMember(
  client: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from(CHAT_MEMBERS_TABLE)
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isTableMissingError(error)) {
      const fallbackConversation = fallbackConversations.get(conversationId);
      return (
        fallbackConversation?.requesterId === userId ||
        fallbackConversation?.recipientId === userId
      );
    }
    throw error;
  }

  return Boolean(data?.conversation_id);
}

async function getConversationStatus(
  client: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from(CHAT_CONVERSATIONS_TABLE)
    .select("status")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    if (isTableMissingError(error) || isColumnMissingError(error)) {
      return null;
    }
    throw error;
  }

  if (!data) return null;
  return String(data.status ?? "");
}

async function getConversationMemberIds(
  client: SupabaseClient,
  conversationId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from(CHAT_MEMBERS_TABLE)
    .select("user_id")
    .eq("conversation_id", conversationId);

  if (error) {
    if (isTableMissingError(error)) {
      const fallbackConversation = fallbackConversations.get(conversationId);
      if (!fallbackConversation) return [];
      return [fallbackConversation.requesterId, fallbackConversation.recipientId];
    }
    throw error;
  }

  return Array.from(
    new Set(
      (Array.isArray(data) ? data : [])
        .map((row) => String(row.user_id ?? ""))
        .filter(Boolean),
    ),
  );
}

async function getUserRolesByIds(
  client: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map<string, string>();

  const { data, error } = await client
    .from(USERS_TABLE)
    .select("id, role")
    .in("id", userIds);

  if (error) {
    if (isTableMissingError(error) || isColumnMissingError(error)) {
      const fallback = new Map<string, string>();
      for (const id of userIds) {
        fallback.set(id, getFallbackUserRole(id));
      }
      return fallback;
    }
    throw error;
  }

  const roleById = new Map<string, string>();
  for (const row of Array.isArray(data) ? data : []) {
    const id = String(row.id ?? "");
    if (!id) continue;
    roleById.set(id, String(row.role ?? ""));
  }

  for (const userId of userIds) {
    if (!roleById.has(userId)) {
      roleById.set(userId, getFallbackUserRole(userId));
    }
  }

  return roleById;
}

async function ensureNonAdminConversationIsOneToOne(
  client: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const memberIds = await getConversationMemberIds(client, conversationId);
  if (memberIds.length <= 2) return;

  const roleById = await getUserRolesByIds(client, memberIds);
  const nonAdminMembers = memberIds.filter((memberId) => !isAdminRole(roleById.get(memberId)));

  if (nonAdminMembers.length > 2) {
    throwForbidden("Only 1:1 conversations are allowed between non-admin participants.");
  }
}

async function ensureConversationAccess(
  client: SupabaseClient,
  conversationId: string,
  viewerId: string,
): Promise<{ isAdmin: boolean; status: string | null }> {
  const role = await getUserRole(client, viewerId);
  if (isAdminRole(role)) {
    const status = await getConversationStatus(client, conversationId);
    return { isAdmin: true, status };
  }

  const member = await isConversationMember(client, conversationId, viewerId);
  if (member) {
    await ensureNonAdminConversationIsOneToOne(client, conversationId);
    const status = await getConversationStatus(client, conversationId);
    return { isAdmin: false, status };
  }

  throwForbidden("You do not have access to this conversation.");
}

async function findExistingConversationId(
  client: SupabaseClient,
  requesterId: string,
  recipientId: string,
  subject: string | null,
  listingId: string | null,
): Promise<string | null> {
  const { data: requesterMemberships, error: requesterError } = await client
    .from(CHAT_MEMBERS_TABLE)
    .select("conversation_id")
    .eq("user_id", requesterId);

  if (requesterError) throw requesterError;

  const requesterConversationIds = Array.from(
    new Set(
      (Array.isArray(requesterMemberships) ? requesterMemberships : [])
        .map((row) => String(row.conversation_id ?? ""))
        .filter(Boolean),
    ),
  );

  if (requesterConversationIds.length === 0) return null;

  const { data: recipientMemberships, error: recipientError } = await client
    .from(CHAT_MEMBERS_TABLE)
    .select("conversation_id")
    .eq("user_id", recipientId)
    .in("conversation_id", requesterConversationIds);

  if (recipientError) throw recipientError;

  const sharedConversationIds = Array.from(
    new Set(
      (Array.isArray(recipientMemberships) ? recipientMemberships : [])
        .map((row) => String(row.conversation_id ?? ""))
        .filter(Boolean),
    ),
  );

  if (sharedConversationIds.length === 0) return null;

  const { data: conversations, error: conversationError } = await client
    .from(CHAT_CONVERSATIONS_TABLE)
    .select("id, subject, listing_id, updated_at")
    .in("id", sharedConversationIds)
    .order("updated_at", { ascending: false });

  if (conversationError) throw conversationError;

  const rows = Array.isArray(conversations) ? conversations : [];
  const matchesListing = (row: Record<string, unknown>): boolean => {
    const rowListingId = row.listing_id ? String(row.listing_id) : null;
    if (listingId) return rowListingId === listingId;
    return rowListingId === null;
  };

  if (subject) {
    const exact = rows.find(
      (row) => String(row.subject ?? "") === subject && matchesListing(row),
    );
    if (exact?.id) return String(exact.id);
  }

  const first = rows.find(matchesListing) ?? rows[0];
  return first?.id ? String(first.id) : null;
}

async function ensureConversationMembers(
  client: SupabaseClient,
  conversationId: string,
  requesterId: string,
  recipientId: string,
): Promise<void> {
  const { error } = await client.from(CHAT_MEMBERS_TABLE).upsert(
    [
      {
        conversation_id: conversationId,
        user_id: requesterId,
        role: "owner",
      },
      {
        conversation_id: conversationId,
        user_id: recipientId,
        role: "participant",
      },
    ],
    { onConflict: "conversation_id,user_id" },
  );

  if (error && !isDuplicateError(error)) {
    throw error;
  }
}

async function ensureInitialConversationMessages(
  client: SupabaseClient,
  conversationId: string,
  recipientId: string,
  subject: string | null,
  scope: ConversationScope,
  initialMessage?: string,
): Promise<void> {
  const { count, error: countError } = await client
    .from(CHAT_MESSAGES_TABLE)
    .select("id", { head: true, count: "exact" })
    .eq("conversation_id", conversationId);

  if (countError) throw countError;

  if ((count ?? 0) > 0) return;

  const preparedInitialMessage = initialMessage?.trim();
  const introMessage =
    preparedInitialMessage && preparedInitialMessage.length > 0
      ? preparedInitialMessage
      : scope === "support"
        ? ""
        : `Hello! I saw you were interested in ${subject ?? "this property"}. Do you have any questions?`;

  const seedRows: Array<Record<string, unknown>> = [
    {
      conversation_id: conversationId,
      sender_id: null,
      message_type: "system",
      content: SYSTEM_MESSAGE,
    },
  ];

  if (introMessage) {
    seedRows.push({
      conversation_id: conversationId,
      sender_id: recipientId,
      message_type: "text",
      content: introMessage,
    });
  }

  const { error: insertError } = await client.from(CHAT_MESSAGES_TABLE).insert(seedRows);

  if (insertError) throw insertError;
}

async function updateConversationMetadata(
  client: SupabaseClient,
  input: {
    conversationId: string;
    scope: ConversationScope;
    serviceCode?: string;
    recordFolder?: string;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = { updated_at: nowIso };
  if (input.scope) payload.scope = input.scope;
  if (input.serviceCode) payload.service_type = input.serviceCode;
  if (input.recordFolder) payload.record_folder = input.recordFolder;
  if (input.scope === "service") payload.status = "open";

  const firstAttempt = await client
    .from(CHAT_CONVERSATIONS_TABLE)
    .update(payload)
    .eq("id", input.conversationId);
  const firstError = firstAttempt.error as { message?: string } | null;
  if (!firstError) return;
  if (isTableMissingError(firstError)) return;

  if (isColumnMissingError(firstError)) {
    const fallbackPayload: Record<string, unknown> = {
      updated_at: nowIso,
    };
    const secondAttempt = await client
      .from(CHAT_CONVERSATIONS_TABLE)
      .update(fallbackPayload)
      .eq("id", input.conversationId);
    const secondError = secondAttempt.error as { message?: string } | null;
    if (!secondError || isColumnMissingError(secondError) || isTableMissingError(secondError)) {
      return;
    }
    throw secondError;
  }

  throw firstError;
}

async function ensureServiceCatalogEntry(
  client: SupabaseClient,
  serviceCode: string,
  serviceName: string,
): Promise<void> {
  const { error } = await client
    .from(SERVICE_CATALOG_TABLE)
    .upsert({ code: serviceCode, name: serviceName }, { onConflict: "code" });

  if (!error) {
    return;
  }

  if (isTableMissingError(error) || isColumnMissingError(error)) {
    throwServiceSchemaMissing(SERVICE_CATALOG_TABLE);
  }

  throw error;
}

async function upsertServiceRequestRecord(
  client: SupabaseClient,
  input: {
    serviceCode: string;
    requesterId: string;
    providerId: string;
    conversationId: string;
    folderRoot: string;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await client.from(SERVICE_REQUESTS_TABLE).upsert(
    {
      service_code: input.serviceCode,
      requester_id: input.requesterId,
      provider_id: input.providerId,
      conversation_id: input.conversationId,
      folder_root: input.folderRoot,
      status: "open",
      updated_at: nowIso,
    },
    { onConflict: "conversation_id" },
  );

  if (!error) {
    return;
  }

  if (isTableMissingError(error) || isColumnMissingError(error)) {
    throwServiceSchemaMissing(SERVICE_REQUESTS_TABLE);
  }

  throw error;
}

async function upsertServiceTranscriptPlaceholder(
  client: SupabaseClient,
  input: {
    conversationId: string;
    folderRoot: string;
  },
): Promise<void> {
  const { error } = await client.from(CONVERSATION_TRANSCRIPTS_TABLE).upsert(
    {
      conversation_id: input.conversationId,
      transcript_format: "pdf",
      bucket_id: "conversation-transcripts",
      storage_path: `${input.folderRoot}/transcripts/${input.conversationId}.pdf`,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" },
  );

  if (!error) {
    return;
  }

  if (isTableMissingError(error) || isColumnMissingError(error)) {
    throwServiceSchemaMissing(CONVERSATION_TRANSCRIPTS_TABLE);
  }

  throw error;
}

async function syncConversationServiceRecords(
  client: SupabaseClient,
  input: {
    conversationId: string;
    scope: ConversationScope;
    serviceCode?: string;
    serviceName?: string;
    requesterId: string;
    providerId: string;
  },
): Promise<void> {
  if (input.scope !== "service") {
    await updateConversationMetadata(client, {
      conversationId: input.conversationId,
      scope: input.scope,
    });
    return;
  }

  const normalizedServiceCode = normalizeServiceCode(input.serviceCode, input.serviceName);
  const folderRoot = buildServiceFolderRoot(
    normalizedServiceCode,
    input.requesterId,
    input.conversationId,
  );

  await ensureServiceCatalogEntry(
    client,
    normalizedServiceCode,
    toServiceDisplayName(normalizedServiceCode, input.serviceName),
  );
  await upsertServiceRequestRecord(client, {
    serviceCode: normalizedServiceCode,
    requesterId: input.requesterId,
    providerId: input.providerId,
    conversationId: input.conversationId,
    folderRoot,
  });
  await upsertServiceTranscriptPlaceholder(client, {
    conversationId: input.conversationId,
    folderRoot,
  });
  await updateConversationMetadata(client, {
    conversationId: input.conversationId,
    scope: "service",
    serviceCode: normalizedServiceCode,
    recordFolder: `${folderRoot}/chat`,
  });
}

async function saveConversationAttachmentLinks(
  client: SupabaseClient,
  input: {
    conversationId: string;
    senderId: string;
    attachments?: ConversationAttachmentInput[];
  },
): Promise<void> {
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  if (attachments.length === 0) return;

  const rows = attachments
    .map((attachment) => {
      const storagePath = String(attachment.storagePath ?? "").trim();
      const fileName = String(attachment.fileName ?? "").trim();
      if (!storagePath || !fileName) return null;

      const bucketIdCandidate = String(attachment.bucketId ?? "").trim();
      const normalizedStoragePath = storagePath.toLowerCase();
      const bucketId =
        bucketIdCandidate ||
        (normalizedStoragePath.startsWith("services/")
          ? "service-records"
          : "chat-attachments");

      return {
        conversation_id: input.conversationId,
        uploaded_by: input.senderId,
        bucket_id: bucketId,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: attachment.mimeType?.trim() || null,
        file_size_bytes:
          typeof attachment.fileSizeBytes === "number" && Number.isFinite(attachment.fileSizeBytes)
            ? Math.max(0, Math.trunc(attachment.fileSizeBytes))
            : null,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  if (rows.length === 0) return;

  const storagePaths = rows
    .map((row) => String(row.storage_path ?? "").trim())
    .filter(Boolean);

  if (storagePaths.length === 0) return;

  const { data: existingRows, error: existingError } = await client
    .from(CONVERSATION_ATTACHMENTS_TABLE)
    .select("storage_path")
    .eq("conversation_id", input.conversationId)
    .in("storage_path", storagePaths);

  if (existingError) {
    if (isTableMissingError(existingError) || isColumnMissingError(existingError)) {
      throwServiceSchemaMissing(CONVERSATION_ATTACHMENTS_TABLE);
    }
    throw existingError;
  }

  const existingStoragePaths = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => String((row as Record<string, unknown>)?.storage_path ?? "").trim())
      .filter(Boolean),
  );

  const rowsToInsert = rows.filter((row) => {
    const storagePath = String(row.storage_path ?? "").trim();
    return storagePath && !existingStoragePaths.has(storagePath);
  });

  if (rowsToInsert.length === 0) return;

  const { error } = await client.from(CONVERSATION_ATTACHMENTS_TABLE).insert(rowsToInsert);
  if (!error) {
    return;
  }

  if (isTableMissingError(error) || isColumnMissingError(error)) {
    throwServiceSchemaMissing(CONVERSATION_ATTACHMENTS_TABLE);
  }

  throw error;
}

export async function recordConversationAttachmentLinks(input: {
  conversationId: string;
  senderId: string;
  attachments?: ConversationAttachmentInput[];
}): Promise<void> {
  const conversationId = String(input.conversationId ?? "").trim();
  const senderId = normalizeUserId(input.senderId, input.senderId);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];

  if (!conversationId || !senderId || attachments.length === 0) return;

  const client = getClient();
  if (!client) return;

  await ensureConversationAccess(client, conversationId, senderId);
  await saveConversationAttachmentLinks(client, {
    conversationId,
    senderId,
    attachments,
  });
}

function ensureNonAdminOneToOneInput(
  requesterRole: ChatRole,
  requesterId: string,
  recipientId: string,
): void {
  if (requesterRole === "admin") return;
  if (requesterId === recipientId) {
    throwForbidden("A conversation must include two different participants.");
  }
}

function getOrCreateFallbackConversation(input: {
  requesterId: string;
  requesterName: string;
  requesterRole?: string;
  recipientId: string;
  recipientName: string;
  recipientRole?: string;
  subject: string | null;
  listingId: string | null;
  initialMessage?: string;
}): UpsertConversationResult {
  registerFallbackUser(input.requesterId, input.requesterName, input.requesterRole);
  registerFallbackUser(input.recipientId, input.recipientName, input.recipientRole);
  const requesterRole = normalizeRole(input.requesterRole);
  const recipientRole = normalizeRole(input.recipientRole);
  ensureNonAdminOneToOneInput(requesterRole, input.requesterId, input.recipientId);

  const existing = Array.from(fallbackConversations.values()).find(
    (conversation) =>
      ((conversation.requesterId === input.requesterId &&
        conversation.recipientId === input.recipientId) ||
        (conversation.requesterId === input.recipientId &&
          conversation.recipientId === input.requesterId)) &&
      (conversation.subject ?? "") === (input.subject ?? ""),
  );

  if (existing) {
    return {
      conversation: {
        id: existing.id,
        subject: existing.subject,
        listingId: existing.listingId,
      },
      requester: { id: input.requesterId, name: input.requesterName },
      recipient: { id: input.recipientId, name: input.recipientName },
    };
  }

  const nowIso = new Date().toISOString();
  const conversationId = randomUUID();
  const created: FallbackConversation = {
    id: conversationId,
    listingId: input.listingId,
    subject: input.subject,
    requesterId: input.requesterId,
    recipientId: input.recipientId,
    requesterName: input.requesterName,
    recipientName: input.recipientName,
    requesterRole,
    recipientRole,
    status: "open",
    closedAt: null,
    closedReason: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  fallbackConversations.set(conversationId, created);
  fallbackMessages.set(conversationId, [
    {
      id: randomUUID(),
      conversationId,
      senderId: null,
      content: SYSTEM_MESSAGE,
      messageType: "system",
      createdAt: nowIso,
    },
    {
      id: randomUUID(),
      conversationId,
      senderId: input.recipientId,
      content:
        input.initialMessage?.trim() ||
        `Hello! I saw you were interested in ${input.subject ?? "this property"}. Do you have any questions?`,
      messageType: "text",
      createdAt: new Date(Date.now() + 1000).toISOString(),
    },
  ]);

  return {
    conversation: {
      id: conversationId,
      subject: input.subject,
      listingId: input.listingId,
    },
    requester: { id: input.requesterId, name: input.requesterName },
    recipient: { id: input.recipientId, name: input.recipientName },
  };
}

export async function upsertChatConversation(
  payload: UpsertConversationInput,
): Promise<UpsertConversationResult> {
  const requesterName = payload.requesterName.trim() || "User";
  const recipientName = payload.recipientName.trim() || "Recipient";
  const requesterId = normalizeUserId(payload.requesterId, requesterName);
  const recipientId = normalizeUserId(payload.recipientId, recipientName);
  const requesterRole = normalizeRole(payload.requesterRole);
  const listingId = normalizeListingId(payload.listingId);
  const conversationScope = normalizeConversationScope(payload.conversationScope, listingId);
  const subject = payload.subject?.trim() || (listingId ? "Property Inquiry" : null);
  const requestedServiceCode =
    conversationScope === "service"
      ? normalizeServiceCode(payload.serviceCode, subject ?? undefined)
      : undefined;
  ensureNonAdminOneToOneInput(requesterRole, requesterId, recipientId);

  const client = getClient();
  if (!client) {
    return getOrCreateFallbackConversation({
      requesterId,
      requesterName,
      requesterRole: payload.requesterRole,
      recipientId,
      recipientName,
      recipientRole: payload.recipientRole,
      subject,
      listingId,
      initialMessage: payload.initialMessage,
    });
  }

  try {
    await ensureUserExists(client, requesterId, requesterName, payload.requesterRole);
    await ensureUserExists(client, recipientId, recipientName, payload.recipientRole);

    let conversationId = await findExistingConversationId(
      client,
      requesterId,
      recipientId,
      subject,
      listingId,
    );

    if (conversationId && requesterRole !== "admin") {
      await ensureNonAdminConversationIsOneToOne(client, conversationId);
    }

    if (!conversationId) {
      const insertPayload: Record<string, unknown> = {
        created_by: requesterId,
        subject,
        status: "open",
      };
      if (listingId) {
        insertPayload.listing_id = listingId;
      }

      let { data: createdConversation, error: createError } = await client
        .from(CHAT_CONVERSATIONS_TABLE)
        .insert(insertPayload)
        .select("id, subject, listing_id")
        .single();

      if (createError && isColumnMissingError(createError)) {
        delete insertPayload.status;
        const retried = await client
          .from(CHAT_CONVERSATIONS_TABLE)
          .insert(insertPayload)
          .select("id, subject, listing_id")
          .single();
        createdConversation = retried.data;
        createError = retried.error;
      }

      if (createError) throw createError;

      conversationId = String(createdConversation?.id ?? "");
      if (!conversationId) {
        throw new Error("Conversation creation failed.");
      }
    }

    await ensureConversationMembers(client, conversationId, requesterId, recipientId);
    if (requesterRole !== "admin") {
      await ensureNonAdminConversationIsOneToOne(client, conversationId);
    }
    await ensureInitialConversationMessages(
      client,
      conversationId,
      recipientId,
      subject,
      conversationScope,
      payload.initialMessage,
    );
    await syncConversationServiceRecords(client, {
      conversationId,
      scope: conversationScope,
      serviceCode: requestedServiceCode,
      serviceName: subject ?? undefined,
      requesterId,
      providerId: recipientId,
    });

    return {
      conversation: {
        id: conversationId,
        subject,
        listingId,
      },
      requester: { id: requesterId, name: requesterName },
      recipient: { id: recipientId, name: recipientName },
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      isTableMissingError(error as { message?: string })
    ) {
      return getOrCreateFallbackConversation({
        requesterId,
        requesterName,
        requesterRole: payload.requesterRole,
        recipientId,
        recipientName,
        recipientRole: payload.recipientRole,
        subject,
        listingId,
        initialMessage: payload.initialMessage,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw new Error(message);
    }
    throw new Error(`Failed to upsert chat conversation: ${message}`);
  }
}

async function listConversationsForViewer(
  viewerIdRaw: string,
  viewerRoleRaw?: string,
  viewerNameRaw?: string,
  options?: { includeAll?: boolean },
): Promise<ChatConversationListItem[]> {
  const includeAll = options?.includeAll === true;
  const viewerId = normalizeUserId(viewerIdRaw, viewerIdRaw);
  const client = getClient();

  if (!client) {
    registerFallbackUser(viewerId, viewerNameRaw || "User", viewerRoleRaw);
    return buildFallbackConversationList(viewerId, { includeAll });
  }

  try {
    if (viewerRoleRaw || viewerNameRaw) {
      await ensureUserExists(
        client,
        viewerId,
        viewerNameRaw?.trim() || "User",
        viewerRoleRaw,
      );
    }

    const viewerRole = await getUserRole(client, viewerId);
    const isAdmin = isAdminRole(viewerRole);
    if (includeAll && !isAdmin) {
      throwForbidden("Only admins can view all conversations.");
    }

    let conversations: Array<Record<string, unknown>> = [];
    if (includeAll) {
      const { data, error } = await client
        .from(CHAT_CONVERSATIONS_TABLE)
        .select("id, subject, listing_id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(250);

      if (error) throw error;
      conversations = Array.isArray(data) ? data : [];
    } else {
      const { data: memberships, error: memberError } = await client
        .from(CHAT_MEMBERS_TABLE)
        .select("conversation_id")
        .eq("user_id", viewerId);

      if (memberError) throw memberError;

      const conversationIds = Array.from(
        new Set(
          (Array.isArray(memberships) ? memberships : [])
            .map((row) => String(row.conversation_id ?? ""))
            .filter(Boolean),
        ),
      );

      if (conversationIds.length === 0) {
        return [];
      }

      const { data, error } = await client
        .from(CHAT_CONVERSATIONS_TABLE)
        .select("id, subject, listing_id, updated_at")
        .in("id", conversationIds)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      conversations = Array.isArray(data) ? data : [];
    }

    if (conversations.length === 0) {
      return [];
    }

    const conversationIds = conversations
      .map((row) => String(row.id ?? ""))
      .filter(Boolean);

    const { data: memberRows, error: memberRowsError } = await client
      .from(CHAT_MEMBERS_TABLE)
      .select("conversation_id, user_id")
      .in("conversation_id", conversationIds);

    if (memberRowsError) throw memberRowsError;

    const userIds = Array.from(
      new Set(
        (Array.isArray(memberRows) ? memberRows : [])
          .map((row) => String(row.user_id ?? ""))
          .filter(Boolean),
      ),
    );

    const userNameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users, error: usersError } = await client
        .from(USERS_TABLE)
        .select("id, username")
        .in("id", userIds);

      if (usersError && !isTableMissingError(usersError)) {
        throw usersError;
      }

      for (const row of Array.isArray(users) ? users : []) {
        const id = String(row.id ?? "");
        if (!id) continue;
        userNameById.set(id, String(row.username ?? "User"));
      }
    }

    const { data: messageRows, error: messageError } = await client
      .from(CHAT_MESSAGES_TABLE)
      .select("conversation_id, content, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false });

    if (messageError) throw messageError;

    const latestMessageByConversation = new Map<
      string,
      { content: string | null; createdAt: string | null }
    >();
    for (const row of Array.isArray(messageRows) ? messageRows : []) {
      const conversationId = String(row.conversation_id ?? "");
      if (!conversationId || latestMessageByConversation.has(conversationId)) continue;
      latestMessageByConversation.set(conversationId, {
        content: row.content ? String(row.content) : null,
        createdAt:
          typeof row.created_at === "string" && row.created_at.trim()
            ? row.created_at
            : null,
      });
    }

    const membersByConversation = new Map<
      string,
      Array<{ id: string; name: string }>
    >();
    for (const row of Array.isArray(memberRows) ? memberRows : []) {
      const conversationId = String(row.conversation_id ?? "");
      const memberId = String(row.user_id ?? "");
      if (!conversationId || !memberId) continue;

      const members = membersByConversation.get(conversationId) ?? [];
      members.push({ id: memberId, name: userNameById.get(memberId) ?? "User" });
      membersByConversation.set(conversationId, members);
    }

    return conversations.map((row) => {
      const id = String(row.id ?? randomUUID());
      const latest = latestMessageByConversation.get(id);
      const updatedAt =
        typeof row.updated_at === "string" && row.updated_at.trim()
          ? row.updated_at
          : latest?.createdAt || new Date().toISOString();

      return {
        id,
        subject: row.subject ? String(row.subject) : null,
        listingId: row.listing_id ? String(row.listing_id) : null,
        updatedAt,
        participants: membersByConversation.get(id) ?? [],
        lastMessage: latest?.content ?? null,
        lastMessageAt: latest?.createdAt ?? null,
      } satisfies ChatConversationListItem;
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      isTableMissingError(error as { message?: string })
    ) {
      return buildFallbackConversationList(viewerId, { includeAll });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw new Error(message);
    }
    throw new Error(`Failed to list conversations: ${message}`);
  }
}

export async function listUserConversations(
  viewerIdRaw: string,
  viewerRoleRaw?: string,
  viewerNameRaw?: string,
): Promise<ChatConversationListItem[]> {
  return listConversationsForViewer(viewerIdRaw, viewerRoleRaw, viewerNameRaw, {
    includeAll: false,
  });
}

export async function listAllConversationsForAdmin(
  viewerIdRaw: string,
  viewerRoleRaw?: string,
  viewerNameRaw?: string,
): Promise<ChatConversationListItem[]> {
  return listConversationsForViewer(viewerIdRaw, viewerRoleRaw, viewerNameRaw, {
    includeAll: true,
  });
}

export async function getConversationMessages(
  conversationId: string,
  viewerIdRaw: string,
): Promise<ChatMessageRecord[]> {
  const viewerId = normalizeUserId(viewerIdRaw, viewerIdRaw);
  const client = getClient();

  if (!client) {
    getFallbackConversationAccess(conversationId, viewerId);
    const messages = fallbackMessages.get(conversationId) ?? [];
    return messages.map((message) => mapFallbackMessage(message, viewerId));
  }

  try {
    await ensureConversationAccess(client, conversationId, viewerId);

    const { data, error } = await client
      .from(CHAT_MESSAGES_TABLE)
      .select("id, sender_id, message_type, content, metadata, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const mapped: ChatMessageRecord[] = [];

    for (const row of rows) {
      const createdAt =
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at
          : new Date().toISOString();

      const messageType = String(row.message_type ?? "text") as ChatMessageType;
      const senderId = row.sender_id ? String(row.sender_id) : undefined;
      const sender: ChatSender =
        messageType === "system"
          ? "system"
          : senderId === viewerId
            ? "me"
            : "them";
      const metadata = normalizeMessageMetadata(row.metadata);
      const attachments = await buildAttachmentPreviews(
        client,
        extractAttachmentsFromMetadata(metadata),
      );

      mapped.push({
        id: String(row.id ?? randomUUID()),
        sender,
        content: String(row.content ?? ""),
        time: formatMessageTime(createdAt),
        createdAt,
        senderId,
        messageType,
        metadata,
        attachments,
      } satisfies ChatMessageRecord);
    }

    return mapped;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      isTableMissingError(error as { message?: string })
    ) {
      getFallbackConversationAccess(conversationId, viewerId);
      const messages = fallbackMessages.get(conversationId) ?? [];
      return messages.map((message) => mapFallbackMessage(message, viewerId));
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw new Error(message);
    }
    throw new Error(`Failed to fetch chat messages: ${message}`);
  }
}

export async function sendConversationMessage(
  payload: SendConversationMessageInput,
): Promise<ChatMessageRecord> {
  const senderName = payload.senderName.trim() || "User";
  const senderId = normalizeUserId(payload.senderId, senderName);
  const content = payload.content.trim();
  const messageType: ChatMessageType = payload.messageType === "issue_card" ? "issue_card" : "text";
  const normalizedAttachments = (Array.isArray(payload.attachments) ? payload.attachments : [])
    .map((attachment) => normalizeAttachment(attachment))
    .filter((attachment): attachment is ConversationAttachmentInput => Boolean(attachment));
  const mergedMetadata = mergeMessageMetadata(payload.metadata, normalizedAttachments);
  const hasAttachments = normalizedAttachments.length > 0;
  const effectiveContent =
    content ||
    (messageType === "issue_card"
      ? "Issue update"
      : hasAttachments
        ? normalizedAttachments.length === 1
          ? `Shared attachment: ${normalizedAttachments[0].fileName}`
          : `Shared ${normalizedAttachments.length} attachments`
        : "");

  if (!effectiveContent) {
    throw new Error("Message content or attachment is required.");
  }

  const client = getClient();
  if (!client) {
    registerFallbackUser(senderId, senderName, payload.senderRole);
    const access = getFallbackConversationAccess(payload.conversationId, senderId);
    if (isClosedConversationStatus(access.status)) {
      throwForbidden("This conversation is closed.");
    }

    const createdAt = new Date().toISOString();
    const message: FallbackMessage = {
      id: randomUUID(),
      conversationId: payload.conversationId,
      senderId,
      content: effectiveContent,
      messageType,
      createdAt,
    };

    const current = fallbackMessages.get(payload.conversationId) ?? [];
    fallbackMessages.set(payload.conversationId, [...current, message]);

    const conversation = fallbackConversations.get(payload.conversationId);
    if (conversation) {
      fallbackConversations.set(payload.conversationId, {
        ...conversation,
        updatedAt: createdAt,
      });
    }

    return mapFallbackMessage(message, senderId);
  }

  try {
    await ensureUserExists(client, senderId, senderName, payload.senderRole);
    const access = await ensureConversationAccess(
      client,
      payload.conversationId,
      senderId,
    );
    if (isClosedConversationStatus(access.status)) {
      throwForbidden("This conversation is closed.");
    }

    if (access.isAdmin) {
      const member = await isConversationMember(client, payload.conversationId, senderId);
      if (!member) {
        const { error: addMemberError } = await client.from(CHAT_MEMBERS_TABLE).insert({
          conversation_id: payload.conversationId,
          user_id: senderId,
          role: "support",
        });

        if (addMemberError && !isDuplicateError(addMemberError)) {
          throw addMemberError;
        }
      }
    }

    const { data, error } = await client
      .from(CHAT_MESSAGES_TABLE)
      .insert({
        conversation_id: payload.conversationId,
        sender_id: senderId,
        message_type: messageType,
        content: effectiveContent,
        metadata: mergedMetadata ?? {},
      })
      .select("id, sender_id, message_type, content, metadata, created_at")
      .single();

    if (error) throw error;

    await client
      .from(CHAT_CONVERSATIONS_TABLE)
      .update({ updated_at: new Date().toISOString() })
      .eq("id", payload.conversationId);
    await saveConversationAttachmentLinks(client, {
      conversationId: payload.conversationId,
      senderId,
      attachments: normalizedAttachments,
    });

    const createdAt =
      typeof data?.created_at === "string" && data.created_at.trim()
        ? data.created_at
        : new Date().toISOString();

    const savedMetadata = mergeMessageMetadata(
      normalizeMessageMetadata(data?.metadata),
      normalizedAttachments,
    );
    const messageAttachments = await buildAttachmentPreviews(
      client,
      extractAttachmentsFromMetadata(savedMetadata),
    );

    return {
      id: String(data?.id ?? randomUUID()),
      sender: "me",
      content: String(data?.content ?? effectiveContent),
      time: formatMessageTime(createdAt),
      createdAt,
      senderId,
      messageType,
      metadata: savedMetadata,
      attachments: messageAttachments,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      isTableMissingError(error as { message?: string })
    ) {
      registerFallbackUser(senderId, senderName, payload.senderRole);
      const access = getFallbackConversationAccess(payload.conversationId, senderId);
      if (isClosedConversationStatus(access.status)) {
        throwForbidden("This conversation is closed.");
      }

      const createdAt = new Date().toISOString();
      const message: FallbackMessage = {
        id: randomUUID(),
        conversationId: payload.conversationId,
        senderId,
        content: effectiveContent,
        messageType,
        createdAt,
      };
      const current = fallbackMessages.get(payload.conversationId) ?? [];
      fallbackMessages.set(payload.conversationId, [...current, message]);
      return mapFallbackMessage(message, senderId);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw new Error(message);
    }
    throw new Error(`Failed to send chat message: ${message}`);
  }
}

export async function listConversationFiles(
  conversationIdRaw: string,
  viewerIdRaw: string,
): Promise<ConversationFileRecord[]> {
  const conversationId = String(conversationIdRaw ?? "").trim();
  const viewerId = normalizeUserId(viewerIdRaw, viewerIdRaw);
  if (!conversationId || !viewerId) return [];

  const client = getClient();
  if (!client) {
    getFallbackConversationAccess(conversationId, viewerId);
    return [];
  }

  try {
    await ensureConversationAccess(client, conversationId, viewerId);

    const { data: attachmentRowsRaw, error: attachmentError } = await client
      .from(CONVERSATION_ATTACHMENTS_TABLE)
      .select("id, uploaded_by, bucket_id, storage_path, file_name, mime_type, file_size_bytes, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(250);

    if (attachmentError && !isTableMissingError(attachmentError) && !isColumnMissingError(attachmentError)) {
      throw attachmentError;
    }

    const { data: transcriptRowRaw, error: transcriptError } = await client
      .from(CONVERSATION_TRANSCRIPTS_TABLE)
      .select("conversation_id, transcript_format, bucket_id, storage_path, generated_at")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (transcriptError && !isTableMissingError(transcriptError) && !isColumnMissingError(transcriptError)) {
      throw transcriptError;
    }

    const attachmentRows = (Array.isArray(attachmentRowsRaw) ? attachmentRowsRaw : []) as Array<
      Record<string, unknown>
    >;

    const records: ConversationFileRecord[] = attachmentRows.map((row) => {
      const storagePath = String(row.storage_path ?? "").trim();
      const bucketId = String(row.bucket_id ?? "").trim() || "chat-attachments";
      return {
        id: String(row.id ?? randomUUID()),
        kind: "attachment",
        bucketId,
        storagePath,
        fileName: buildFileNameFromStoragePath(
          storagePath,
          String(row.file_name ?? "Attachment").trim() || "Attachment",
        ),
        mimeType: String(row.mime_type ?? "").trim() || undefined,
        fileSizeBytes:
          typeof row.file_size_bytes === "number" && Number.isFinite(row.file_size_bytes)
            ? Math.max(0, Math.trunc(row.file_size_bytes))
            : undefined,
        createdAt: String(row.created_at ?? "").trim() || new Date().toISOString(),
        uploadedBy: String(row.uploaded_by ?? "").trim() || undefined,
      } satisfies ConversationFileRecord;
    });

    if (transcriptRowRaw && typeof transcriptRowRaw === "object") {
      const transcriptRow = transcriptRowRaw as Record<string, unknown>;
      const transcriptStoragePath = String(transcriptRow.storage_path ?? "").trim();
      const transcriptBucketId = String(transcriptRow.bucket_id ?? "").trim() || "conversation-transcripts";
      if (transcriptStoragePath) {
        records.push({
          id: `transcript:${conversationId}`,
          kind: "transcript",
          bucketId: transcriptBucketId,
          storagePath: transcriptStoragePath,
          fileName: buildFileNameFromStoragePath(transcriptStoragePath, "service_transcript.pdf"),
          mimeType: "application/pdf",
          createdAt: String(transcriptRow.generated_at ?? "").trim() || new Date().toISOString(),
        });
      }
    }

    const dedupe = new Set<string>();
    const uniqueRecords = records.filter((record) => {
      const key = `${record.kind}:${record.bucketId}:${record.storagePath}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });

    const withSignedUrls = await Promise.all(
      uniqueRecords.map(async (record) => ({
        ...record,
        previewUrl: await buildSignedStorageUrl(client, record.bucketId, record.storagePath),
      })),
    );

    return withSignedUrls.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      isTableMissingError(error as { message?: string })
    ) {
      getFallbackConversationAccess(conversationId, viewerId);
      return [];
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw new Error(message);
    }
    throw new Error(`Failed to load conversation files: ${message}`);
  }
}

export async function closeListingConversations(
  listingId: string,
  reason = "listing_closed_deal",
): Promise<number> {
  const normalizedListingId = String(listingId ?? "").trim();
  if (!normalizedListingId) return 0;

  const client = getClient();
  if (!client) {
    const nowIso = new Date().toISOString();
    let closedCount = 0;
    fallbackConversations.forEach((conversation, conversationId) => {
      if (conversation.listingId !== normalizedListingId) return;
      if (conversation.status === "closed") return;

      fallbackConversations.set(conversationId, {
        ...conversation,
        status: "closed",
        closedAt: nowIso,
        closedReason: reason,
        updatedAt: nowIso,
      });
      closedCount += 1;
    });
    return closedCount;
  }

  try {
    const { data: rows, error: loadError } = await client
      .from(CHAT_CONVERSATIONS_TABLE)
      .select("id")
      .eq("listing_id", normalizedListingId);

    if (loadError) throw loadError;

    const ids = (Array.isArray(rows) ? rows : [])
      .map((row) => String(row.id ?? ""))
      .filter(Boolean);

    if (ids.length === 0) {
      return 0;
    }

    const nowIso = new Date().toISOString();
    let updateError: { message?: string } | null = null;

    const closeAttempt = await client
      .from(CHAT_CONVERSATIONS_TABLE)
      .update({
        status: "closed",
        closed_at: nowIso,
        closed_reason: reason,
        updated_at: nowIso,
      })
      .in("id", ids);

    updateError = closeAttempt.error as { message?: string } | null;
    if (updateError && isColumnMissingError(updateError)) {
      const fallbackUpdate = await client
        .from(CHAT_CONVERSATIONS_TABLE)
        .update({ updated_at: nowIso })
        .in("id", ids);
      updateError = fallbackUpdate.error as { message?: string } | null;
    }

    if (updateError) throw updateError;
    return ids.length;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const nowIso = new Date().toISOString();
      let closedCount = 0;
      fallbackConversations.forEach((conversation, conversationId) => {
        if (conversation.listingId !== normalizedListingId) return;
        fallbackConversations.set(conversationId, {
          ...conversation,
          status: "closed",
          closedAt: nowIso,
          closedReason: reason,
          updatedAt: nowIso,
        });
        closedCount += 1;
      });
      return closedCount;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to close listing conversations: ${message}`);
  }
}
