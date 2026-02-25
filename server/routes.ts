import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { submitSmileIdVerification } from "./smile-id";
import {
  getUserVerificationSnapshot,
  saveVerification,
  setUserVerificationState,
  updateVerificationByCallbackIdentifiers,
} from "./verification-repository";
import {
  addFlaggedListingComment,
  getAdminDashboardData,
  getUserChatCards,
  setFlaggedListingStatus,
  setVerificationStatus,
  type AdminFlaggedListingStatus,
  type AdminVerificationStatus,
} from "./admin-repository";
import {
  getConversationMessages,
  listAllConversationsForAdmin,
  listUserConversations,
  sendConversationMessage,
  upsertChatConversation,
} from "./chat-repository";
import {
  createAgentListing,
  deleteAgentListing,
  listAgentListings,
  updateListingVerificationStepStatus,
  updateAgentListing,
  updateAgentListingPayoutStatus,
  updateAgentListingStatus,
  type AgentListingVerificationStepStatus,
  type AgentListingStatus,
  type AgentPayoutStatus,
} from "./listing-repository";
import { listServiceOfferings, updateServiceOffering } from "./service-offerings-repository";
import {
  createHiringApplication,
  listHiringApplications,
  updateHiringApplicationStatus,
} from "./hiring-repository";
import { checkPhoneVerificationCode, sendPhoneVerificationCode } from "./twilio-verify";
import { checkEmailVerificationCode, sendEmailVerificationCode } from "./email-otp";
import {
  checkPhoneSendAllowed,
  checkPhoneVerifyAllowed,
  getPhoneOtpPolicy,
  markPhoneCodeSent,
  markPhoneVerifyFailed,
  markPhoneVerifySucceeded,
} from "./phone-otp-guard";
import {
  uploadVerificationDocument,
  VerificationDocumentValidationError,
} from "./verification-documents-repository";
import {
  claimPayoutLedgerEntry,
  createChatAction,
  ensureUserExistsForOtp,
  getTransactionByConversationId,
  getTransactionByIdPublic,
  listTransactionActions,
  resolveChatAction,
  transitionTransactionStatus,
  upsertTransaction,
  upsertTransactionRating,
  type AppRole,
  type ChatActionRecord,
  type ChatActionType,
  type TransactionRecord,
  type TransactionStatus,
} from "./transaction-flow-repository";
import {
  createServiceProviderLink,
  enqueueServicePdfJob,
  listOpenDisputes,
  listProviderLinksByConversation,
  listServicePdfJobs,
  listTransactionDisputes,
  openTransactionDispute,
  processNextServicePdfJob,
  resolveProviderPackageByToken,
  resolveTransactionDispute,
  revokeProviderLink,
  setTransactionAcceptanceDueAt,
} from "./service-automation-repository";

const CHAT_CONVERSATIONS_TABLE =
  process.env.SUPABASE_CHAT_CONVERSATIONS_TABLE || "chat_conversations";
const SERVICE_REQUESTS_TABLE =
  process.env.SUPABASE_SERVICE_REQUESTS_TABLE || "service_request_records";
const CONVERSATION_TRANSCRIPTS_TABLE =
  process.env.SUPABASE_CONVERSATION_TRANSCRIPTS_TABLE || "conversation_transcripts";
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
const VERIFICATIONS_TABLE = process.env.SUPABASE_VERIFICATIONS_TABLE || "verifications";
const VERIFICATION_DOCUMENTS_TABLE =
  process.env.SUPABASE_VERIFICATION_DOCUMENTS_TABLE || "verification_documents";
const LISTINGS_TABLE = process.env.SUPABASE_LISTINGS_TABLE || "listings";
const LISTING_IMAGES_TABLE = process.env.SUPABASE_LISTING_IMAGES_TABLE || "listing_images";
const LISTING_DOCUMENTS_TABLE = process.env.SUPABASE_LISTING_DOCUMENTS_TABLE || "listing_documents";
const AGENT_PROFILES_TABLE = process.env.SUPABASE_AGENT_PROFILES_TABLE || "agent_profiles";
const UTILITY_BILLS_TABLE = process.env.SUPABASE_UTILITY_BILLS_TABLE || "utility_bills";
const PROPERTY_EXPENSES_TABLE = process.env.SUPABASE_PROPERTY_EXPENSES_TABLE || "property_expenses";
const USER_DOCUMENT_RECORDS_TABLE =
  process.env.SUPABASE_USER_DOCUMENT_RECORDS_TABLE || "user_document_records";
const PROPERTY_IMAGES_BUCKET = process.env.SUPABASE_PROPERTY_IMAGES_BUCKET || "property-images";
const PROPERTY_DOCUMENTS_BUCKET =
  process.env.SUPABASE_PROPERTY_DOCUMENTS_BUCKET || "property-documents";

function createSupabaseServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function sanitizeStorageFileName(value: string): string {
  const safe = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || "attachment.bin";
}

function normalizeServiceCodeForPath(rawValue: string | undefined): string {
  const candidate = String(rawValue ?? "")
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

  return (
    candidate
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "general_service"
  );
}

function toServiceFolderSegment(serviceCodeRaw: string | undefined): string {
  const serviceCode = normalizeServiceCodeForPath(serviceCodeRaw);
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

function buildServiceFolderRoot(
  serviceCodeRaw: string | undefined,
  requesterOrSenderId: string,
  conversationId: string,
): string {
  return `Services/${toServiceFolderSegment(serviceCodeRaw)}/${requesterOrSenderId}/${conversationId}`;
}

function isMissingTableOrColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function getBearerToken(req: Request): string {
  const header = String(req.headers.authorization ?? "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

type AppUserRole = "buyer" | "seller" | "agent" | "admin" | "owner" | "renter";

function normalizeUserRole(
  rawRole: unknown,
  options?: { allowAdmin?: boolean },
): AppUserRole {
  const role = String(rawRole ?? "")
    .trim()
    .toLowerCase();
  const allowAdmin = Boolean(options?.allowAdmin);
  if (role === "buyer" || role === "seller" || role === "agent") {
    return role;
  }
  if (role === "admin") {
    return allowAdmin ? "admin" : "buyer";
  }
  if (role === "owner" || role === "renter") return role;
  return "buyer";
}

function normalizeActionRole(rawRole: unknown): AppRole {
  const role = String(rawRole ?? "")
    .trim()
    .toLowerCase();
  if (role === "admin") return "admin";
  if (role === "agent") return "agent";
  if (role === "seller") return "seller";
  if (role === "owner") return "owner";
  if (role === "renter") return "renter";
  if (role === "support") return "support";
  return "buyer";
}

function toTransactionStatus(rawStatus: unknown): TransactionStatus {
  return String(rawStatus ?? "")
    .trim()
    .toLowerCase() as TransactionStatus;
}

function toChatActionType(rawActionType: unknown): ChatActionType {
  return String(rawActionType ?? "")
    .trim()
    .toLowerCase() as ChatActionType;
}

function resolveDirectAcceptanceDueAtIso(): string {
  const minHours = 48;
  const maxHours = 72;
  const jitterHours = Math.floor(Math.random() * (maxHours - minHours + 1));
  const totalHours = minHours + jitterHours;
  return new Date(Date.now() + totalHours * 60 * 60 * 1000).toISOString();
}

function isPrivilegedActorRole(role: AppRole): boolean {
  return role === "admin" || role === "support";
}

function resolvePublicAppBaseUrl(req: Request): string {
  const configured = String(process.env.PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/g, "");
  }

  const forwardedProtoRaw = req.headers["x-forwarded-proto"];
  const forwardedHostRaw = req.headers["x-forwarded-host"];
  const proto =
    (Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw) ||
    req.protocol ||
    "https";
  const host =
    (Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw) ||
    req.get("host") ||
    "";

  const safeProto = String(proto).split(",")[0].trim() || "https";
  const safeHost = String(host).split(",")[0].trim();
  if (!safeHost) return "";
  return `${safeProto}://${safeHost}`;
}

function buildEscrowInstructionMessage(transaction: TransactionRecord): string {
  const accountName = String(process.env.ESCROW_ACCOUNT_NAME ?? "Justice City Escrow").trim();
  const accountNumber = String(process.env.ESCROW_ACCOUNT_NUMBER ?? "0000000000").trim();
  const bankName = String(process.env.ESCROW_BANK_NAME ?? "Justice City Partner Bank").trim();
  const reference = String(transaction.escrowReference ?? "").trim() || `TXN-${transaction.id.slice(0, 8).toUpperCase()}`;
  return `Escrow payment approved. Pay to ${accountName}, ${bankName}, ${accountNumber}. Reference: ${reference}.`;
}

async function postTransactionActionMessage(args: {
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  action: ChatActionRecord;
  content?: string;
}): Promise<void> {
  await sendConversationMessage({
    conversationId: args.conversationId,
    senderId: args.senderId,
    senderName: args.senderName,
    senderRole: args.senderRole,
    messageType: "issue_card",
    content: args.content ?? "Action required",
    metadata: {
      issueCard: {
        title: String(args.action.actionType ?? "").replace(/_/g, " ").toUpperCase(),
        message: args.content ?? "Action required",
        status: args.action.status,
      },
      actionCard: {
        id: args.action.id,
        transactionId: args.action.transactionId,
        actionType: args.action.actionType,
        targetRole: args.action.targetRole,
        status: args.action.status,
        payload: args.action.payload,
        expiresAt: args.action.expiresAt,
      },
    },
  });
}

function normalizePhoneNumber(rawValue: unknown): string {
  return String(rawValue ?? "").replace(/\s+/g, "").trim();
}

function isE164Phone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildFallbackUsername(email: string | null | undefined, userId: string): string {
  const prefix = String(email ?? "")
    .split("@")[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safePrefix = prefix || "user";
  return `${safePrefix}_${String(userId).slice(0, 8)}`;
}

async function ensurePublicUserRow(
  client: SupabaseClient,
  authUser: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const userId = String(authUser.id ?? "").trim();
  if (!userId) return;

  const { data: existing, error: existingError } = await client
    .from(USERS_TABLE)
    .select("id")
    .eq("id", userId)
    .maybeSingle<{ id: string }>();

  if (existingError && !isMissingTableOrColumnError(existingError)) {
    throw existingError;
  }
  if (existing) return;
  if (existingError && isMissingTableOrColumnError(existingError)) return;

  const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    String(metadata.full_name ?? metadata.name ?? "").trim() || String(authUser.email ?? "");
  const role = normalizeUserRole(metadata.role);
  const genderRaw = String(metadata.gender ?? "").trim().toLowerCase();
  const gender = genderRaw === "male" || genderRaw === "female" ? genderRaw : null;
  const avatarUrl = String(metadata.avatar_url ?? metadata.picture ?? "").trim() || null;

  const insertPayload: Record<string, unknown> = {
    id: userId,
    username: buildFallbackUsername(authUser.email, userId),
    password: "supabase_auth_managed",
    full_name: fullName || null,
    email: authUser.email ?? null,
    role,
    status: "active",
    is_verified: false,
    gender,
    avatar_url: avatarUrl,
  };

  const { error: insertError } = await client.from(USERS_TABLE).insert(insertPayload);
  if (insertError && !isMissingTableOrColumnError(insertError)) {
    throw insertError;
  }
}

async function buildAuthProfileFromToken(
  client: SupabaseClient,
  token: string,
): Promise<{
  id: string;
  name: string;
  nickname?: string;
  email: string;
  role: AppUserRole;
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  phone?: string;
  gender?: "male" | "female";
  dateOfBirth?: string;
  homeAddress?: string;
  officeAddress?: string;
  avatar?: string;
  } | null> {
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData?.user) return null;

  const authUser = authData.user;
  await ensurePublicUserRow(client, {
    id: authUser.id,
    email: authUser.email ?? null,
    user_metadata: (authUser.user_metadata ?? null) as Record<string, unknown> | null,
  });

  type AuthUserRow = {
    id: string;
    username?: string | null;
    full_name?: string | null;
    email?: string | null;
    role?: string | null;
    is_verified?: boolean | null;
    email_verified?: boolean | null;
    phone_verified?: boolean | null;
    avatar_url?: string | null;
    phone?: string | null;
    gender?: string | null;
    date_of_birth?: string | null;
    home_address?: string | null;
    office_address?: string | null;
  };

  let userRow: AuthUserRow | null = null;

  const { data: fullUserRow, error: fullUserError } = await client
    .from(USERS_TABLE)
    .select(
      "id, username, full_name, email, role, is_verified, email_verified, phone_verified, avatar_url, phone, gender, date_of_birth, home_address, office_address",
    )
    .eq("id", authUser.id)
    .maybeSingle<AuthUserRow>();

  if (!fullUserError) {
    userRow = fullUserRow ?? null;
  } else if (isMissingTableOrColumnError(fullUserError)) {
    const { data: fallbackUserRow, error: fallbackUserError } = await client
      .from(USERS_TABLE)
      .select(
        "id, username, full_name, email, role, is_verified, email_verified, phone_verified, avatar_url, phone, gender",
      )
      .eq("id", authUser.id)
      .maybeSingle<AuthUserRow>();

    if (fallbackUserError && !isMissingTableOrColumnError(fallbackUserError)) {
      throw fallbackUserError;
    }
    userRow = fallbackUserRow ?? null;
  } else {
    throw fullUserError;
  }

  const authUserEmailFields = authUser as {
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
  };
  const emailConfirmedFromAuth = Boolean(
    String(authUserEmailFields.email_confirmed_at ?? authUserEmailFields.confirmed_at ?? "").trim(),
  );

  if (emailConfirmedFromAuth && !Boolean(userRow?.email_verified)) {
    const { error: syncEmailFlagError } = await client
      .from(USERS_TABLE)
      .update({ email_verified: true, email: authUser.email ?? null })
      .eq("id", authUser.id);
    if (!syncEmailFlagError || isMissingTableOrColumnError(syncEmailFlagError)) {
      if (userRow) {
        userRow.email_verified = true;
      }
    }
  }

  let derivedVerified = Boolean(userRow?.is_verified);
  if (!derivedVerified) {
    const { data: approvedRecord, error: approvedError } = await client
      .from(VERIFICATIONS_TABLE)
      .select("status")
      .eq("user_id", authUser.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle<{ status?: string | null }>();

    if (approvedError && !isMissingTableOrColumnError(approvedError)) {
      throw approvedError;
    }

    derivedVerified = Boolean(approvedRecord);
    if (derivedVerified) {
      const { error: syncVerifiedError } = await client
        .from(USERS_TABLE)
        .update({ is_verified: true })
        .eq("id", authUser.id);
      if (!syncVerifiedError || isMissingTableOrColumnError(syncVerifiedError)) {
        if (userRow) {
          userRow.is_verified = true;
        }
      }
    }
  }

  const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  const email = String(userRow?.email ?? authUser.email ?? "").trim();
  const role = userRow?.role
    ? normalizeUserRole(userRow.role, { allowAdmin: true })
    : normalizeUserRole(metadata.role);
  const name =
    String(userRow?.full_name ?? metadata.full_name ?? metadata.name ?? "").trim() ||
    email.split("@")[0] ||
    "User";
  const nickname =
    String(userRow?.username ?? metadata.nickname ?? metadata.username ?? "").trim() || undefined;
  const avatar =
    String(userRow?.avatar_url ?? metadata.avatar_url ?? metadata.picture ?? "").trim() || undefined;
  const metadataGender = String(metadata.gender ?? "").trim().toLowerCase();
  const resolvedGenderRaw = String(userRow?.gender ?? metadataGender).trim().toLowerCase();
  const resolvedGender =
    resolvedGenderRaw === "male" || resolvedGenderRaw === "female"
      ? (resolvedGenderRaw as "male" | "female")
      : undefined;
  const loadUserColumnValue = async (
    column: "date_of_birth" | "home_address" | "office_address",
  ): Promise<string | undefined> => {
    const { data, error } = await client
      .from(USERS_TABLE)
      .select(column)
      .eq("id", authUser.id)
      .maybeSingle<Record<string, string | null>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return undefined;
      throw error;
    }

    return String(data?.[column] ?? "").trim() || undefined;
  };
  const loadLatestVerificationColumnValue = async (
    column: "date_of_birth" | "home_address" | "office_address",
  ): Promise<string | undefined> => {
    const { data, error } = await client
      .from(VERIFICATIONS_TABLE)
      .select(column)
      .eq("user_id", authUser.id)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Record<string, string | null>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return undefined;
      throw error;
    }

    return String(data?.[column] ?? "").trim() || undefined;
  };

  let dateOfBirth = String(userRow?.date_of_birth ?? "").trim() || undefined;
  let homeAddress = String(userRow?.home_address ?? "").trim() || undefined;
  let officeAddress = String(userRow?.office_address ?? "").trim() || undefined;

  if (!dateOfBirth) {
    dateOfBirth = await loadUserColumnValue("date_of_birth");
  }
  if (!homeAddress) {
    homeAddress = await loadUserColumnValue("home_address");
  }
  if (!officeAddress) {
    officeAddress = await loadUserColumnValue("office_address");
  }

  const profileBackfillUpdates: Record<string, string> = {};
  if (!dateOfBirth) {
    const fallback = await loadLatestVerificationColumnValue("date_of_birth");
    if (fallback) {
      dateOfBirth = fallback;
      profileBackfillUpdates.date_of_birth = fallback;
    }
  }
  if (!homeAddress) {
    const fallback = await loadLatestVerificationColumnValue("home_address");
    if (fallback) {
      homeAddress = fallback;
      profileBackfillUpdates.home_address = fallback;
    }
  }
  if (!officeAddress) {
    const fallback = await loadLatestVerificationColumnValue("office_address");
    if (fallback) {
      officeAddress = fallback;
      profileBackfillUpdates.office_address = fallback;
    }
  }

  if (Object.keys(profileBackfillUpdates).length > 0) {
    const { error: profileBackfillError } = await client
      .from(USERS_TABLE)
      .update(profileBackfillUpdates)
      .eq("id", authUser.id);
    if (profileBackfillError && !isMissingTableOrColumnError(profileBackfillError)) {
      throw profileBackfillError;
    }
  }

  const phone = String(userRow?.phone ?? "").trim() || undefined;

  return {
    id: String(authUser.id),
    name,
    nickname,
    email,
    role,
    isVerified: derivedVerified,
    emailVerified: Boolean(userRow?.email_verified) || emailConfirmedFromAuth,
    phoneVerified: Boolean(userRow?.phone_verified),
    phone,
    gender: resolvedGender,
    dateOfBirth,
    homeAddress,
    officeAddress,
    avatar,
  };
}

type AuthenticatedActor = {
  userId: string;
  role: AppUserRole;
  name: string;
};

function canUseUtilityBills(role: AppUserRole): boolean {
  return role === "admin" || role === "owner" || role === "renter";
}

function canAccessUtilityBillRow(actor: AuthenticatedActor, row: UtilityBillRow): boolean {
  if (actor.role === "admin") return true;
  const ownerUserId = String(row.owner_user_id ?? "").trim();
  const renterUserId = String(row.renter_user_id ?? "").trim();
  return ownerUserId === actor.userId || renterUserId === actor.userId;
}

function canUsePropertyExpenses(role: AppUserRole): boolean {
  return role === "admin" || role === "owner";
}

function canAccessPropertyExpenseRow(actor: AuthenticatedActor, row: PropertyExpenseRow): boolean {
  if (actor.role === "admin") return true;
  const ownerUserId = String(row.owner_user_id ?? "").trim();
  return ownerUserId === actor.userId;
}

function canAccessUserDocumentRow(actor: AuthenticatedActor, row: UserDocumentRow): boolean {
  if (actor.role === "admin") return true;
  const participantIds = [
    String(row.owner_user_id ?? "").trim(),
    String(row.renter_user_id ?? "").trim(),
    String(row.buyer_user_id ?? "").trim(),
    String(row.seller_user_id ?? "").trim(),
    String(row.agent_user_id ?? "").trim(),
  ].filter(Boolean);
  return participantIds.includes(actor.userId);
}

function applyActorDocumentRole(
  actor: AuthenticatedActor,
  payload: {
    ownerUserId?: string | null;
    renterUserId?: string | null;
    buyerUserId?: string | null;
    sellerUserId?: string | null;
    agentUserId?: string | null;
  },
): {
  ownerUserId?: string | null;
  renterUserId?: string | null;
  buyerUserId?: string | null;
  sellerUserId?: string | null;
  agentUserId?: string | null;
} {
  if (actor.role === "admin") return payload;

  const next = { ...payload };
  if (actor.role === "owner") next.ownerUserId = actor.userId;
  if (actor.role === "renter") next.renterUserId = actor.userId;
  if (actor.role === "buyer") next.buyerUserId = actor.userId;
  if (actor.role === "seller") next.sellerUserId = actor.userId;
  if (actor.role === "agent") next.agentUserId = actor.userId;
  return next;
}

type AgentProfileRow = {
  user_id: string;
  display_name?: string | null;
  bio?: string | null;
  sales_rating?: number | string | null;
  review_count?: number | null;
  recent_deals_count?: number | null;
  closed_deals_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AgentProfileRecord = {
  userId: string;
  displayName?: string;
  bio?: string;
  salesRating: number;
  reviewCount: number;
  recentDealsCount: number;
  closedDealsCount: number;
  createdAt?: string;
  updatedAt?: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapAgentProfileRow(
  row: AgentProfileRow,
  options?: { fallbackDisplayName?: string },
): AgentProfileRecord {
  const fallbackDisplayName = String(options?.fallbackDisplayName ?? "").trim();
  return {
    userId: String(row.user_id ?? "").trim(),
    displayName: String(row.display_name ?? "").trim() || fallbackDisplayName || undefined,
    bio: String(row.bio ?? "").trim() || undefined,
    salesRating: toNumber(row.sales_rating, 0),
    reviewCount: Math.max(0, Math.floor(toNumber(row.review_count, 0))),
    recentDealsCount: Math.max(0, Math.floor(toNumber(row.recent_deals_count, 0))),
    closedDealsCount: Math.max(0, Math.floor(toNumber(row.closed_deals_count, 0))),
    createdAt: String(row.created_at ?? "").trim() || undefined,
    updatedAt: String(row.updated_at ?? "").trim() || undefined,
  };
}

async function loadListingDealMetrics(
  client: SupabaseClient,
  userId: string,
): Promise<{ recentDealsCount: number; closedDealsCount: number }> {
  const { data, error } = await client
    .from(LISTINGS_TABLE)
    .select("status, updated_at, created_at")
    .eq("agent_id", userId)
    .in("status", ["sold", "rented"]);

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      return { recentDealsCount: 0, closedDealsCount: 0 };
    }
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const now = Date.now();
  const recentWindowMs = 1000 * 60 * 60 * 24 * 30;
  let recentDealsCount = 0;
  for (const row of rows) {
    const updatedAtIso = String((row as Record<string, unknown>)?.updated_at ?? "").trim();
    const createdAtIso = String((row as Record<string, unknown>)?.created_at ?? "").trim();
    const timestamp =
      (updatedAtIso && new Date(updatedAtIso).getTime()) ||
      (createdAtIso && new Date(createdAtIso).getTime()) ||
      Number.NaN;
    if (Number.isFinite(timestamp) && now - timestamp <= recentWindowMs) {
      recentDealsCount += 1;
    }
  }

  return {
    recentDealsCount,
    closedDealsCount: rows.length,
  };
}

async function getOrCreateAgentProfile(
  client: SupabaseClient,
  userId: string,
  options?: { fallbackDisplayName?: string },
): Promise<AgentProfileRecord> {
  const fallbackDisplayName = String(options?.fallbackDisplayName ?? "").trim();
  const { data, error } = await client
    .from(AGENT_PROFILES_TABLE)
    .select(
      "user_id, display_name, bio, sales_rating, review_count, recent_deals_count, closed_deals_count, created_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle<AgentProfileRow>();

  if (error && !isMissingTableOrColumnError(error)) {
    throw error;
  }

  if (data) {
    return mapAgentProfileRow(data, { fallbackDisplayName });
  }

  const metrics = await loadListingDealMetrics(client, userId);
  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    recent_deals_count: metrics.recentDealsCount,
    closed_deals_count: metrics.closedDealsCount,
  };
  if (fallbackDisplayName) {
    insertPayload.display_name = fallbackDisplayName;
  }

  const { data: inserted, error: insertError } = await client
    .from(AGENT_PROFILES_TABLE)
    .upsert(insertPayload, { onConflict: "user_id" })
    .select(
      "user_id, display_name, bio, sales_rating, review_count, recent_deals_count, closed_deals_count, created_at, updated_at",
    )
    .maybeSingle<AgentProfileRow>();

  if (insertError && !isMissingTableOrColumnError(insertError)) {
    throw insertError;
  }

  if (inserted) {
    return mapAgentProfileRow(inserted, { fallbackDisplayName });
  }

  return {
    userId,
    displayName: fallbackDisplayName || undefined,
    bio: undefined,
    salesRating: 0,
    reviewCount: 0,
    recentDealsCount: metrics.recentDealsCount,
    closedDealsCount: metrics.closedDealsCount,
  };
}

type UtilityBillDbStatus = "pending" | "paid" | "overdue";
type UtilityBillDbType =
  | "electricity"
  | "water"
  | "waste_management"
  | "maintenance"
  | "other";

type UtilityBillStatus = "Pending" | "Paid" | "Overdue";
type UtilityBillType = "Electricity" | "Water" | "Waste Management" | "Maintenance" | "Other";

type UtilityBillRow = {
  id: string;
  listing_id?: string | null;
  owner_user_id?: string | null;
  renter_user_id?: string | null;
  bill_type?: string | null;
  amount?: number | string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  due_date?: string | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type UtilityBillRecord = {
  id: string;
  listingId?: string;
  ownerUserId?: string;
  renterUserId?: string;
  billType: UtilityBillType;
  amount: number;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  dueDate?: string;
  status: UtilityBillStatus;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

function toUtilityBillDbStatus(rawValue: unknown): UtilityBillDbStatus {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (value === "paid") return "paid";
  if (value === "overdue") return "overdue";
  return "pending";
}

function fromUtilityBillDbStatus(rawValue: unknown): UtilityBillStatus {
  const value = toUtilityBillDbStatus(rawValue);
  if (value === "paid") return "Paid";
  if (value === "overdue") return "Overdue";
  return "Pending";
}

function toUtilityBillDbType(rawValue: unknown): UtilityBillDbType {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (value === "electricity") return "electricity";
  if (value === "water") return "water";
  if (value === "waste_management" || value === "waste management") return "waste_management";
  if (value === "maintenance") return "maintenance";
  return "other";
}

function fromUtilityBillDbType(rawValue: unknown): UtilityBillType {
  const value = toUtilityBillDbType(rawValue);
  if (value === "electricity") return "Electricity";
  if (value === "water") return "Water";
  if (value === "waste_management") return "Waste Management";
  if (value === "maintenance") return "Maintenance";
  return "Other";
}

function mapUtilityBillRow(row: UtilityBillRow): UtilityBillRecord {
  return {
    id: String(row.id ?? "").trim(),
    listingId: String(row.listing_id ?? "").trim() || undefined,
    ownerUserId: String(row.owner_user_id ?? "").trim() || undefined,
    renterUserId: String(row.renter_user_id ?? "").trim() || undefined,
    billType: fromUtilityBillDbType(row.bill_type),
    amount: Math.max(0, toNumber(row.amount, 0)),
    billingPeriodStart: String(row.billing_period_start ?? "").trim() || undefined,
    billingPeriodEnd: String(row.billing_period_end ?? "").trim() || undefined,
    dueDate: String(row.due_date ?? "").trim() || undefined,
    status: fromUtilityBillDbStatus(row.status),
    notes: String(row.notes ?? "").trim() || undefined,
    createdAt: String(row.created_at ?? "").trim() || undefined,
    updatedAt: String(row.updated_at ?? "").trim() || undefined,
  };
}

type PropertyExpenseDbCategory =
  | "maintenance"
  | "repairs"
  | "taxes"
  | "utilities"
  | "security"
  | "other";

type PropertyExpenseCategory =
  | "Maintenance"
  | "Repairs"
  | "Taxes"
  | "Utilities"
  | "Security"
  | "Other";

type PropertyExpenseRow = {
  id: string;
  listing_id?: string | null;
  owner_user_id?: string | null;
  category?: string | null;
  amount?: number | string | null;
  expense_date?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type PropertyExpenseRecord = {
  id: string;
  listingId?: string;
  ownerUserId?: string;
  category: PropertyExpenseCategory;
  amount: number;
  expenseDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

function toPropertyExpenseDbCategory(rawValue: unknown): PropertyExpenseDbCategory {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (value === "maintenance") return "maintenance";
  if (value === "repairs") return "repairs";
  if (value === "taxes") return "taxes";
  if (value === "utilities") return "utilities";
  if (value === "security") return "security";
  return "other";
}

function fromPropertyExpenseDbCategory(rawValue: unknown): PropertyExpenseCategory {
  const value = toPropertyExpenseDbCategory(rawValue);
  if (value === "maintenance") return "Maintenance";
  if (value === "repairs") return "Repairs";
  if (value === "taxes") return "Taxes";
  if (value === "utilities") return "Utilities";
  if (value === "security") return "Security";
  return "Other";
}

function mapPropertyExpenseRow(row: PropertyExpenseRow): PropertyExpenseRecord {
  return {
    id: String(row.id ?? "").trim(),
    listingId: String(row.listing_id ?? "").trim() || undefined,
    ownerUserId: String(row.owner_user_id ?? "").trim() || undefined,
    category: fromPropertyExpenseDbCategory(row.category),
    amount: Math.max(0, toNumber(row.amount, 0)),
    expenseDate: String(row.expense_date ?? "").trim() || undefined,
    notes: String(row.notes ?? "").trim() || undefined,
    createdAt: String(row.created_at ?? "").trim() || undefined,
    updatedAt: String(row.updated_at ?? "").trim() || undefined,
  };
}

type UserDocumentDbType = "contract" | "title" | "invoice" | "receipt" | "attachment" | "other";
type UserDocumentType = "Contract" | "Title" | "Invoice" | "Receipt" | "Attachment" | "Other";

type UserDocumentRow = {
  id: string;
  listing_id?: string | null;
  conversation_id?: string | null;
  owner_user_id?: string | null;
  renter_user_id?: string | null;
  buyer_user_id?: string | null;
  seller_user_id?: string | null;
  agent_user_id?: string | null;
  document_type?: string | null;
  bucket_id?: string | null;
  storage_path?: string | null;
  display_name?: string | null;
  created_at?: string | null;
};

type UserDocumentRecord = {
  id: string;
  listingId?: string;
  conversationId?: string;
  ownerUserId?: string;
  renterUserId?: string;
  buyerUserId?: string;
  sellerUserId?: string;
  agentUserId?: string;
  documentType: UserDocumentType;
  bucketId: string;
  storagePath: string;
  displayName?: string;
  createdAt?: string;
};

function toUserDocumentDbType(rawValue: unknown): UserDocumentDbType {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (value === "contract") return "contract";
  if (value === "title") return "title";
  if (value === "invoice") return "invoice";
  if (value === "receipt") return "receipt";
  if (value === "attachment") return "attachment";
  return "other";
}

function fromUserDocumentDbType(rawValue: unknown): UserDocumentType {
  const value = toUserDocumentDbType(rawValue);
  if (value === "contract") return "Contract";
  if (value === "title") return "Title";
  if (value === "invoice") return "Invoice";
  if (value === "receipt") return "Receipt";
  if (value === "attachment") return "Attachment";
  return "Other";
}

function mapUserDocumentRow(row: UserDocumentRow): UserDocumentRecord {
  return {
    id: String(row.id ?? "").trim(),
    listingId: String(row.listing_id ?? "").trim() || undefined,
    conversationId: String(row.conversation_id ?? "").trim() || undefined,
    ownerUserId: String(row.owner_user_id ?? "").trim() || undefined,
    renterUserId: String(row.renter_user_id ?? "").trim() || undefined,
    buyerUserId: String(row.buyer_user_id ?? "").trim() || undefined,
    sellerUserId: String(row.seller_user_id ?? "").trim() || undefined,
    agentUserId: String(row.agent_user_id ?? "").trim() || undefined,
    documentType: fromUserDocumentDbType(row.document_type),
    bucketId: String(row.bucket_id ?? "").trim() || "service-records",
    storagePath: String(row.storage_path ?? "").trim(),
    displayName: String(row.display_name ?? "").trim() || undefined,
    createdAt: String(row.created_at ?? "").trim() || undefined,
  };
}

async function resolveAuthenticatedActor(
  client: SupabaseClient,
  req: Request,
): Promise<AuthenticatedActor | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData?.user?.id) return null;

  const authUser = authData.user;
  const userId = String(authUser.id ?? "").trim();
  if (!userId) return null;

  await ensurePublicUserRow(client, {
    id: userId,
    email: authUser.email ?? null,
    user_metadata: (authUser.user_metadata ?? null) as Record<string, unknown> | null,
  });

  const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  const { data: userRow, error: userError } = await client
    .from(USERS_TABLE)
    .select("id, full_name, role")
    .eq("id", userId)
    .maybeSingle<{ id: string; full_name?: string | null; role?: string | null }>();

  if (userError && !isMissingTableOrColumnError(userError)) {
    throw userError;
  }

  const role = normalizeUserRole(userRow?.role ?? metadata.role, { allowAdmin: true });
  const name =
    String(userRow?.full_name ?? metadata.full_name ?? metadata.name ?? authUser.email ?? "").trim() ||
    "User";

  return { userId, role, name };
}

function getRequestRawBody(req: Request): Buffer {
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody);
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

function normalizeSignature(
  value: string,
  configuredPrefix: string,
): string {
  let signature = String(value ?? "").trim();
  if (!signature) return "";

  const prefixes = [configuredPrefix, "sha256=", "hmac-sha256=", "sha-256="]
    .map((prefix) => String(prefix ?? "").trim())
    .filter(Boolean);

  for (const prefix of prefixes) {
    if (signature.toLowerCase().startsWith(prefix.toLowerCase())) {
      signature = signature.slice(prefix.length);
    }
  }

  return signature.trim();
}

function decodeCallbackSignature(value: string): Buffer | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  if (/^[a-f0-9]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      const asHex = Buffer.from(trimmed, "hex");
      if (asHex.length > 0) return asHex;
    } catch {
      // Continue to base64 parsing.
    }
  }

  const normalizedBase64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalizedBase64.length % 4;
  const paddedBase64 =
    remainder === 0 ? normalizedBase64 : normalizedBase64 + "=".repeat(4 - remainder);

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(paddedBase64)) {
    return null;
  }

  try {
    const asBase64 = Buffer.from(paddedBase64, "base64");
    return asBase64.length > 0 ? asBase64 : null;
  } catch {
    return null;
  }
}

function secureBufferEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readSignatureValues(req: Request): string[] {
  const configuredHeaders = String(process.env.SMILE_ID_CALLBACK_SIGNATURE_HEADER ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const headerNames = Array.from(
    new Set([
      ...configuredHeaders,
      "x-smile-signature",
      "x-smile-signature-hmac",
      "x-signature",
      "signature",
    ]),
  );

  const values: string[] = [];
  for (const name of headerNames) {
    const headerValue = req.headers[name];
    if (!headerValue) continue;
    if (Array.isArray(headerValue)) {
      for (const value of headerValue) {
        if (typeof value === "string" && value.trim()) {
          values.push(value.trim());
        }
      }
      continue;
    }
    if (typeof headerValue === "string" && headerValue.trim()) {
      values.push(headerValue.trim());
    }
  }

  return values;
}

function readHeaderFirstValue(req: Request, headerName: string): string {
  const normalizedName = String(headerName ?? "").trim().toLowerCase();
  if (!normalizedName) return "";

  const raw = req.headers[normalizedName];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }
  return typeof raw === "string" ? raw.trim() : "";
}

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

function verifySmileCallbackSidSignature(req: Request): boolean | null {
  const partnerId = String(process.env.SMILE_ID_PARTNER_ID ?? "").trim();
  const signatureApiKey = String(
    process.env.SMILE_ID_SIGNATURE_API_KEY ?? process.env.SMILE_ID_API_KEY ?? "",
  ).trim();
  if (!partnerId || !signatureApiKey) return null;

  const payload = toRecord(req.body) ?? {};
  const payloadData = toRecord(payload.data);
  const payloadResult = toRecord(payload.result);
  const headerSignatureValues = readSignatureValues(req);
  const configuredTimestampHeader = String(process.env.SMILE_ID_CALLBACK_TIMESTAMP_HEADER ?? "").trim();

  const receivedSignature = pickString(
    payload.signature,
    payload.sig,
    payloadData?.signature,
    payloadData?.sig,
    payloadResult?.signature,
    payloadResult?.sig,
    headerSignatureValues[0] ?? "",
  );

  const receivedTimestamp = pickString(
    payload.timestamp,
    payload.time_stamp,
    payload.timeStamp,
    payload.callback_timestamp,
    payload.callbackTimestamp,
    payloadData?.timestamp,
    payloadData?.time_stamp,
    payloadData?.timeStamp,
    payloadData?.callback_timestamp,
    payloadData?.callbackTimestamp,
    payloadResult?.timestamp,
    payloadResult?.time_stamp,
    payloadResult?.timeStamp,
    payloadResult?.callback_timestamp,
    payloadResult?.callbackTimestamp,
    configuredTimestampHeader ? readHeaderFirstValue(req, configuredTimestampHeader) : "",
    readHeaderFirstValue(req, "x-smile-timestamp"),
    readHeaderFirstValue(req, "x-timestamp"),
    readHeaderFirstValue(req, "timestamp"),
    readHeaderFirstValue(req, "date"),
  );

  if (!receivedSignature || !receivedTimestamp) return null;

  const maxSkewRaw = Number.parseInt(String(process.env.SMILE_ID_CALLBACK_MAX_SKEW_SEC ?? "900"), 10);
  const maxSkewSec = Number.isFinite(maxSkewRaw) ? Math.max(0, maxSkewRaw) : 900;
  if (maxSkewSec > 0) {
    const parsedTimestamp = Date.parse(receivedTimestamp);
    if (!Number.isFinite(parsedTimestamp)) return false;
    const skewMs = Math.abs(Date.now() - parsedTimestamp);
    if (skewMs > maxSkewSec * 1000) return false;
  }

  const providedDigest = decodeCallbackSignature(normalizeSignature(receivedSignature, ""));
  if (!providedDigest) return false;

  const expectedDigest = createHmac("sha256", signatureApiKey)
    .update(receivedTimestamp, "utf8")
    .update(partnerId, "utf8")
    .update("sid_request", "utf8")
    .digest();

  return secureBufferEqual(providedDigest, expectedDigest);
}

function verifySmileCallbackSignature(req: Request): boolean {
  const sidSignatureVerification = verifySmileCallbackSidSignature(req);
  if (sidSignatureVerification !== null) {
    return sidSignatureVerification;
  }

  const secret = String(process.env.SMILE_ID_CALLBACK_SECRET ?? "").trim();
  if (!secret) return false;

  const configuredPrefix = String(process.env.SMILE_ID_CALLBACK_SIGNATURE_PREFIX ?? "").trim();
  const signatureValues = readSignatureValues(req);
  if (signatureValues.length === 0) return false;

  const expectedDigest = createHmac("sha256", secret).update(getRequestRawBody(req)).digest();

  for (const signatureValue of signatureValues) {
    const normalized = normalizeSignature(signatureValue, configuredPrefix);
    const decoded = decodeCallbackSignature(normalized);
    if (!decoded) continue;
    if (secureBufferEqual(decoded, expectedDigest)) {
      return true;
    }
  }

  return false;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const payload = (req.body ?? {}) as Record<string, unknown>;
      const name = String(payload.name ?? "").trim();
      const email = normalizeEmail(payload.email);
      const password = String(payload.password ?? "");
      const role = normalizeUserRole(payload.role);
      const genderRaw = String(payload.gender ?? "").trim().toLowerCase();
      const gender = genderRaw === "male" || genderRaw === "female" ? genderRaw : "";

      if (!name) {
        return res.status(400).json({ message: "Name is required." });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "A valid email is required." });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      if (!gender) {
        return res.status(400).json({ message: "Gender must be Male or Female." });
      }

      const userMetadata: Record<string, unknown> = {
        full_name: name,
        role,
        gender,
      };

      const { data, error } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });

      if (error) {
        const message = String(error.message ?? "").trim();
        const lowered = message.toLowerCase();
        if (
          lowered.includes("already") ||
          lowered.includes("exists") ||
          lowered.includes("duplicate")
        ) {
          return res.status(200).json({
            created: false,
            alreadyExists: true,
            requiresEmailConfirmation: false,
          });
        }
        return res.status(502).json({ message: message || "Unable to create account." });
      }

      const createdUser = data.user;
      if (!createdUser?.id) {
        return res.status(502).json({ message: "Unable to create account." });
      }

      await ensurePublicUserRow(client, {
        id: createdUser.id,
        email: createdUser.email ?? email,
        user_metadata: (createdUser.user_metadata ?? userMetadata) as Record<string, unknown>,
      });

      return res.status(201).json({
        created: true,
        alreadyExists: false,
        requiresEmailConfirmation: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create account.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ message: "Missing bearer token." });
      }

      const profile = await buildAuthProfileFromToken(client, token);
      if (!profile) {
        return res.status(401).json({ message: "Invalid or expired session." });
      }

      return res.status(200).json(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load auth profile";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ message: "Missing bearer token." });
      }

      const { data: authData, error: authError } = await client.auth.getUser(token);
      if (authError || !authData?.user) {
        return res.status(401).json({ message: "Invalid or expired session." });
      }

      const authUser = authData.user;
      await ensurePublicUserRow(client, {
        id: authUser.id,
        email: authUser.email ?? null,
        user_metadata: (authUser.user_metadata ?? null) as Record<string, unknown> | null,
      });

      const fullNameRaw = (req.body as Record<string, unknown> | undefined)?.fullName;
      const avatarUrlRaw = (req.body as Record<string, unknown> | undefined)?.avatarUrl;
      const dateOfBirthRaw = (req.body as Record<string, unknown> | undefined)?.dateOfBirth;
      const homeAddressRaw = (req.body as Record<string, unknown> | undefined)?.homeAddress;
      const officeAddressRaw = (req.body as Record<string, unknown> | undefined)?.officeAddress;
      const baseUpdates: Record<string, unknown> = {};
      const verificationProfileUpdates: Record<string, unknown> = {};

      if (typeof fullNameRaw === "string") {
        const fullName = fullNameRaw.trim();
        baseUpdates.full_name = fullName.length > 0 ? fullName : null;
      }
      if (typeof avatarUrlRaw === "string") {
        const avatarUrl = avatarUrlRaw.trim();
        baseUpdates.avatar_url = avatarUrl.length > 0 ? avatarUrl : null;
      }
      if (typeof dateOfBirthRaw === "string") {
        const dateOfBirth = dateOfBirthRaw.trim();
        verificationProfileUpdates.date_of_birth = dateOfBirth.length > 0 ? dateOfBirth : null;
      }
      if (typeof homeAddressRaw === "string") {
        const homeAddress = homeAddressRaw.trim();
        verificationProfileUpdates.home_address = homeAddress.length > 0 ? homeAddress : null;
      }
      if (typeof officeAddressRaw === "string") {
        const officeAddress = officeAddressRaw.trim();
        verificationProfileUpdates.office_address = officeAddress.length > 0 ? officeAddress : null;
      }

      if (Object.keys(baseUpdates).length > 0) {
        const { error: baseUpdateError } = await client
          .from(USERS_TABLE)
          .update(baseUpdates)
          .eq("id", authUser.id);
        if (baseUpdateError && !isMissingTableOrColumnError(baseUpdateError)) {
          throw baseUpdateError;
        }
      }

      if (Object.keys(verificationProfileUpdates).length > 0) {
        const { error: verificationUpdateError } = await client
          .from(USERS_TABLE)
          .update(verificationProfileUpdates)
          .eq("id", authUser.id);
        if (verificationUpdateError && !isMissingTableOrColumnError(verificationUpdateError)) {
          throw verificationUpdateError;
        }
      }

      const profile = await buildAuthProfileFromToken(client, token);
      if (!profile) {
        return res.status(401).json({ message: "Invalid or expired session." });
      }
      return res.status(200).json(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update profile";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/agent-profiles/:userId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const targetUserId = String(req.params.userId ?? "").trim();
      if (!targetUserId) {
        return res.status(400).json({ message: "userId is required." });
      }

      if (authActor.role !== "admin" && authActor.userId !== targetUserId) {
        return res.status(403).json({ message: "userId does not match authenticated user." });
      }

      let fallbackDisplayName = authActor.userId === targetUserId ? authActor.name : "";
      if (!fallbackDisplayName) {
        const { data: userRow, error: userError } = await client
          .from(USERS_TABLE)
          .select("full_name")
          .eq("id", targetUserId)
          .maybeSingle<{ full_name?: string | null }>();
        if (userError && !isMissingTableOrColumnError(userError)) {
          throw userError;
        }
        fallbackDisplayName = String(userRow?.full_name ?? "").trim();
      }

      const profile = await getOrCreateAgentProfile(client, targetUserId, { fallbackDisplayName });
      return res.status(200).json(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load agent profile.";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/agent-profiles/:userId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const targetUserId = String(req.params.userId ?? "").trim();
      if (!targetUserId) {
        return res.status(400).json({ message: "userId is required." });
      }

      if (authActor.role !== "admin" && authActor.userId !== targetUserId) {
        return res.status(403).json({ message: "userId does not match authenticated user." });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = { user_id: targetUserId };
      let hasUpdates = false;

      if (typeof body.displayName === "string") {
        updates.display_name = body.displayName.trim() || null;
        hasUpdates = true;
      }
      if (typeof body.bio === "string") {
        updates.bio = body.bio.trim() || null;
        hasUpdates = true;
      }

      if (!hasUpdates) {
        return res.status(400).json({ message: "displayName or bio is required." });
      }

      const { data, error } = await client
        .from(AGENT_PROFILES_TABLE)
        .upsert(updates, { onConflict: "user_id" })
        .select(
          "user_id, display_name, bio, sales_rating, review_count, recent_deals_count, closed_deals_count, created_at, updated_at",
        )
        .maybeSingle<AgentProfileRow>();

      if (error && !isMissingTableOrColumnError(error)) {
        throw error;
      }

      const fallbackDisplayName =
        typeof updates.display_name === "string" ? String(updates.display_name).trim() : authActor.name;

      if (data) {
        return res.status(200).json(mapAgentProfileRow(data, { fallbackDisplayName }));
      }

      const profile = await getOrCreateAgentProfile(client, targetUserId, { fallbackDisplayName });
      return res.status(200).json(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update agent profile.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/agent/listings", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const requestedActorId = String(req.query?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }

      const rows = await listAgentListings({
        actorId: authActor.userId,
        actorRole: authActor.role,
        actorName: authActor.name,
      });

      return res.status(200).json(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load listings";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.post("/api/agent/listings", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }

      const title = String(req.body?.title ?? "").trim();
      const listingType = String(req.body?.listingType ?? "").trim();
      const location = String(req.body?.location ?? "").trim();
      const description = String(req.body?.description ?? "").trim();
      const status = String(req.body?.status ?? "Pending Review").trim() as AgentListingStatus;
      const priceRaw = req.body?.price;
      const price = Number(String(priceRaw ?? "").replace(/[^\d.]/g, ""));
      const allowedStatuses: AgentListingStatus[] = [
        "Draft",
        "Pending Review",
        "Published",
        "Archived",
        "Sold",
        "Rented",
      ];

      if (!title || !location) {
        return res.status(400).json({ message: "title and location are required" });
      }

      if (listingType !== "Sale" && listingType !== "Rent") {
        return res.status(400).json({ message: "listingType must be either Sale or Rent" });
      }

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ message: "price must be a positive number" });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: Draft, Pending Review, Published, Archived, Sold, Rented",
        });
      }

      const created = await createAgentListing(
        {
          title,
          listingType,
          location,
          description,
          price,
          status,
        },
        {
          actorId: authActor.userId,
          actorRole: authActor.role,
          actorName: authActor.name,
        },
      );

      return res.status(201).json(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create listing";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.post("/api/agent/listings/:listingId/assets", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase storage is not configured on server." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingId = String(req.params?.listingId ?? "").trim();
      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }
      const actorId = authActor.userId;
      const actorRole = authActor.role;
      const actorName = authActor.name;

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      type UploadFilePayload = {
        fileName: string;
        contentBase64: string;
        mimeType: string;
        fileSizeBytes?: number;
      };

      const toUploadFiles = (value: unknown): UploadFilePayload[] => {
        if (!Array.isArray(value)) return [];
        const files: UploadFilePayload[] = [];
        for (const item of value) {
          if (typeof item !== "object" || item === null) continue;
          const payload = item as Record<string, unknown>;
          const fileName = String(payload.fileName ?? "").trim();
          const contentBase64 = String(payload.contentBase64 ?? "").trim();
          const mimeType = String(payload.mimeType ?? "").trim() || "application/octet-stream";
          const fileSizeBytes =
            typeof payload.fileSizeBytes === "number" && Number.isFinite(payload.fileSizeBytes)
              ? Math.max(0, Math.trunc(payload.fileSizeBytes))
              : undefined;

          if (!fileName || !contentBase64) continue;
          files.push({
            fileName,
            contentBase64,
            mimeType,
            fileSizeBytes,
          });
        }
        return files;
      };

      const propertyDocuments = toUploadFiles(req.body?.propertyDocuments);
      const ownershipAuthorizationDocuments = toUploadFiles(req.body?.ownershipAuthorizationDocuments);
      const images = toUploadFiles(req.body?.images);

      if (
        propertyDocuments.length === 0 &&
        ownershipAuthorizationDocuments.length === 0 &&
        images.length === 0
      ) {
        return res.status(400).json({ message: "At least one asset file is required." });
      }

      if (images.length > 10) {
        return res.status(400).json({ message: "You can upload at most 10 property images." });
      }

      const { data: listingRow, error: listingError } = await client
        .from(LISTINGS_TABLE)
        .select("id, agent_id")
        .eq("id", listingId)
        .maybeSingle<{ id: string; agent_id: string | null }>();

      if (listingError && isMissingTableOrColumnError(listingError)) {
        return res.status(503).json({
          message:
            "Listings table is not fully configured. Run supabase/agent_roles_listings_storage.sql and retry.",
        });
      }
      if (listingError && !isMissingTableOrColumnError(listingError)) {
        return res.status(502).json({ message: `Failed to load listing: ${listingError.message}` });
      }
      if (!listingRow) {
        return res.status(404).json({ message: "Listing not found." });
      }

      let isAdmin = actorRole === "admin";
      if (!isAdmin) {
        const { data: actorRow, error: actorError } = await client
          .from(USERS_TABLE)
          .select("role")
          .eq("id", actorId)
          .maybeSingle<{ role: string | null }>();
        if (actorError && !isMissingTableOrColumnError(actorError)) {
          return res.status(502).json({ message: `Failed to verify actor role: ${actorError.message}` });
        }
        const roleFromDb = String(actorRow?.role ?? "").trim().toLowerCase();
        isAdmin = roleFromDb === "admin";
      }

      if (!isAdmin && String(listingRow.agent_id ?? "").trim() !== actorId) {
        return res.status(403).json({ message: "You can only upload files for your own listing." });
      }

      if (actorName || actorRole) {
        await ensurePublicUserRow(client, {
          id: actorId,
          email: null,
          user_metadata: {
            role: actorRole || undefined,
            full_name: actorName || undefined,
          },
        });
      }

      const decodeBase64File = (content: string): Buffer => {
        const normalized = content.includes(",") ? content.split(",").pop() ?? "" : content;
        return Buffer.from(normalized, "base64");
      };

      const uploadDocumentSet = async (
        files: UploadFilePayload[],
        documentType: "title_document" | "ownership_authorization",
      ): Promise<number> => {
        let uploadedCount = 0;
        for (const file of files) {
          const safeName = sanitizeStorageFileName(file.fileName);
          const storagePath = `listings/${listingId}/documents/${Date.now()}-${randomUUID()}-${safeName}`;
          const fileBuffer = decodeBase64File(file.contentBase64);

          if (fileBuffer.length === 0) {
            throw new Error(`File "${file.fileName}" is empty.`);
          }
          if (fileBuffer.length > 20 * 1024 * 1024) {
            throw new Error(`File "${file.fileName}" exceeds the 20MB upload limit.`);
          }

          const { error: uploadError } = await client.storage.from(PROPERTY_DOCUMENTS_BUCKET).upload(
            storagePath,
            fileBuffer,
            {
              contentType: file.mimeType,
              upsert: false,
            },
          );
          if (uploadError) {
            throw new Error(`Failed to upload "${file.fileName}": ${uploadError.message}`);
          }

          const publicUrlData = client.storage.from(PROPERTY_DOCUMENTS_BUCKET).getPublicUrl(storagePath).data;
          const { error: insertError } = await client.from(LISTING_DOCUMENTS_TABLE).insert({
            listing_id: listingId,
            document_type: documentType,
            file_path: storagePath,
            public_url: String(publicUrlData?.publicUrl ?? "").trim() || null,
            uploaded_by: actorId,
          });

          if (insertError) {
            throw new Error(`Failed to save document metadata: ${insertError.message}`);
          }
          uploadedCount += 1;
        }
        return uploadedCount;
      };

      const existingImageCountResponse = await client
        .from(LISTING_IMAGES_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("listing_id", listingId);
      if (existingImageCountResponse.error && !isMissingTableOrColumnError(existingImageCountResponse.error)) {
        return res.status(502).json({
          message: `Failed to read existing listing image metadata: ${existingImageCountResponse.error.message}`,
        });
      }
      const existingImageCount = Number(existingImageCountResponse.count ?? 0);

      let imagesUploaded = 0;
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const safeName = sanitizeStorageFileName(image.fileName);
        const storagePath = `listings/${listingId}/images/${Date.now()}-${randomUUID()}-${safeName}`;
        const fileBuffer = decodeBase64File(image.contentBase64);

        if (fileBuffer.length === 0) {
          throw new Error(`File "${image.fileName}" is empty.`);
        }
        if (fileBuffer.length > 20 * 1024 * 1024) {
          throw new Error(`File "${image.fileName}" exceeds the 20MB upload limit.`);
        }

        const { error: uploadError } = await client.storage.from(PROPERTY_IMAGES_BUCKET).upload(
          storagePath,
          fileBuffer,
          {
            contentType: image.mimeType,
            upsert: false,
          },
        );
        if (uploadError) {
          throw new Error(`Failed to upload "${image.fileName}": ${uploadError.message}`);
        }

        const publicUrlData = client.storage.from(PROPERTY_IMAGES_BUCKET).getPublicUrl(storagePath).data;
        const { error: insertError } = await client.from(LISTING_IMAGES_TABLE).insert({
          listing_id: listingId,
          file_path: storagePath,
          public_url: String(publicUrlData?.publicUrl ?? "").trim() || null,
          is_cover: existingImageCount === 0 && index === 0,
          sort_order: existingImageCount + index,
          uploaded_by: actorId,
        });

        if (insertError) {
          throw new Error(`Failed to save image metadata: ${insertError.message}`);
        }
        imagesUploaded += 1;
      }

      const propertyDocumentsUploaded = await uploadDocumentSet(propertyDocuments, "title_document");
      const ownershipAuthorizationUploaded = await uploadDocumentSet(
        ownershipAuthorizationDocuments,
        "ownership_authorization",
      );

      return res.status(200).json({
        listingId,
        propertyDocumentsUploaded,
        ownershipAuthorizationUploaded,
        imagesUploaded,
      });
    } catch (error) {
      if (isMissingTableOrColumnError(error)) {
        return res.status(503).json({
          message:
            "Listing upload metadata is not fully configured. Run supabase/agent_roles_listings_storage.sql and ensure storage buckets exist.",
        });
      }
      const message = error instanceof Error ? error.message : "Failed to upload listing assets";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/agent/listings/:listingId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingId = String(req.params?.listingId ?? "").trim();
      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }
      const title = String(req.body?.title ?? "").trim();
      const listingType = String(req.body?.listingType ?? "").trim();
      const location = String(req.body?.location ?? "").trim();
      const description = String(req.body?.description ?? "").trim();
      const status = String(req.body?.status ?? "Draft").trim() as AgentListingStatus;
      const priceRaw = req.body?.price;
      const price = Number(String(priceRaw ?? "").replace(/[^\d.]/g, ""));
      const allowedStatuses: AgentListingStatus[] = [
        "Draft",
        "Pending Review",
        "Published",
        "Archived",
        "Sold",
        "Rented",
      ];

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      if (!title || !location) {
        return res.status(400).json({ message: "title and location are required" });
      }

      if (listingType !== "Sale" && listingType !== "Rent") {
        return res.status(400).json({ message: "listingType must be either Sale or Rent" });
      }

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ message: "price must be a positive number" });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: Draft, Pending Review, Published, Archived, Sold, Rented",
        });
      }

      const updated = await updateAgentListing(
        listingId,
        {
          title,
          listingType,
          location,
          description,
          price,
          status,
        },
        {
          actorId: authActor.userId,
          actorRole: authActor.role,
          actorName: authActor.name,
        },
      );

      return res.status(200).json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update listing";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.delete("/api/agent/listings/:listingId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingId = String(req.params?.listingId ?? "").trim();
      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      const result = await deleteAgentListing(listingId, {
        actorId: authActor.userId,
        actorRole: authActor.role,
        actorName: authActor.name,
      });

      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete listing";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/agent/listings/:listingId/status", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingId = String(req.params?.listingId ?? "").trim();
      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }
      const status = String(req.body?.status ?? "").trim() as AgentListingStatus;
      const allowedStatuses: AgentListingStatus[] = [
        "Draft",
        "Pending Review",
        "Published",
        "Archived",
        "Sold",
        "Rented",
      ];

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: Draft, Pending Review, Published, Archived, Sold, Rented",
        });
      }

      const updated = await updateAgentListingStatus(listingId, status, {
        actorId: authActor.userId,
        actorRole: authActor.role,
        actorName: authActor.name,
      });

      return res.status(200).json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update listing status";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/agent/listings/:listingId/verification-steps/:stepKey", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingId = String(req.params?.listingId ?? "").trim();
      const stepKey = String(req.params?.stepKey ?? "").trim();
      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }

      const status = String(req.body?.status ?? "").trim() as AgentListingVerificationStepStatus;
      const allowedStatuses: AgentListingVerificationStepStatus[] = [
        "pending",
        "in_progress",
        "completed",
        "blocked",
      ];

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }
      if (!stepKey) {
        return res.status(400).json({ message: "stepKey is required" });
      }
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: pending, in_progress, completed, blocked",
        });
      }

      const updated = await updateListingVerificationStepStatus(listingId, stepKey, status, {
        actorId: authActor.userId,
        actorRole: authActor.role,
        actorName: authActor.name,
      });

      return res.status(200).json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update verification step";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      if (message.toLowerCase().includes("not configured")) {
        return res.status(503).json({ message });
      }
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/agent/listings/:listingId/payout", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingId = String(req.params?.listingId ?? "").trim();
      const requestedActorId = String(req.body?.actorId ?? "").trim();
      if (requestedActorId && requestedActorId !== authActor.userId) {
        return res.status(403).json({ message: "actorId does not match authenticated user." });
      }
      const payoutStatus = String(req.body?.payoutStatus ?? "").trim() as AgentPayoutStatus;
      const allowedStatuses: AgentPayoutStatus[] = ["Pending", "Paid"];

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      if (!allowedStatuses.includes(payoutStatus)) {
        return res.status(400).json({ message: "payoutStatus must be one of: Pending, Paid" });
      }
      if (authActor.role !== "admin") {
        return res.status(403).json({ message: "Only admins can update payout status." });
      }

      const updated = await updateAgentListingPayoutStatus(listingId, payoutStatus, {
        actorId: authActor.userId,
        actorRole: authActor.role,
        actorName: authActor.name,
      });

      return res.status(200).json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update payout status";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.get("/api/utility-bills", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUseUtilityBills(authActor.role)) {
        return res.status(403).json({ message: "Only owner/renter/admin can access utility bills." });
      }

      const listingIdFilter = String(req.query?.listingId ?? "").trim();
      const statusFilterRaw = String(req.query?.status ?? "").trim();
      const ownerUserIdFilter = String(req.query?.ownerUserId ?? "").trim();
      const renterUserIdFilter = String(req.query?.renterUserId ?? "").trim();
      const statusFilter = statusFilterRaw ? toUtilityBillDbStatus(statusFilterRaw) : "";

      let query = client
        .from(UTILITY_BILLS_TABLE)
        .select(
          "id, listing_id, owner_user_id, renter_user_id, bill_type, amount, billing_period_start, billing_period_end, due_date, status, notes, created_at, updated_at",
        )
        .order("due_date", { ascending: true })
        .order("created_at", { ascending: false });

      if (authActor.role === "admin") {
        if (listingIdFilter) query = query.eq("listing_id", listingIdFilter);
        if (statusFilter) query = query.eq("status", statusFilter);
        if (ownerUserIdFilter) query = query.eq("owner_user_id", ownerUserIdFilter);
        if (renterUserIdFilter) query = query.eq("renter_user_id", renterUserIdFilter);
      } else {
        query = query.or(`owner_user_id.eq.${authActor.userId},renter_user_id.eq.${authActor.userId}`);
        if (listingIdFilter) query = query.eq("listing_id", listingIdFilter);
        if (statusFilter) query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return res.status(503).json({
            message:
              "Utility bills schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw error;
      }

      const rows = (Array.isArray(data) ? data : []) as UtilityBillRow[];
      const visibleRows =
        authActor.role === "admin" ? rows : rows.filter((row) => canAccessUtilityBillRow(authActor, row));
      return res.status(200).json(visibleRows.map((row) => mapUtilityBillRow(row)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load utility bills.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/utility-bills", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUseUtilityBills(authActor.role)) {
        return res.status(403).json({ message: "Only owner/renter/admin can create utility bills." });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const listingId = String(body.listingId ?? "").trim() || null;
      const billType = toUtilityBillDbType(body.billType);
      const amount = Number(body.amount);
      const billingPeriodStart = String(body.billingPeriodStart ?? "").trim() || null;
      const billingPeriodEnd = String(body.billingPeriodEnd ?? "").trim() || null;
      const dueDate = String(body.dueDate ?? "").trim() || null;
      const notes = String(body.notes ?? "").trim() || null;

      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ message: "amount must be a non-negative number." });
      }

      const ownerUserIdInput = String(body.ownerUserId ?? "").trim();
      const renterUserIdInput = String(body.renterUserId ?? "").trim();
      let ownerUserId: string | null = null;
      let renterUserId: string | null = null;

      if (authActor.role === "admin") {
        ownerUserId = ownerUserIdInput || null;
        renterUserId = renterUserIdInput || null;
      } else if (authActor.role === "owner") {
        ownerUserId = authActor.userId;
        renterUserId = renterUserIdInput || null;
      } else {
        renterUserId = authActor.userId;
        ownerUserId = ownerUserIdInput || null;
      }

      if (!ownerUserId && !renterUserId) {
        return res.status(400).json({ message: "ownerUserId or renterUserId is required." });
      }

      const status =
        authActor.role === "admin" ? toUtilityBillDbStatus(body.status) : ("pending" as UtilityBillDbStatus);

      const { data, error } = await client
        .from(UTILITY_BILLS_TABLE)
        .insert({
          listing_id: listingId,
          owner_user_id: ownerUserId,
          renter_user_id: renterUserId,
          bill_type: billType,
          amount,
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
          due_date: dueDate,
          status,
          notes,
        })
        .select(
          "id, listing_id, owner_user_id, renter_user_id, bill_type, amount, billing_period_start, billing_period_end, due_date, status, notes, created_at, updated_at",
        )
        .maybeSingle<UtilityBillRow>();

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return res.status(503).json({
            message:
              "Utility bills schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw error;
      }
      if (!data) {
        return res.status(502).json({ message: "Failed to create utility bill." });
      }

      return res.status(201).json(mapUtilityBillRow(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create utility bill.";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/utility-bills/:billId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUseUtilityBills(authActor.role)) {
        return res.status(403).json({ message: "Only owner/renter/admin can update utility bills." });
      }

      const billId = String(req.params.billId ?? "").trim();
      if (!billId) {
        return res.status(400).json({ message: "billId is required." });
      }

      const { data: existing, error: existingError } = await client
        .from(UTILITY_BILLS_TABLE)
        .select(
          "id, listing_id, owner_user_id, renter_user_id, bill_type, amount, billing_period_start, billing_period_end, due_date, status, notes, created_at, updated_at",
        )
        .eq("id", billId)
        .maybeSingle<UtilityBillRow>();

      if (existingError) {
        if (isMissingTableOrColumnError(existingError)) {
          return res.status(503).json({
            message:
              "Utility bills schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw existingError;
      }
      if (!existing) {
        return res.status(404).json({ message: "Utility bill not found." });
      }
      if (!canAccessUtilityBillRow(authActor, existing)) {
        return res.status(403).json({ message: "You cannot update this utility bill." });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};

      if (typeof body.status === "string") {
        updates.status = toUtilityBillDbStatus(body.status);
      }
      if (body.amount !== undefined) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return res.status(400).json({ message: "amount must be a non-negative number." });
        }
        updates.amount = amount;
      }
      if (typeof body.billType === "string") {
        updates.bill_type = toUtilityBillDbType(body.billType);
      }
      if (typeof body.billingPeriodStart === "string") {
        updates.billing_period_start = body.billingPeriodStart.trim() || null;
      }
      if (typeof body.billingPeriodEnd === "string") {
        updates.billing_period_end = body.billingPeriodEnd.trim() || null;
      }
      if (typeof body.dueDate === "string") {
        updates.due_date = body.dueDate.trim() || null;
      }
      if (typeof body.notes === "string") {
        updates.notes = body.notes.trim() || null;
      }

      if (authActor.role === "renter") {
        const disallowed = Object.keys(updates).filter((key) => key !== "status" && key !== "notes");
        if (disallowed.length > 0) {
          return res.status(403).json({
            message: "Renters can only update bill status or notes.",
          });
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(200).json(mapUtilityBillRow(existing));
      }

      const { data, error } = await client
        .from(UTILITY_BILLS_TABLE)
        .update(updates)
        .eq("id", billId)
        .select(
          "id, listing_id, owner_user_id, renter_user_id, bill_type, amount, billing_period_start, billing_period_end, due_date, status, notes, created_at, updated_at",
        )
        .maybeSingle<UtilityBillRow>();

      if (error) {
        throw error;
      }
      if (!data) {
        return res.status(502).json({ message: "Failed to update utility bill." });
      }

      return res.status(200).json(mapUtilityBillRow(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update utility bill.";
      return res.status(502).json({ message });
    }
  });

  app.delete("/api/utility-bills/:billId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUseUtilityBills(authActor.role)) {
        return res.status(403).json({ message: "Only owner/renter/admin can delete utility bills." });
      }

      const billId = String(req.params.billId ?? "").trim();
      if (!billId) {
        return res.status(400).json({ message: "billId is required." });
      }

      const { data: existing, error: existingError } = await client
        .from(UTILITY_BILLS_TABLE)
        .select("id, owner_user_id, renter_user_id")
        .eq("id", billId)
        .maybeSingle<UtilityBillRow>();

      if (existingError) {
        throw existingError;
      }
      if (!existing) {
        return res.status(404).json({ message: "Utility bill not found." });
      }
      if (!canAccessUtilityBillRow(authActor, existing)) {
        return res.status(403).json({ message: "You cannot delete this utility bill." });
      }
      if (authActor.role === "renter") {
        return res.status(403).json({ message: "Renters cannot delete utility bills." });
      }

      const { error } = await client.from(UTILITY_BILLS_TABLE).delete().eq("id", billId);
      if (error) {
        throw error;
      }

      return res.status(200).json({ ok: true, billId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete utility bill.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/property-expenses", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUsePropertyExpenses(authActor.role)) {
        return res.status(403).json({ message: "Only owner/admin can access property expenses." });
      }

      const listingIdFilter = String(req.query?.listingId ?? "").trim();
      const categoryFilterRaw = String(req.query?.category ?? "").trim();
      const ownerUserIdFilter = String(req.query?.ownerUserId ?? "").trim();
      const fromDate = String(req.query?.fromDate ?? "").trim();
      const toDate = String(req.query?.toDate ?? "").trim();
      const categoryFilter = categoryFilterRaw ? toPropertyExpenseDbCategory(categoryFilterRaw) : "";

      let query = client
        .from(PROPERTY_EXPENSES_TABLE)
        .select("id, listing_id, owner_user_id, category, amount, expense_date, notes, created_at, updated_at")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (authActor.role === "admin") {
        if (listingIdFilter) query = query.eq("listing_id", listingIdFilter);
        if (categoryFilter) query = query.eq("category", categoryFilter);
        if (ownerUserIdFilter) query = query.eq("owner_user_id", ownerUserIdFilter);
      } else {
        query = query.eq("owner_user_id", authActor.userId);
        if (listingIdFilter) query = query.eq("listing_id", listingIdFilter);
        if (categoryFilter) query = query.eq("category", categoryFilter);
      }
      if (fromDate) query = query.gte("expense_date", fromDate);
      if (toDate) query = query.lte("expense_date", toDate);

      const { data, error } = await query;
      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return res.status(503).json({
            message:
              "Property expenses schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw error;
      }

      const rows = (Array.isArray(data) ? data : []) as PropertyExpenseRow[];
      const visibleRows =
        authActor.role === "admin"
          ? rows
          : rows.filter((row) => canAccessPropertyExpenseRow(authActor, row));
      return res.status(200).json(visibleRows.map((row) => mapPropertyExpenseRow(row)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load property expenses.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/property-expenses", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUsePropertyExpenses(authActor.role)) {
        return res.status(403).json({ message: "Only owner/admin can create property expenses." });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const listingId = String(body.listingId ?? "").trim() || null;
      const category = toPropertyExpenseDbCategory(body.category);
      const amount = Number(body.amount);
      const expenseDate = String(body.expenseDate ?? "").trim() || new Date().toISOString().slice(0, 10);
      const notes = String(body.notes ?? "").trim() || null;

      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ message: "amount must be a non-negative number." });
      }

      const ownerUserIdInput = String(body.ownerUserId ?? "").trim();
      const ownerUserId =
        authActor.role === "admin" ? ownerUserIdInput || null : authActor.userId;
      if (!ownerUserId) {
        return res.status(400).json({ message: "ownerUserId is required." });
      }

      const { data, error } = await client
        .from(PROPERTY_EXPENSES_TABLE)
        .insert({
          listing_id: listingId,
          owner_user_id: ownerUserId,
          category,
          amount,
          expense_date: expenseDate,
          notes,
        })
        .select("id, listing_id, owner_user_id, category, amount, expense_date, notes, created_at, updated_at")
        .maybeSingle<PropertyExpenseRow>();

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return res.status(503).json({
            message:
              "Property expenses schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw error;
      }
      if (!data) {
        return res.status(502).json({ message: "Failed to create property expense." });
      }

      return res.status(201).json(mapPropertyExpenseRow(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create property expense.";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/property-expenses/:expenseId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUsePropertyExpenses(authActor.role)) {
        return res.status(403).json({ message: "Only owner/admin can update property expenses." });
      }

      const expenseId = String(req.params.expenseId ?? "").trim();
      if (!expenseId) {
        return res.status(400).json({ message: "expenseId is required." });
      }

      const { data: existing, error: existingError } = await client
        .from(PROPERTY_EXPENSES_TABLE)
        .select("id, listing_id, owner_user_id, category, amount, expense_date, notes, created_at, updated_at")
        .eq("id", expenseId)
        .maybeSingle<PropertyExpenseRow>();

      if (existingError) {
        throw existingError;
      }
      if (!existing) {
        return res.status(404).json({ message: "Property expense not found." });
      }
      if (!canAccessPropertyExpenseRow(authActor, existing)) {
        return res.status(403).json({ message: "You cannot update this property expense." });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      if (typeof body.category === "string") {
        updates.category = toPropertyExpenseDbCategory(body.category);
      }
      if (body.amount !== undefined) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return res.status(400).json({ message: "amount must be a non-negative number." });
        }
        updates.amount = amount;
      }
      if (typeof body.expenseDate === "string") {
        updates.expense_date = body.expenseDate.trim() || null;
      }
      if (typeof body.notes === "string") {
        updates.notes = body.notes.trim() || null;
      }
      if (typeof body.listingId === "string") {
        updates.listing_id = body.listingId.trim() || null;
      }
      if (authActor.role === "admin" && typeof body.ownerUserId === "string") {
        updates.owner_user_id = body.ownerUserId.trim() || null;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(200).json(mapPropertyExpenseRow(existing));
      }

      const { data, error } = await client
        .from(PROPERTY_EXPENSES_TABLE)
        .update(updates)
        .eq("id", expenseId)
        .select("id, listing_id, owner_user_id, category, amount, expense_date, notes, created_at, updated_at")
        .maybeSingle<PropertyExpenseRow>();

      if (error) {
        throw error;
      }
      if (!data) {
        return res.status(502).json({ message: "Failed to update property expense." });
      }

      return res.status(200).json(mapPropertyExpenseRow(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update property expense.";
      return res.status(502).json({ message });
    }
  });

  app.delete("/api/property-expenses/:expenseId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }
      if (!canUsePropertyExpenses(authActor.role)) {
        return res.status(403).json({ message: "Only owner/admin can delete property expenses." });
      }

      const expenseId = String(req.params.expenseId ?? "").trim();
      if (!expenseId) {
        return res.status(400).json({ message: "expenseId is required." });
      }

      const { data: existing, error: existingError } = await client
        .from(PROPERTY_EXPENSES_TABLE)
        .select("id, owner_user_id")
        .eq("id", expenseId)
        .maybeSingle<PropertyExpenseRow>();

      if (existingError) {
        throw existingError;
      }
      if (!existing) {
        return res.status(404).json({ message: "Property expense not found." });
      }
      if (!canAccessPropertyExpenseRow(authActor, existing)) {
        return res.status(403).json({ message: "You cannot delete this property expense." });
      }

      const { error } = await client.from(PROPERTY_EXPENSES_TABLE).delete().eq("id", expenseId);
      if (error) {
        throw error;
      }

      return res.status(200).json({ ok: true, expenseId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete property expense.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/user-documents", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const listingIdFilter = String(req.query?.listingId ?? "").trim();
      const conversationIdFilter = String(req.query?.conversationId ?? "").trim();
      const userIdFilter = String(req.query?.userId ?? "").trim();
      const documentTypeFilterRaw = String(req.query?.documentType ?? "").trim();
      const documentTypeFilter = documentTypeFilterRaw ? toUserDocumentDbType(documentTypeFilterRaw) : "";

      let query = client
        .from(USER_DOCUMENT_RECORDS_TABLE)
        .select(
          "id, listing_id, conversation_id, owner_user_id, renter_user_id, buyer_user_id, seller_user_id, agent_user_id, document_type, bucket_id, storage_path, display_name, created_at",
        )
        .order("created_at", { ascending: false });

      if (listingIdFilter) query = query.eq("listing_id", listingIdFilter);
      if (conversationIdFilter) query = query.eq("conversation_id", conversationIdFilter);
      if (documentTypeFilter) query = query.eq("document_type", documentTypeFilter);

      if (authActor.role !== "admin") {
        query = query.or(
          `owner_user_id.eq.${authActor.userId},renter_user_id.eq.${authActor.userId},buyer_user_id.eq.${authActor.userId},seller_user_id.eq.${authActor.userId},agent_user_id.eq.${authActor.userId}`,
        );
      }

      const { data, error } = await query;
      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return res.status(503).json({
            message:
              "User document records schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw error;
      }

      let rows = (Array.isArray(data) ? data : []) as UserDocumentRow[];
      if (authActor.role !== "admin") {
        rows = rows.filter((row) => canAccessUserDocumentRow(authActor, row));
      }

      if (userIdFilter) {
        if (authActor.role !== "admin" && userIdFilter !== authActor.userId) {
          return res.status(403).json({ message: "userId does not match authenticated user." });
        }
        rows = rows.filter((row) => {
          const participantIds = [
            String(row.owner_user_id ?? "").trim(),
            String(row.renter_user_id ?? "").trim(),
            String(row.buyer_user_id ?? "").trim(),
            String(row.seller_user_id ?? "").trim(),
            String(row.agent_user_id ?? "").trim(),
          ].filter(Boolean);
          return participantIds.includes(userIdFilter);
        });
      }

      return res.status(200).json(rows.map((row) => mapUserDocumentRow(row)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load user documents.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/user-documents", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const listingId = String(body.listingId ?? "").trim() || null;
      const conversationId = String(body.conversationId ?? "").trim() || null;
      const documentType = toUserDocumentDbType(body.documentType);
      const bucketId = String(body.bucketId ?? "").trim() || "service-records";
      const storagePath = String(body.storagePath ?? "").trim();
      const displayName = String(body.displayName ?? "").trim() || null;

      if (!storagePath) {
        return res.status(400).json({ message: "storagePath is required." });
      }

      const rolePayload = applyActorDocumentRole(authActor, {
        ownerUserId: String(body.ownerUserId ?? "").trim() || null,
        renterUserId: String(body.renterUserId ?? "").trim() || null,
        buyerUserId: String(body.buyerUserId ?? "").trim() || null,
        sellerUserId: String(body.sellerUserId ?? "").trim() || null,
        agentUserId: String(body.agentUserId ?? "").trim() || null,
      });

      const participants = [
        rolePayload.ownerUserId,
        rolePayload.renterUserId,
        rolePayload.buyerUserId,
        rolePayload.sellerUserId,
        rolePayload.agentUserId,
      ].filter((value) => Boolean(String(value ?? "").trim()));

      if (participants.length === 0) {
        return res.status(400).json({ message: "At least one participant user id is required." });
      }

      const { data, error } = await client
        .from(USER_DOCUMENT_RECORDS_TABLE)
        .insert({
          listing_id: listingId,
          conversation_id: conversationId,
          owner_user_id: rolePayload.ownerUserId ?? null,
          renter_user_id: rolePayload.renterUserId ?? null,
          buyer_user_id: rolePayload.buyerUserId ?? null,
          seller_user_id: rolePayload.sellerUserId ?? null,
          agent_user_id: rolePayload.agentUserId ?? null,
          document_type: documentType,
          bucket_id: bucketId,
          storage_path: storagePath,
          display_name: displayName,
        })
        .select(
          "id, listing_id, conversation_id, owner_user_id, renter_user_id, buyer_user_id, seller_user_id, agent_user_id, document_type, bucket_id, storage_path, display_name, created_at",
        )
        .maybeSingle<UserDocumentRow>();

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return res.status(503).json({
            message:
              "User document records schema is not configured yet. Run supabase/agent_roles_listings_storage.sql.",
          });
        }
        throw error;
      }
      if (!data) {
        return res.status(502).json({ message: "Failed to create user document record." });
      }

      return res.status(201).json(mapUserDocumentRow(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create user document record.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/admin/dashboard", async (_req: Request, res: Response) => {
    try {
      const data = await getAdminDashboardData();
      return res.status(200).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load admin dashboard";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/hiring/applications", async (req: Request, res: Response) => {
    try {
      const fullName = String(req.body?.fullName ?? "").trim();
      const email = String(req.body?.email ?? "").trim();
      const phone = String(req.body?.phone ?? "").trim();
      const location = String(req.body?.location ?? "").trim();
      const serviceTrack = String(req.body?.serviceTrack ?? "").trim();
      const yearsExperience = Number.parseInt(String(req.body?.yearsExperience ?? "0"), 10) || 0;
      const licenseId = String(req.body?.licenseId ?? "").trim();
      const portfolioUrl = String(req.body?.portfolioUrl ?? "").trim();
      const summary = String(req.body?.summary ?? "").trim();
      const applicantUserId = String(req.body?.applicantUserId ?? "").trim();
      const consentedToChecks = Boolean(req.body?.consentedToChecks);
      const documentsRaw = (req.body as Record<string, unknown> | undefined)?.documents;
      const documents: Array<{
        fileName: string;
        mimeType?: string;
        fileSizeBytes?: number;
        contentBase64: string;
      }> = [];

      if (Array.isArray(documentsRaw)) {
        for (const item of documentsRaw) {
          if (typeof item !== "object" || item === null) continue;
          const payload = item as Record<string, unknown>;
          documents.push({
            fileName: String(payload.fileName ?? "").trim(),
            mimeType: String(payload.mimeType ?? "").trim() || undefined,
            fileSizeBytes:
              typeof payload.fileSizeBytes === "number" && Number.isFinite(payload.fileSizeBytes)
                ? Math.max(0, Math.trunc(payload.fileSizeBytes))
                : undefined,
            contentBase64: String(payload.contentBase64 ?? "").trim(),
          });
        }
      }

      const saved = await createHiringApplication({
        fullName,
        email,
        phone,
        location,
        serviceTrack: serviceTrack as
          | "land_surveying"
          | "real_estate_valuation"
          | "land_verification"
          | "snagging",
        yearsExperience,
        licenseId,
        portfolioUrl: portfolioUrl || undefined,
        summary,
        applicantUserId: applicantUserId || undefined,
        consentedToChecks,
        documents,
      });

      return res.status(201).json(saved);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit hiring application";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/admin/hiring-applications", async (req: Request, res: Response) => {
    try {
      const actorRole = String(req.query?.actorRole ?? "")
        .trim()
        .toLowerCase();

      if (actorRole !== "admin") {
        return res.status(403).json({ message: "Only admins can view hiring applications." });
      }

      const rows = await listHiringApplications();
      return res.status(200).json(rows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load hiring applications";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/admin/hiring-applications/:id/status", async (req: Request, res: Response) => {
    try {
      const id = String(req.params?.id ?? "").trim();
      const status = String(req.body?.status ?? "")
        .trim()
        .toLowerCase();
      const reviewerNotes = String(req.body?.reviewerNotes ?? "").trim();
      const reviewerId = String(req.body?.reviewerId ?? "").trim();
      const reviewerName = String(req.body?.reviewerName ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "")
        .trim()
        .toLowerCase();

      if (!id) {
        return res.status(400).json({ message: "application id is required" });
      }

      if (!status) {
        return res.status(400).json({ message: "status is required" });
      }

      if (actorRole !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can update hiring application status." });
      }

      const updated = await updateHiringApplicationStatus({
        id,
        status: status as "submitted" | "under_review" | "approved" | "rejected",
        reviewerNotes: reviewerNotes || undefined,
        reviewerId: reviewerId || undefined,
        reviewerName: reviewerName || undefined,
      });

      return res.status(200).json(updated);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update hiring application status";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/service-offerings", async (_req: Request, res: Response) => {
    try {
      const rows = await listServiceOfferings();
      res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      return res.status(200).json(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load service offerings";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/admin/service-offerings/:code", async (req: Request, res: Response) => {
    try {
      const code = String(req.params?.code ?? "").trim();
      const price = String(req.body?.price ?? "").trim();
      const turnaround = String(req.body?.turnaround ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "")
        .trim()
        .toLowerCase();

      if (!code) {
        return res.status(400).json({ message: "service code is required" });
      }

      if (!price) {
        return res.status(400).json({ message: "price is required" });
      }

      if (!turnaround) {
        return res.status(400).json({ message: "turnaround is required" });
      }

      if (actorRole !== "admin") {
        return res.status(403).json({ message: "Only admins can update service pricing and delivery." });
      }

      const updated = await updateServiceOffering({
        code,
        price,
        turnaround,
      });

      return res.status(200).json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update service offering";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/chat-cards/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const cards = await getUserChatCards(userId);
      return res.status(200).json(cards);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load chat cards";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/chat/conversations/upsert", async (req: Request, res: Response) => {
    try {
      const requesterId = String(req.body?.requesterId ?? "").trim();
      const requesterName = String(req.body?.requesterName ?? "").trim();
      const requesterRole = String(req.body?.requesterRole ?? "").trim();
      const recipientId = String(req.body?.recipientId ?? "").trim();
      const recipientName = String(req.body?.recipientName ?? "").trim();
      const recipientRole = String(req.body?.recipientRole ?? "").trim();
      const subject = String(req.body?.subject ?? "").trim();
      const listingId = String(req.body?.listingId ?? "").trim();
      const initialMessage = String(req.body?.initialMessage ?? "").trim();
      const conversationScope = String(req.body?.conversationScope ?? "").trim();
      const serviceCode = String(req.body?.serviceCode ?? "").trim();

      if (!requesterName) {
        return res.status(400).json({ message: "requesterName is required" });
      }

      if (!recipientName) {
        return res.status(400).json({ message: "recipientName is required" });
      }

      const result = await upsertChatConversation({
        requesterId,
        requesterName,
        requesterRole: requesterRole || undefined,
        recipientId: recipientId || undefined,
        recipientName,
        recipientRole: recipientRole || undefined,
        subject: subject || undefined,
        listingId: listingId || undefined,
        initialMessage: initialMessage || undefined,
        conversationScope: conversationScope || undefined,
        serviceCode: serviceCode || undefined,
      });

      return res.status(200).json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create or load conversation";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.get("/api/chat/conversations", async (req: Request, res: Response) => {
    try {
      const viewerId = String(req.query?.viewerId ?? "").trim();
      const viewerRole = String(req.query?.viewerRole ?? "").trim();
      const viewerName = String(req.query?.viewerName ?? "").trim();
      if (!viewerId) {
        return res.status(400).json({ message: "viewerId is required" });
      }

      const conversations = await listUserConversations(
        viewerId,
        viewerRole || undefined,
        viewerName || undefined,
      );
      return res.status(200).json(conversations);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to list conversations";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.get("/api/admin/chat/conversations", async (req: Request, res: Response) => {
    try {
      const viewerId = String(req.query?.viewerId ?? "").trim();
      const viewerRole = String(req.query?.viewerRole ?? "").trim();
      const viewerName = String(req.query?.viewerName ?? "").trim();
      if (!viewerId) {
        return res.status(400).json({ message: "viewerId is required" });
      }

      const conversations = await listAllConversationsForAdmin(
        viewerId,
        viewerRole || undefined,
        viewerName || undefined,
      );
      return res.status(200).json(conversations);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to list admin conversations";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.get(
    "/api/chat/conversations/:conversationId/messages",
    async (req: Request, res: Response) => {
      try {
        const conversationId = String(req.params?.conversationId ?? "").trim();
        const viewerId = String(req.query?.viewerId ?? "").trim();

        if (!conversationId) {
          return res.status(400).json({ message: "conversationId is required" });
        }

        if (!viewerId) {
          return res.status(400).json({ message: "viewerId is required" });
        }

        const messages = await getConversationMessages(conversationId, viewerId);
        return res.status(200).json(messages);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load chat messages";
        if (message.startsWith("FORBIDDEN:")) {
          return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
        }
        return res.status(502).json({ message });
      }
    },
  );

  app.post(
    "/api/chat/conversations/:conversationId/messages",
    async (req: Request, res: Response) => {
      try {
        const conversationId = String(req.params?.conversationId ?? "").trim();
        const senderId = String(req.body?.senderId ?? "").trim();
        const senderName = String(req.body?.senderName ?? "").trim();
        const senderRole = String(req.body?.senderRole ?? "").trim();
        const messageTypeRaw = String(req.body?.messageType ?? "text")
          .trim()
          .toLowerCase();
        const messageType: "text" | "issue_card" =
          messageTypeRaw === "issue_card" ? "issue_card" : "text";
        const content = String(req.body?.content ?? "").trim();
        const metadata =
          req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
            ? (req.body.metadata as Record<string, unknown>)
            : undefined;
        const attachments: Array<{
          bucketId?: string;
          storagePath: string;
          fileName: string;
          mimeType?: string;
          fileSizeBytes?: number;
        }> = Array.isArray(req.body?.attachments)
          ? req.body.attachments
              .map((attachment: unknown) => {
                if (typeof attachment !== "object" || attachment === null) return null;
                const raw = attachment as Record<string, unknown>;
                const storagePath = String(raw.storagePath ?? "").trim();
                const fileName = String(raw.fileName ?? "").trim();
                if (!storagePath || !fileName) return null;

                const fileSizeBytesRaw = raw.fileSizeBytes;
                const fileSizeBytes =
                  typeof fileSizeBytesRaw === "number" && Number.isFinite(fileSizeBytesRaw)
                    ? fileSizeBytesRaw
                    : undefined;

                return {
                  bucketId: String(raw.bucketId ?? "").trim() || undefined,
                  storagePath,
                  fileName,
                  mimeType: String(raw.mimeType ?? "").trim() || undefined,
                  fileSizeBytes,
                };
              })
              .filter(
                (
                  attachment: {
                    bucketId?: string;
                    storagePath: string;
                    fileName: string;
                    mimeType?: string;
                    fileSizeBytes?: number;
                  } | null,
                ): attachment is {
                  bucketId?: string;
                  storagePath: string;
                  fileName: string;
                  mimeType?: string;
                  fileSizeBytes?: number;
                } => Boolean(attachment),
              )
          : [];

        if (!conversationId) {
          return res.status(400).json({ message: "conversationId is required" });
        }

        if (!senderId) {
          return res.status(400).json({ message: "senderId is required" });
        }

        if (!senderName) {
          return res.status(400).json({ message: "senderName is required" });
        }

        if (!content && attachments.length === 0 && messageType !== "issue_card") {
          return res.status(400).json({ message: "content or attachments is required" });
        }

        const message = await sendConversationMessage({
          conversationId,
          senderId,
          senderName,
          senderRole: senderRole || undefined,
          content,
          messageType,
          metadata,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        return res.status(200).json(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send chat message";
        if (message.startsWith("FORBIDDEN:")) {
          return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
        }
        return res.status(502).json({ message });
      }
    },
  );

  app.post(
    "/api/chat/conversations/:conversationId/attachments",
    async (req: Request, res: Response) => {
      try {
        const conversationId = String(req.params?.conversationId ?? "").trim();
        const senderId = String((req.body as Record<string, unknown> | undefined)?.senderId ?? "").trim();
        const scope = String((req.body as Record<string, unknown> | undefined)?.scope ?? "").trim().toLowerCase();
        const filesRaw = (req.body as Record<string, unknown> | undefined)?.files;
        const files = Array.isArray(filesRaw) ? filesRaw : [];

        if (!conversationId) {
          return res.status(400).json({ message: "conversationId is required" });
        }

        if (!senderId) {
          return res.status(400).json({ message: "senderId is required" });
        }

        if (files.length === 0) {
          return res.status(400).json({ message: "At least one file is required" });
        }

        if (files.length > 5) {
          return res.status(400).json({ message: "You can upload at most 5 files per message." });
        }

        const client = createSupabaseServiceClient();
        if (!client) {
          return res.status(503).json({ message: "Supabase storage is not configured on server." });
        }

        let bucketId = "chat-attachments";
        let storageRoot = `chat/${conversationId}/${senderId}`;

        if (scope === "service") {
          bucketId = "service-records";
          let serviceCode = "";
          let requesterOrSenderId = senderId;
          let existingFolderRoot = "";

          const { data: serviceRequest, error: serviceRequestError } = await client
            .from(SERVICE_REQUESTS_TABLE)
            .select("service_code, requester_id, folder_root")
            .eq("conversation_id", conversationId)
            .maybeSingle();

          if (serviceRequestError && !isMissingTableOrColumnError(serviceRequestError)) {
            return res.status(502).json({
              message: `Failed to resolve service folder root: ${serviceRequestError.message}`,
            });
          }

          const serviceRequestRecord =
            serviceRequest && typeof serviceRequest === "object"
              ? (serviceRequest as Record<string, unknown>)
              : null;
          serviceCode = String(serviceRequestRecord?.service_code ?? "").trim();
          requesterOrSenderId =
            String(serviceRequestRecord?.requester_id ?? "").trim() || requesterOrSenderId;
          existingFolderRoot = String(serviceRequestRecord?.folder_root ?? "").trim();

          const { data: conversation, error: conversationError } = await client
            .from(CHAT_CONVERSATIONS_TABLE)
            .select("service_type, created_by")
            .eq("id", conversationId)
            .maybeSingle();

          if (conversationError && !isMissingTableOrColumnError(conversationError)) {
            return res.status(502).json({
              message: `Failed to resolve conversation service metadata: ${conversationError.message}`,
            });
          }

          const conversationRecord =
            conversation && typeof conversation === "object"
              ? (conversation as Record<string, unknown>)
              : null;
          if (!serviceCode) {
            serviceCode = String(conversationRecord?.service_type ?? "").trim();
          }
          requesterOrSenderId =
            String(conversationRecord?.created_by ?? "").trim() || requesterOrSenderId;

          storageRoot = buildServiceFolderRoot(serviceCode, requesterOrSenderId, conversationId);

          if (existingFolderRoot && existingFolderRoot !== storageRoot) {
            const nowIso = new Date().toISOString();
            const { error: syncFolderError } = await client
              .from(SERVICE_REQUESTS_TABLE)
              .update({
                folder_root: storageRoot,
                updated_at: nowIso,
              })
              .eq("conversation_id", conversationId);

            if (syncFolderError && !isMissingTableOrColumnError(syncFolderError)) {
              return res.status(502).json({
                message: `Failed to sync service folder root: ${syncFolderError.message}`,
              });
            }

            const { error: syncTranscriptError } = await client
              .from(CONVERSATION_TRANSCRIPTS_TABLE)
              .upsert(
                {
                  conversation_id: conversationId,
                  transcript_format: "pdf",
                  bucket_id: "conversation-transcripts",
                  storage_path: `${storageRoot}/transcripts/${conversationId}.pdf`,
                  generated_at: nowIso,
                },
                { onConflict: "conversation_id" },
              );

            if (syncTranscriptError && !isMissingTableOrColumnError(syncTranscriptError)) {
              return res.status(502).json({
                message: `Failed to sync transcript folder root: ${syncTranscriptError.message}`,
              });
            }

            const { error: syncConversationFolderError } = await client
              .from(CHAT_CONVERSATIONS_TABLE)
              .update({
                record_folder: `${storageRoot}/chat`,
                updated_at: nowIso,
              })
              .eq("id", conversationId);

            if (
              syncConversationFolderError &&
              !isMissingTableOrColumnError(syncConversationFolderError)
            ) {
              return res.status(502).json({
                message: `Failed to sync conversation record folder: ${syncConversationFolderError.message}`,
              });
            }
          }
        }

        const uploaded: Array<{
          bucketId: string;
          storagePath: string;
          fileName: string;
          mimeType?: string;
          fileSizeBytes?: number;
        }> = [];

        for (const file of files) {
          if (typeof file !== "object" || file === null) {
            return res.status(400).json({ message: "Invalid file payload." });
          }

          const payload = file as Record<string, unknown>;
          const originalName = String(payload.fileName ?? "attachment.bin");
          const safeName = sanitizeStorageFileName(originalName);
          const storagePath = `${storageRoot}/${Date.now()}-${randomUUID()}-${safeName}`;
          const contentBase64 = String(payload.contentBase64 ?? "").trim();
          const normalizedBase64 = contentBase64.includes(",")
            ? contentBase64.split(",").pop() ?? ""
            : contentBase64;
          const fileBuffer = Buffer.from(normalizedBase64, "base64");

          if (!normalizedBase64 || !fileBuffer || fileBuffer.length === 0) {
            return res.status(400).json({ message: `File "${originalName}" is empty.` });
          }
          if (fileBuffer.length > 20 * 1024 * 1024) {
            return res.status(400).json({
              message: `File "${originalName}" exceeds the 20MB upload limit.`,
            });
          }

          const contentType =
            String(payload.mimeType ?? "").trim() || "application/octet-stream";
          const { error } = await client.storage
            .from(bucketId)
            .upload(storagePath, fileBuffer, { contentType, upsert: false });

          if (error) {
            return res.status(502).json({
              message: `Failed to upload "${originalName}": ${error.message}`,
            });
          }

          uploaded.push({
            bucketId,
            storagePath,
            fileName: originalName,
            mimeType: contentType,
            fileSizeBytes:
              typeof payload.fileSizeBytes === "number" && Number.isFinite(payload.fileSizeBytes)
                ? Math.max(0, Math.trunc(payload.fileSizeBytes))
                : undefined,
          });
        }

        return res.status(200).json({ attachments: uploaded });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to upload attachments";
        return res.status(502).json({ message });
      }
    },
  );

  app.patch("/api/admin/verifications/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const status = req.body?.status as AdminVerificationStatus | undefined;
      const allowedStatuses: AdminVerificationStatus[] = [
        "Awaiting Review",
        "Approved",
        "Rejected",
      ];

      if (!id) {
        return res.status(400).json({ message: "verification id is required" });
      }

      if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: Awaiting Review, Approved, Rejected",
        });
      }

      await setVerificationStatus(id, status);
      return res.status(200).json({ ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update verification status";
      return res.status(502).json({ message });
    }
  });

  app.patch("/api/admin/flagged-listings/:id/status", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const status = req.body?.status as AdminFlaggedListingStatus | undefined;
      const allowedStatuses: AdminFlaggedListingStatus[] = ["Open", "Under Review", "Cleared"];

      if (!id) {
        return res.status(400).json({ message: "listing id is required" });
      }

      if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: Open, Under Review, Cleared",
        });
      }

      await setFlaggedListingStatus(id, status);
      return res.status(200).json({ ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update flagged listing status";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/admin/flagged-listings/:id/comments", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const comment = String(req.body?.comment ?? "").trim();
      const problemTag = String(req.body?.problemTag ?? "").trim();
      const createdBy = String(req.body?.createdBy ?? "Admin").trim();
      const createdById = String(req.body?.createdById ?? "").trim();

      if (!id) {
        return res.status(400).json({ message: "listing id is required" });
      }

      if (!comment) {
        return res.status(400).json({ message: "comment is required" });
      }

      if (!problemTag) {
        return res.status(400).json({ message: "problemTag is required" });
      }

      const savedComment = await addFlaggedListingComment(id, {
        comment,
        problemTag,
        createdBy,
        createdById: createdById || undefined,
      });

      return res.status(200).json(savedComment);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add listing comment";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/transactions/upsert", async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.body?.conversationId ?? "").trim();
      const transactionKind = String(req.body?.transactionKind ?? "sale").trim().toLowerCase();
      const closingModeRaw = String(req.body?.closingMode ?? "").trim().toLowerCase();
      const status = String(req.body?.status ?? "").trim().toLowerCase();
      const metadata = req.body?.metadata;

      if (!conversationId) {
        return res.status(400).json({ message: "conversationId is required." });
      }

      const transaction = await upsertTransaction({
        conversationId,
        transactionKind: transactionKind as "sale" | "rent" | "service" | "booking",
        closingMode: closingModeRaw === "direct" || closingModeRaw === "agent_led" ? closingModeRaw : null,
        status: status ? (status as TransactionStatus) : undefined,
        buyerUserId: String(req.body?.buyerUserId ?? "").trim() || undefined,
        sellerUserId: String(req.body?.sellerUserId ?? "").trim() || undefined,
        agentUserId: String(req.body?.agentUserId ?? "").trim() || undefined,
        providerUserId: String(req.body?.providerUserId ?? "").trim() || undefined,
        currency: String(req.body?.currency ?? "").trim() || undefined,
        principalAmount:
          typeof req.body?.principalAmount === "number" && Number.isFinite(req.body.principalAmount)
            ? req.body.principalAmount
            : undefined,
        inspectionFeeAmount:
          typeof req.body?.inspectionFeeAmount === "number" &&
          Number.isFinite(req.body.inspectionFeeAmount)
            ? req.body.inspectionFeeAmount
            : undefined,
        inspectionFeeRefundable:
          typeof req.body?.inspectionFeeRefundable === "boolean"
            ? req.body.inspectionFeeRefundable
            : undefined,
        inspectionFeeStatus: String(req.body?.inspectionFeeStatus ?? "").trim() || undefined,
        metadata:
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : undefined,
      });

      return res.status(200).json(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upsert transaction.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/transactions/by-conversation/:conversationId", async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params?.conversationId ?? "").trim();
      if (!conversationId) {
        return res.status(400).json({ message: "conversationId is required." });
      }

      const transaction = await getTransactionByConversationId(conversationId);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found for this conversation." });
      }
      return res.status(200).json(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load transaction.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/transactions/:transactionId", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      if (!transactionId) {
        return res.status(400).json({ message: "transactionId is required." });
      }
      const transaction = await getTransactionByIdPublic(transactionId);
      return res.status(200).json(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load transaction.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/transactions/:transactionId/status", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      const toStatus = toTransactionStatus(req.body?.toStatus);
      const actorUserId = String(req.body?.actorUserId ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim();
      const metadata = req.body?.metadata;

      if (!transactionId || !toStatus) {
        return res.status(400).json({ message: "transactionId and toStatus are required." });
      }

      const updated = await transitionTransactionStatus({
        transactionId,
        toStatus,
        actorUserId: actorUserId || undefined,
        reason: reason || undefined,
        metadata:
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : undefined,
      });

      return res.status(200).json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update transaction status.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/transactions/:transactionId/actions", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      if (!transactionId) {
        return res.status(400).json({ message: "transactionId is required." });
      }
      const actions = await listTransactionActions(transactionId);
      return res.status(200).json(actions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load transaction actions.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/transactions/:transactionId/actions", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      const conversationId = String(req.body?.conversationId ?? "").trim();
      const actionType = toChatActionType(req.body?.actionType);
      const targetRole = normalizeActionRole(req.body?.targetRole);
      const createdByUserId = String(req.body?.createdByUserId ?? "").trim();
      const createdByName = String(req.body?.createdByName ?? "Action Creator").trim();
      const createdByRole = String(req.body?.createdByRole ?? "").trim();
      const content = String(req.body?.content ?? "").trim();

      if (!transactionId || !conversationId || !actionType) {
        return res.status(400).json({
          message: "transactionId, conversationId, and actionType are required.",
        });
      }

      const action = await createChatAction({
        transactionId,
        conversationId,
        actionType,
        targetRole,
        payload:
          req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
            ? (req.body.payload as Record<string, unknown>)
            : undefined,
        createdByUserId: createdByUserId || undefined,
        expiresAt: String(req.body?.expiresAt ?? "").trim() || undefined,
      });

      const warnings: string[] = [];
      if (createdByUserId) {
        try {
          await postTransactionActionMessage({
            conversationId,
            senderId: createdByUserId,
            senderName: createdByName || "Action Creator",
            senderRole: createdByRole || undefined,
            action,
            content: content || `Action required: ${actionType.replace(/_/g, " ")}`,
          });
        } catch (error) {
          warnings.push(
            error instanceof Error
              ? error.message
              : "Action created but chat-card message delivery failed.",
          );
        }
      }

      return res.status(201).json({ action, warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create action.";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.post("/api/chat-actions/:actionId/resolve", async (req: Request, res: Response) => {
    try {
      const actionId = String(req.params?.actionId ?? "").trim();
      const actorUserId = String(req.body?.actorUserId ?? "").trim();
      const actorName = String(req.body?.actorName ?? "Action Resolver").trim();
      const actorRole = normalizeActionRole(req.body?.actorRole);
      const decision = String(req.body?.decision ?? "").trim().toLowerCase();
      const resolutionPayload = req.body?.payload;
      if (!actionId || !actorUserId || (decision !== "accept" && decision !== "decline" && decision !== "submit")) {
        return res.status(400).json({
          message: "actionId, actorUserId, and decision (accept/decline/submit) are required.",
        });
      }

      const warnings: string[] = [];
      const resolved = await resolveChatAction({
        actionId,
        actorUserId,
        actorRole,
        decision: decision as "accept" | "decline" | "submit",
        payload:
          resolutionPayload && typeof resolutionPayload === "object" && !Array.isArray(resolutionPayload)
            ? (resolutionPayload as Record<string, unknown>)
            : undefined,
      });
      let transaction = resolved.transaction;
      const action = resolved.action;

      const tryStep = async (step: () => Promise<void>) => {
        try {
          await step();
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Automation step failed.");
        }
      };

      if (action.status === "accepted" || action.status === "submitted") {
        if (action.actionType === "escrow_payment_request" && action.status === "accepted") {
          await tryStep(async () => {
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus: "escrow_requested",
              actorUserId,
              reason: "Escrow payment request accepted.",
            });
          });

          await tryStep(async () => {
            await sendConversationMessage({
              conversationId: transaction.conversationId,
              senderId: actorUserId,
              senderName: actorName || "Action Resolver",
              senderRole: actorRole,
              messageType: "text",
              content: buildEscrowInstructionMessage(transaction),
            });
          });

          await tryStep(async () => {
            const uploadAction = await createChatAction({
              transactionId: transaction.id,
              conversationId: transaction.conversationId,
              actionType: "upload_payment_proof",
              targetRole:
                transaction.transactionKind === "rent"
                  ? "renter"
                  : "buyer",
              payload: {
                requiredDocuments: ["payment_receipt", "transfer_reference"],
              },
              createdByUserId: actorUserId,
            });
            await postTransactionActionMessage({
              conversationId: transaction.conversationId,
              senderId: actorUserId,
              senderName: actorName || "Action Resolver",
              senderRole: actorRole,
              action: uploadAction,
              content: "Upload proof of payment to continue.",
            });
          });
        }

        if (action.actionType === "upload_payment_proof") {
          await tryStep(async () => {
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus:
                transaction.transactionKind === "service"
                  ? "escrow_paid_pending_verification"
                  : "escrow_funded_pending_verification",
              actorUserId,
              reason: "Payment proof submitted.",
            });
          });
        }

        if (action.actionType === "schedule_meeting_request" && action.status === "accepted") {
          await tryStep(async () => {
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus: "closing_scheduled",
              actorUserId,
              reason: "Closing meeting accepted.",
            });
          });
        }

        if (action.actionType === "upload_signed_closing_contract") {
          await tryStep(async () => {
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus: "closing_pending_confirmation",
              actorUserId,
              reason: "Signed contract uploaded.",
            });
          });
        }

        if (action.actionType === "mark_delivered") {
          const acceptanceDueAt = resolveDirectAcceptanceDueAtIso();
          await tryStep(async () => {
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus: "delivered",
              actorUserId,
              reason: "Delivery marked complete.",
            });
          });

          await tryStep(async () => {
            await setTransactionAcceptanceDueAt(transaction.id, acceptanceDueAt);
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus: "acceptance_pending",
              actorUserId,
              reason: "Waiting for buyer/renter acceptance.",
              metadata: { acceptanceDueAt },
            });
          });

          await tryStep(async () => {
            const acceptAction = await createChatAction({
              transactionId: transaction.id,
              conversationId: transaction.conversationId,
              actionType: "accept_delivery",
              targetRole: transaction.transactionKind === "rent" ? "renter" : "buyer",
              payload: {
                buttons: ["accept", "dispute"],
                acceptanceDueAt,
              },
              createdByUserId: actorUserId,
              expiresAt: acceptanceDueAt,
            });

            await postTransactionActionMessage({
              conversationId: transaction.conversationId,
              senderId: actorUserId,
              senderName: actorName || "Action Resolver",
              senderRole: actorRole,
              action: acceptAction,
              content: "Delivery marked. Please accept delivery or dispute.",
            });
          });
        }

        if (action.actionType === "accept_delivery") {
          if (action.status === "accepted") {
            await tryStep(async () => {
              transaction = await transitionTransactionStatus({
                transactionId: transaction.id,
                toStatus: "completed",
                actorUserId,
                reason: "Buyer accepted delivery.",
              });
              await setTransactionAcceptanceDueAt(transaction.id, null);
            });
          } else {
            await tryStep(async () => {
              await openTransactionDispute({
                transactionId: transaction.id,
                conversationId: transaction.conversationId,
                openedByUserId: actorUserId,
                reason: "Delivery disputed by buyer/renter.",
                metadata: {
                  sourceActionId: action.id,
                  sourceActionType: action.actionType,
                  sourceActionStatus: action.status,
                },
              });
            });
          }
        }

        if (action.actionType === "service_quote" && action.status === "accepted") {
          await tryStep(async () => {
            transaction = await transitionTransactionStatus({
              transactionId: transaction.id,
              toStatus: "quote_accepted",
              actorUserId,
              reason: "Service quote accepted.",
            });
          });
        }
      } else if (action.actionType === "accept_delivery" && action.status === "declined") {
        await tryStep(async () => {
          await openTransactionDispute({
            transactionId: transaction.id,
            conversationId: transaction.conversationId,
            openedByUserId: actorUserId,
            reason: "Delivery disputed by buyer/renter.",
            metadata: {
              sourceActionId: action.id,
              sourceActionType: action.actionType,
              sourceActionStatus: action.status,
            },
          });
        });
      }

      return res.status(200).json({ action, transaction, warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve action.";
      if (message.startsWith("FORBIDDEN:")) {
        return res.status(403).json({ message: message.replace("FORBIDDEN:", "").trim() });
      }
      return res.status(502).json({ message });
    }
  });

  app.post("/api/transactions/:transactionId/payout-claim", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
      const amount = Number(req.body?.amount);
      const ledgerType = String(req.body?.ledgerType ?? "payout").trim().toLowerCase();
      if (!transactionId || !idempotencyKey || !Number.isFinite(amount)) {
        return res.status(400).json({
          message: "transactionId, idempotencyKey, and numeric amount are required.",
        });
      }

      const claim = await claimPayoutLedgerEntry({
        transactionId,
        idempotencyKey,
        amount,
        ledgerType: ledgerType as "payout" | "refund" | "commission",
        currency: String(req.body?.currency ?? "").trim() || undefined,
        recipientUserId: String(req.body?.recipientUserId ?? "").trim() || undefined,
        reference: String(req.body?.reference ?? "").trim() || undefined,
        metadata:
          req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
            ? (req.body.metadata as Record<string, unknown>)
            : undefined,
      });

      return res.status(200).json(claim);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to claim payout ledger entry.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/transactions/:transactionId/ratings", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      const raterUserId = String(req.body?.raterUserId ?? "").trim();
      const stars = Number(req.body?.stars);
      if (!transactionId || !raterUserId || !Number.isFinite(stars)) {
        return res.status(400).json({
          message: "transactionId, raterUserId, and numeric stars are required.",
        });
      }

      const rating = await upsertTransactionRating({
        transactionId,
        raterUserId,
        stars,
        review: String(req.body?.review ?? "").trim() || undefined,
        ratedUserId: String(req.body?.ratedUserId ?? "").trim() || undefined,
      });
      return res.status(200).json(rating);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit transaction rating.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/disputes/open", async (req: Request, res: Response) => {
    try {
      const actorRole = normalizeActionRole(req.query?.actorRole);
      if (!isPrivilegedActorRole(actorRole)) {
        return res.status(403).json({ message: "Only admin/support can view all open disputes." });
      }

      const limit = Number(req.query?.limit);
      const disputes = await listOpenDisputes({
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return res.status(200).json(disputes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load open disputes.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/transactions/:transactionId/disputes", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      if (!transactionId) {
        return res.status(400).json({ message: "transactionId is required." });
      }

      const statusRaw = String(req.query?.status ?? "all").trim().toLowerCase();
      const limit = Number(req.query?.limit);
      const disputes = await listTransactionDisputes(transactionId, {
        status:
          statusRaw === "open" ||
          statusRaw === "resolved" ||
          statusRaw === "rejected" ||
          statusRaw === "cancelled"
            ? (statusRaw as "open" | "resolved" | "rejected" | "cancelled")
            : "all",
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return res.status(200).json(disputes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load disputes.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/transactions/:transactionId/disputes", async (req: Request, res: Response) => {
    try {
      const transactionId = String(req.params?.transactionId ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim();
      const details = String(req.body?.details ?? "").trim() || undefined;
      const openedByUserId = String(req.body?.openedByUserId ?? "").trim() || undefined;
      const openedByName = String(req.body?.openedByName ?? "System").trim();
      const openedByRole = normalizeActionRole(req.body?.openedByRole);
      let conversationId = String(req.body?.conversationId ?? "").trim();

      if (!transactionId || !reason) {
        return res.status(400).json({
          message: "transactionId and reason are required.",
        });
      }

      if (!conversationId) {
        const transaction = await getTransactionByIdPublic(transactionId);
        conversationId = transaction.conversationId;
      }

      const dispute = await openTransactionDispute({
        transactionId,
        conversationId,
        openedByUserId,
        againstUserId: String(req.body?.againstUserId ?? "").trim() || undefined,
        reason,
        details,
        metadata:
          req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
            ? (req.body.metadata as Record<string, unknown>)
            : undefined,
      });

      const warnings: string[] = [];
      if (openedByUserId) {
        try {
          await sendConversationMessage({
            conversationId,
            senderId: openedByUserId,
            senderName: openedByName,
            senderRole: openedByRole,
            messageType: "issue_card",
            content: "Dispute opened",
            metadata: {
              issueCard: {
                title: "DISPUTE OPENED",
                message: reason,
                status: "open",
              },
              dispute: {
                id: dispute.id,
                reason: dispute.reason,
                details: dispute.details,
              },
            },
          });
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Dispute opened, but chat notification failed.");
        }
      }

      return res.status(201).json({ dispute, warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open dispute.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/disputes/:disputeId/resolve", async (req: Request, res: Response) => {
    try {
      const disputeId = String(req.params?.disputeId ?? "").trim();
      const actorRole = normalizeActionRole(req.body?.resolvedByRole);
      if (!isPrivilegedActorRole(actorRole)) {
        return res.status(403).json({ message: "Only admin/support can resolve disputes." });
      }

      const nextStatusRaw = String(req.body?.status ?? "resolved").trim().toLowerCase();
      const nextStatus =
        nextStatusRaw === "rejected" || nextStatusRaw === "cancelled" ? nextStatusRaw : "resolved";

      const resolved = await resolveTransactionDispute({
        disputeId,
        status: nextStatus,
        resolvedByUserId: String(req.body?.resolvedByUserId ?? "").trim() || undefined,
        resolution: String(req.body?.resolution ?? "").trim() || undefined,
        resolutionTargetStatus: String(req.body?.resolutionTargetStatus ?? "").trim().toLowerCase() as
          | TransactionStatus
          | undefined,
        metadata:
          req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
            ? (req.body.metadata as Record<string, unknown>)
            : undefined,
        unfreezeEscrow:
          typeof req.body?.unfreezeEscrow === "boolean" ? req.body.unfreezeEscrow : true,
      });

      const warnings: string[] = [];
      try {
        await sendConversationMessage({
          conversationId: resolved.conversationId,
          senderId: String(req.body?.resolvedByUserId ?? "").trim() || randomUUID(),
          senderName: String(req.body?.resolvedByName ?? "Justice City Support").trim(),
          senderRole: actorRole,
          messageType: "issue_card",
          content: "Dispute resolved",
          metadata: {
            issueCard: {
              title: "DISPUTE UPDATE",
              message: resolved.resolution ?? `Dispute ${resolved.status}.`,
              status: resolved.status,
            },
            dispute: {
              id: resolved.id,
              status: resolved.status,
            },
          },
        });
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : "Dispute resolved, but chat notification failed.",
        );
      }

      return res.status(200).json({ dispute: resolved, warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve dispute.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/service-pdf-jobs", async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.query?.conversationId ?? "").trim() || undefined;
      const statusRaw = String(req.query?.status ?? "all").trim().toLowerCase();
      const limit = Number(req.query?.limit);
      const jobs = await listServicePdfJobs({
        conversationId,
        status:
          statusRaw === "queued" ||
          statusRaw === "processing" ||
          statusRaw === "completed" ||
          statusRaw === "failed"
            ? (statusRaw as "queued" | "processing" | "completed" | "failed")
            : "all",
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return res.status(200).json(jobs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list service PDF jobs.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/service-pdf-jobs", async (req: Request, res: Response) => {
    try {
      const actorRole = normalizeActionRole(req.body?.actorRole);
      if (!isPrivilegedActorRole(actorRole) && actorRole !== "agent") {
        return res.status(403).json({ message: "Only admin/support/agent can queue service PDF jobs." });
      }

      let conversationId = String(req.body?.conversationId ?? "").trim();
      const transactionId = String(req.body?.transactionId ?? "").trim() || undefined;
      if (!conversationId && transactionId) {
        const transaction = await getTransactionByIdPublic(transactionId);
        conversationId = transaction.conversationId;
      }
      if (!conversationId) {
        return res.status(400).json({ message: "conversationId or transactionId is required." });
      }

      const job = await enqueueServicePdfJob({
        conversationId,
        serviceRequestId: String(req.body?.serviceRequestId ?? "").trim() || undefined,
        transactionId,
        createdByUserId: String(req.body?.createdByUserId ?? "").trim() || undefined,
        outputBucket: String(req.body?.outputBucket ?? "").trim() || undefined,
        outputPath: String(req.body?.outputPath ?? "").trim() || undefined,
        maxAttempts:
          typeof req.body?.maxAttempts === "number" && Number.isFinite(req.body.maxAttempts)
            ? req.body.maxAttempts
            : undefined,
        payload:
          req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
            ? (req.body.payload as Record<string, unknown>)
            : undefined,
      });

      return res.status(201).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enqueue service PDF job.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/service-pdf-jobs/process-next", async (req: Request, res: Response) => {
    try {
      const actorRole = normalizeActionRole(req.body?.actorRole);
      if (!isPrivilegedActorRole(actorRole)) {
        return res.status(403).json({ message: "Only admin/support can process queued jobs manually." });
      }
      const job = await processNextServicePdfJob();
      return res.status(200).json({ job });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process next service PDF job.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/provider-links/by-conversation/:conversationId", async (req: Request, res: Response) => {
    try {
      const conversationId = String(req.params?.conversationId ?? "").trim();
      if (!conversationId) {
        return res.status(400).json({ message: "conversationId is required." });
      }

      const limit = Number(req.query?.limit);
      const links = await listProviderLinksByConversation(conversationId, {
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return res.status(200).json(links);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list provider links.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/provider-links", async (req: Request, res: Response) => {
    try {
      const actorRole = normalizeActionRole(req.body?.createdByRole);
      if (!isPrivilegedActorRole(actorRole) && actorRole !== "agent") {
        return res.status(403).json({ message: "Only admin/support/agent can create provider links." });
      }

      const conversationId = String(req.body?.conversationId ?? "").trim();
      if (!conversationId) {
        return res.status(400).json({ message: "conversationId is required." });
      }

      const created = await createServiceProviderLink({
        conversationId,
        serviceRequestId: String(req.body?.serviceRequestId ?? "").trim() || undefined,
        providerUserId: String(req.body?.providerUserId ?? "").trim() || undefined,
        expiresAt: String(req.body?.expiresAt ?? "").trim() || undefined,
        payload:
          req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
            ? (req.body.payload as Record<string, unknown>)
            : undefined,
        createdByUserId: String(req.body?.createdByUserId ?? "").trim() || undefined,
      });

      const baseUrl = resolvePublicAppBaseUrl(req);
      const packageUrl = `${baseUrl}/provider-package/${encodeURIComponent(created.token)}`;
      return res.status(201).json({
        link: created.link,
        token: created.token,
        packageUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create provider package link.";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/provider-links/:linkId/revoke", async (req: Request, res: Response) => {
    try {
      const actorRole = normalizeActionRole(req.body?.actorRole);
      if (!isPrivilegedActorRole(actorRole)) {
        return res.status(403).json({ message: "Only admin/support can revoke provider links." });
      }
      const linkId = String(req.params?.linkId ?? "").trim();
      if (!linkId) {
        return res.status(400).json({ message: "linkId is required." });
      }

      const link = await revokeProviderLink(linkId);
      return res.status(200).json(link);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke provider link.";
      return res.status(502).json({ message });
    }
  });

  app.get("/api/provider-package/:token", async (req: Request, res: Response) => {
    try {
      const token = String(req.params?.token ?? "").trim();
      if (!token) {
        return res.status(400).json({ message: "token is required." });
      }

      const providerPackage = await resolveProviderPackageByToken(token);
      return res.status(200).json(providerPackage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load provider package.";
      return res.status(404).json({ message });
    }
  });

  app.post(["/api/verification/phone/send", "/api/phone-otp/send"], async (req: Request, res: Response) => {
    try {
      const phone = normalizePhoneNumber(req.body?.phone);
      if (!phone) {
        return res.status(400).json({ message: "phone is required" });
      }
      if (!isE164Phone(phone)) {
        return res.status(400).json({
          message: "Phone number must be in international format (E.164), e.g. +2349012345678.",
        });
      }

      const sendAllowed = await checkPhoneSendAllowed(phone);
      if (!sendAllowed.ok) {
        const policy = getPhoneOtpPolicy();
        const message =
          sendAllowed.reason === "cooldown"
            ? `Please wait ${sendAllowed.retryAfterSec}s before requesting another OTP code.`
            : `Too many OTP requests. Try again in ${sendAllowed.retryAfterSec}s.`;

        return res.status(429).json({
          message,
          retryAfterSec: sendAllowed.retryAfterSec,
          policy,
        });
      }

      const result = await sendPhoneVerificationCode(phone);
      await markPhoneCodeSent(phone);
      return res.status(200).json({
        ok: true,
        status: result.status,
        to: result.to,
        channel: result.channel,
        cooldownSec: getPhoneOtpPolicy().sendCooldownSec,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send phone verification code";
      return res.status(502).json({ message });
    }
  });

  app.post(["/api/verification/phone/check", "/api/phone-otp/verify"], async (req: Request, res: Response) => {
    try {
      const phone = normalizePhoneNumber(req.body?.phone);
      const code = String(req.body?.code ?? "").trim();
      const userId = String(req.body?.userId ?? "").trim();

      if (!phone) {
        return res.status(400).json({ message: "phone is required" });
      }
      if (!isE164Phone(phone)) {
        return res.status(400).json({
          message: "Phone number must be in international format (E.164), e.g. +2349012345678.",
        });
      }
      if (!code) {
        return res.status(400).json({ message: "code is required" });
      }

      const verifyAllowed = await checkPhoneVerifyAllowed(phone);
      if (!verifyAllowed.ok) {
        return res.status(429).json({
          message: `Too many invalid code attempts. Try again in ${verifyAllowed.retryAfterSec}s.`,
          retryAfterSec: verifyAllowed.retryAfterSec,
          policy: getPhoneOtpPolicy(),
        });
      }

      const result = await checkPhoneVerificationCode(phone, code);
      const approved = result.valid || result.status === "approved";

      if (!approved) {
        const failedState = await markPhoneVerifyFailed(phone);
        if (failedState.blocked) {
          return res.status(429).json({
            ok: false,
            valid: false,
            status: result.status,
            to: result.to,
            message: `Too many invalid code attempts. Try again in ${failedState.retryAfterSec}s.`,
            retryAfterSec: failedState.retryAfterSec,
            attemptsRemaining: 0,
          });
        }

        return res.status(200).json({
          ok: false,
          valid: false,
          status: result.status,
          to: result.to,
          message: "Invalid or expired code.",
          attemptsRemaining: failedState.attemptsRemaining,
        });
      }

      await markPhoneVerifySucceeded(phone);

      if (approved && userId) {
        await ensureUserExistsForOtp(userId, {
          phoneVerified: true,
          phone,
        });

        const client = createSupabaseServiceClient();
        if (client) {
          const { error } = await client
            .from(USERS_TABLE)
            .update({ phone, phone_verified: true })
            .eq("id", userId);
          if (error && !isMissingTableOrColumnError(error)) {
            throw new Error(`Phone verification succeeded, but failed to persist phone number: ${error.message}`);
          }
        }
      }

      return res.status(200).json({
        ok: approved,
        valid: approved,
        status: result.status,
        to: result.to,
        attemptsRemaining: getPhoneOtpPolicy().maxVerifyAttempts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify phone code";
      return res.status(502).json({ message });
    }
  });

  app.post(["/api/verification/email/send", "/api/email-otp/send"], async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({ message: "email is required" });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "A valid email address is required." });
      }

      const guardKey = `email:${email}`;
      const sendAllowed = await checkPhoneSendAllowed(guardKey);
      if (!sendAllowed.ok) {
        const policy = getPhoneOtpPolicy();
        const message =
          sendAllowed.reason === "cooldown"
            ? `Please wait ${sendAllowed.retryAfterSec}s before requesting another OTP code.`
            : `Too many OTP requests. Try again in ${sendAllowed.retryAfterSec}s.`;

        return res.status(429).json({
          message,
          retryAfterSec: sendAllowed.retryAfterSec,
          policy,
        });
      }

      const result = await sendEmailVerificationCode(email);
      await markPhoneCodeSent(guardKey);

        return res.status(200).json({
          ok: true,
          status: result.status,
          to: result.to,
          channel: "email",
          cooldownSec: getPhoneOtpPolicy().sendCooldownSec,
          providerMessageId: result.providerMessageId ?? null,
          templateUsed: Boolean(result.templateUsed),
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send email verification code";
      return res.status(502).json({ message });
    }
  });

  app.post(["/api/verification/email/check", "/api/email-otp/verify"], async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const code = String(req.body?.code ?? "").trim();
      const userId = String(req.body?.userId ?? "").trim();

      if (!email) {
        return res.status(400).json({ message: "email is required" });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "A valid email address is required." });
      }
      if (!code) {
        return res.status(400).json({ message: "code is required" });
      }

      const guardKey = `email:${email}`;
      const verifyAllowed = await checkPhoneVerifyAllowed(guardKey);
      if (!verifyAllowed.ok) {
        return res.status(429).json({
          message: `Too many invalid code attempts. Try again in ${verifyAllowed.retryAfterSec}s.`,
          retryAfterSec: verifyAllowed.retryAfterSec,
          policy: getPhoneOtpPolicy(),
        });
      }

      const result = await checkEmailVerificationCode(email, code);
      const approved = result.valid || result.status === "approved";

      if (!approved) {
        const failedState = await markPhoneVerifyFailed(guardKey);
        if (failedState.blocked) {
          return res.status(429).json({
            ok: false,
            valid: false,
            status: result.status,
            to: result.to,
            message: `Too many invalid code attempts. Try again in ${failedState.retryAfterSec}s.`,
            retryAfterSec: failedState.retryAfterSec,
            attemptsRemaining: 0,
          });
        }

        return res.status(200).json({
          ok: false,
          valid: false,
          status: result.status,
          to: result.to,
          message: result.status === "expired" ? "Code expired. Request a new one." : "Invalid code.",
          attemptsRemaining: failedState.attemptsRemaining,
        });
      }

      await markPhoneVerifySucceeded(guardKey);

      if (approved && userId) {
        await ensureUserExistsForOtp(userId, {
          emailVerified: true,
          email,
        });

        const client = createSupabaseServiceClient();
        if (client) {
          const { error } = await client
            .from(USERS_TABLE)
            .update({ email, email_verified: true })
            .eq("id", userId);
          if (error && !isMissingTableOrColumnError(error)) {
            throw new Error(
              `Email verification succeeded, but failed to persist email on user profile: ${error.message}`,
            );
          }
        }
      }

      return res.status(200).json({
        ok: true,
        valid: true,
        status: "approved",
        to: result.to,
        attemptsRemaining: getPhoneOtpPolicy().maxVerifyAttempts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify email code";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/verification/documents/upload", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const userId = String(req.body?.userId ?? "").trim();
      const documentType = String(req.body?.documentType ?? "identity").trim();
      const fileName = String(req.body?.fileName ?? "").trim();
      const mimeType = String(req.body?.mimeType ?? "").trim();
      const contentBase64 = String(req.body?.contentBase64 ?? "").trim();
      const verificationId = String(req.body?.verificationId ?? "").trim();
      const homeAddressRaw = req.body?.homeAddress;
      const officeAddressRaw = req.body?.officeAddress;
      const dateOfBirthRaw = req.body?.dateOfBirth;
      const fileSizeRaw = req.body?.fileSizeBytes;
      const fileSizeBytes =
        typeof fileSizeRaw === "number" && Number.isFinite(fileSizeRaw)
          ? Math.max(0, Math.trunc(fileSizeRaw))
          : undefined;
      const homeAddress =
        typeof homeAddressRaw === "string" && homeAddressRaw.trim().length > 0
          ? homeAddressRaw.trim()
          : undefined;
      const officeAddress =
        typeof officeAddressRaw === "string" && officeAddressRaw.trim().length > 0
          ? officeAddressRaw.trim()
          : undefined;
      const dateOfBirth =
        typeof dateOfBirthRaw === "string" && dateOfBirthRaw.trim().length > 0
          ? dateOfBirthRaw.trim()
          : undefined;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }
      if (userId !== authActor.userId && authActor.role !== "admin") {
        return res.status(403).json({ message: "userId does not match authenticated user." });
      }
      if (!fileName) {
        return res.status(400).json({ message: "fileName is required" });
      }
      if (!contentBase64) {
        return res.status(400).json({ message: "contentBase64 is required" });
      }
      if (homeAddress && homeAddress.length > 500) {
        return res.status(400).json({ message: "homeAddress must be 500 characters or fewer." });
      }
      if (officeAddress && officeAddress.length > 500) {
        return res.status(400).json({ message: "officeAddress must be 500 characters or fewer." });
      }
      if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
        return res.status(400).json({ message: "dateOfBirth must be in YYYY-MM-DD format." });
      }

      const uploaded = await uploadVerificationDocument({
        userId,
        documentType,
        fileName,
        mimeType: mimeType || undefined,
        fileSizeBytes,
        contentBase64,
        verificationId: verificationId || undefined,
        homeAddress,
        officeAddress,
        dateOfBirth,
      });

      return res.status(201).json(uploaded);
    } catch (error) {
      if (error instanceof VerificationDocumentValidationError) {
        return res.status(400).json({
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
      }
      const message = error instanceof Error ? error.message : "Failed to upload verification document";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/verification/smile-id", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const {
        mode = "biometric",
        userId,
        verificationId,
        country,
        idType,
        idNumber,
        firstName,
        lastName,
        dateOfBirth,
        selfieImageBase64,
      } = req.body ?? {};

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ message: "userId is required" });
      }
      if (String(userId).trim() !== authActor.userId && authActor.role !== "admin") {
        return res.status(403).json({ message: "userId does not match authenticated user." });
      }

      if (mode !== "kyc" && mode !== "biometric") {
        return res
          .status(400)
          .json({ message: "mode must be either 'kyc' or 'biometric'" });
      }

      const normalizedVerificationId = String(verificationId ?? "").trim();
      type VerificationLookupRow = {
        id: string;
        user_id: string;
        home_address?: string | null;
        date_of_birth?: string | null;
      };

      const loadVerificationRow = async (
        includeDateOfBirth: boolean,
      ): Promise<{ data: VerificationLookupRow | null; error: unknown | null }> => {
        const selectColumns = includeDateOfBirth
          ? "id, user_id, home_address, date_of_birth"
          : "id, user_id, home_address";

        if (normalizedVerificationId) {
          const { data, error } = await client
            .from(VERIFICATIONS_TABLE)
            .select(selectColumns)
            .eq("id", normalizedVerificationId)
            .eq("user_id", userId)
            .maybeSingle<VerificationLookupRow>();
          return { data: data ?? null, error: error ?? null };
        }

        const { data, error } = await client
          .from(VERIFICATIONS_TABLE)
          .select(selectColumns)
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<VerificationLookupRow>();
        return { data: data ?? null, error: error ?? null };
      };

      let verificationLookup = await loadVerificationRow(true);
      if (verificationLookup.error && isMissingTableOrColumnError(verificationLookup.error)) {
        verificationLookup = await loadVerificationRow(false);
      }

      if (verificationLookup.error && !isMissingTableOrColumnError(verificationLookup.error)) {
        throw verificationLookup.error;
      }

      const verificationRow = verificationLookup.data;

      if (!verificationRow?.id) {
        return res.status(400).json({
          message:
            "Upload your government ID and utility bill before starting biometric verification.",
        });
      }

      const { data: verificationDocs, error: docsError } = await client
        .from(VERIFICATION_DOCUMENTS_TABLE)
        .select("document_type")
        .eq("verification_id", verificationRow.id);

      if (docsError && !isMissingTableOrColumnError(docsError)) {
        throw docsError;
      }

      const documentTypes = new Set(
        (Array.isArray(verificationDocs) ? verificationDocs : []).map((row) =>
          String((row as { document_type?: string }).document_type ?? "").trim().toLowerCase(),
        ),
      );
      if (!documentTypes.has("identity")) {
        return res.status(400).json({ message: "Government ID upload is required before scan." });
      }
      if (!documentTypes.has("utility_bill")) {
        return res.status(400).json({ message: "Utility bill upload is required before scan." });
      }

      let verificationHomeAddress = String(verificationRow.home_address ?? "").trim();
      if (!verificationHomeAddress) {
        const { data: userHomeAddress, error: userHomeAddressError } = await client
          .from(USERS_TABLE)
          .select("home_address")
          .eq("id", userId)
          .maybeSingle<{ home_address?: string | null }>();

        if (userHomeAddressError && !isMissingTableOrColumnError(userHomeAddressError)) {
          throw userHomeAddressError;
        }
        verificationHomeAddress = String(userHomeAddress?.home_address ?? "").trim();
      }

      if (!verificationHomeAddress) {
        return res.status(400).json({ message: "Home address is required before scan." });
      }

      let resolvedDateOfBirth =
        String(dateOfBirth ?? "").trim() || String(verificationRow.date_of_birth ?? "").trim();
      if (!resolvedDateOfBirth) {
        const { data: userDateOfBirth, error: userDateOfBirthError } = await client
          .from(USERS_TABLE)
          .select("date_of_birth")
          .eq("id", userId)
          .maybeSingle<{ date_of_birth?: string | null }>();

        if (userDateOfBirthError && !isMissingTableOrColumnError(userDateOfBirthError)) {
          throw userDateOfBirthError;
        }
        resolvedDateOfBirth = String(userDateOfBirth?.date_of_birth ?? "").trim();
      }

      const result = await submitSmileIdVerification({
        mode,
        userId,
        country,
        idType,
        idNumber,
        firstName,
        lastName,
        dateOfBirth: resolvedDateOfBirth || undefined,
        selfieImageBase64,
      });

      let linkedToExistingVerification = false;
      if (normalizedVerificationId) {
        const { data: updated, error: updateError } = await client
          .from(VERIFICATIONS_TABLE)
          .update({
            mode,
            provider: result.provider,
            status: result.status,
            job_id: result.jobId,
            smile_job_id: result.smileJobId ?? null,
            message: result.message,
          })
          .eq("id", normalizedVerificationId)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle<{ id: string }>();

        if (updateError && !isMissingTableOrColumnError(updateError)) {
          throw new Error(`Failed to attach Smile result to existing verification: ${updateError.message}`);
        }

        linkedToExistingVerification = Boolean(updated?.id);
      }

      if (!linkedToExistingVerification) {
        await saveVerification({
          user_id: userId,
          mode,
          provider: result.provider,
          status: result.status,
          job_id: result.jobId,
          smile_job_id: result.smileJobId ?? null,
          message: result.message,
        });
      }

      if (result.status === "approved") {
        await setUserVerificationState(userId, true);
      }

      return res.status(200).json({
        ...result,
        verificationId: normalizedVerificationId || undefined,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Verification request failed";

      return res.status(502).json({ message });
    }
  });

  app.get("/api/verification/status/:userId", async (req: Request, res: Response) => {
    try {
      const client = createSupabaseServiceClient();
      if (!client) {
        return res.status(503).json({ message: "Supabase service client is not configured." });
      }

      const authActor = await resolveAuthenticatedActor(client, req);
      if (!authActor) {
        return res.status(401).json({ message: "Missing or invalid bearer token." });
      }

      const userId = String(req.params?.userId ?? "").trim();
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }
      if (userId !== authActor.userId && authActor.role !== "admin") {
        return res.status(403).json({ message: "userId does not match authenticated user." });
      }

      const snapshot = await getUserVerificationSnapshot(userId);
      if (!snapshot) {
        return res.status(200).json({
          userId,
          isVerified: false,
          latestStatus: null,
          latestJobId: null,
          latestSmileJobId: null,
          latestProvider: null,
          latestMessage: null,
          latestUpdatedAt: null,
          userRowFound: false,
        });
      }

      // Keep users.is_verified aligned when verification row is approved.
      if (snapshot.isVerified && !snapshot.userRowFound) {
        // No-op when user row does not exist in this environment.
      } else if (snapshot.isVerified) {
        await setUserVerificationState(userId, true);
      }

      return res.status(200).json(snapshot);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load verification status";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/verification/smile-id/callback", async (req: Request, res: Response) => {
    try {
      if (!verifySmileCallbackSignature(req)) {
        return res.status(401).json({ message: "Invalid callback signature" });
      }

      const payload = toRecord(req.body) ?? {};
      const payloadResult = toRecord(payload.result);
      const payloadData = toRecord(payload.data);
      const partnerParams =
        toRecord(payload.partner_params) ??
        toRecord(payload.partnerParams) ??
        toRecord(payloadData?.partner_params) ??
        toRecord(payloadData?.partnerParams) ??
        toRecord(payloadResult?.partner_params) ??
        toRecord(payloadResult?.partnerParams);

      const jobId = pickString(
        payload.job_id,
        payload.jobId,
        payloadData?.job_id,
        payloadData?.jobId,
        payloadResult?.job_id,
        payloadResult?.jobId,
      );
      const smileJobId = pickString(
        payload.smile_job_id,
        payload.smileJobId,
        payloadData?.smile_job_id,
        payloadData?.smileJobId,
        payloadResult?.smile_job_id,
        payloadResult?.smileJobId,
      );
      const userIdFromCallback = pickString(
        payload.user_id,
        payload.userId,
        payloadData?.user_id,
        payloadData?.userId,
        payloadResult?.user_id,
        payloadResult?.userId,
        partnerParams?.user_id,
        partnerParams?.userId,
      );

      const rawStatus = pickString(
        payload.status,
        payload.verification_status,
        payload.verificationStatus,
        typeof payload.result === "string" ? payload.result : "",
        payloadData?.status,
        payloadData?.verification_status,
        payloadData?.verificationStatus,
        payloadResult?.status,
        payloadResult?.result,
      ).toLowerCase();
      const message =
        pickString(
          payload.message,
          payloadData?.message,
          payloadResult?.message,
        ) || "Smile ID callback received.";

      if (!jobId && !smileJobId && !userIdFromCallback) {
        return res.status(400).json({ message: "Callback identifiers are missing (job_id/smile_job_id/user_id)." });
      }

      const mappedStatus =
        rawStatus.includes("pass") || rawStatus.includes("approve")
          ? "approved"
          : rawStatus.includes("fail") || rawStatus.includes("reject")
            ? "failed"
            : "pending";

      let updatedVerification = await updateVerificationByCallbackIdentifiers(
        {
          jobId,
          smileJobId,
          userId: userIdFromCallback,
        },
        mappedStatus,
        message,
      );

      if (!updatedVerification) {
        return res.status(404).json({ message: "Verification job not found" });
      }

      const resolvedUserId = userIdFromCallback || updatedVerification.userId;
      if (updatedVerification.status === "approved" && resolvedUserId) {
        try {
          await setUserVerificationState(resolvedUserId, true);
        } catch (syncError) {
          const syncMessage = syncError instanceof Error ? syncError.message : String(syncError);
          console.warn(`Smile callback approved but user verification sync failed: ${syncMessage}`);
        }
      }

      return res.status(200).json({
        ok: true,
        idempotent: !updatedVerification.changed,
        status: updatedVerification.status,
        previousStatus: updatedVerification.previousStatus,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Callback processing failed";

      return res.status(502).json({ message });
    }
  });

  return httpServer;
}
