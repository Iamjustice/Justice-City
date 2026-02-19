import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { submitSmileIdVerification } from "./smile-id";
import {
  getUserVerificationSnapshot,
  saveVerification,
  setUserVerificationState,
  updateVerificationByJobId,
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
  updateAgentListing,
  updateAgentListingPayoutStatus,
  updateAgentListingStatus,
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
import { uploadVerificationDocument } from "./verification-documents-repository";
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
  email: string;
  role: AppUserRole;
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
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

  const { data: userRow, error: userError } = await client
    .from(USERS_TABLE)
    .select("id, full_name, email, role, is_verified, email_verified, phone_verified, avatar_url")
    .eq("id", authUser.id)
    .maybeSingle<{
      id: string;
      full_name?: string | null;
      email?: string | null;
      role?: string | null;
      is_verified?: boolean | null;
      email_verified?: boolean | null;
      phone_verified?: boolean | null;
      avatar_url?: string | null;
    }>();

  if (userError && !isMissingTableOrColumnError(userError)) {
    throw userError;
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

  const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  const email = String(userRow?.email ?? authUser.email ?? "").trim();
  const role = userRow?.role
    ? normalizeUserRole(userRow.role, { allowAdmin: true })
    : normalizeUserRole(metadata.role);
  const name =
    String(userRow?.full_name ?? metadata.full_name ?? metadata.name ?? "").trim() ||
    email.split("@")[0] ||
    "User";
  const avatar =
    String(userRow?.avatar_url ?? metadata.avatar_url ?? metadata.picture ?? "").trim() || undefined;

  return {
    id: String(authUser.id),
    name,
    email,
    role,
    isVerified: Boolean(userRow?.is_verified),
    emailVerified: Boolean(userRow?.email_verified) || emailConfirmedFromAuth,
    phoneVerified: Boolean(userRow?.phone_verified),
    avatar,
  };
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

  if (configuredPrefix) {
    const lowerSignature = signature.toLowerCase();
    const lowerPrefix = configuredPrefix.toLowerCase();
    if (lowerSignature.startsWith(lowerPrefix)) {
      signature = signature.slice(configuredPrefix.length);
    }
  }

  // Common callback signature format prefix.
  if (signature.toLowerCase().startsWith("sha256=")) {
    signature = signature.slice("sha256=".length);
  }

  return signature.trim().toLowerCase();
}

function verifySmileCallbackSignature(req: Request): boolean {
  const secret = String(process.env.SMILE_ID_CALLBACK_SECRET ?? "").trim();
  if (!secret) return true;

  const headerName = String(
    process.env.SMILE_ID_CALLBACK_SIGNATURE_HEADER ?? "x-smile-signature",
  )
    .trim()
    .toLowerCase();
  const configuredPrefix = String(process.env.SMILE_ID_CALLBACK_SIGNATURE_PREFIX ?? "").trim();

  const headerValue = req.headers[headerName];
  const rawSignature = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof rawSignature !== "string" || !rawSignature.trim()) return false;

  const providedHex = normalizeSignature(rawSignature, configuredPrefix);
  if (!/^[a-f0-9]+$/i.test(providedHex)) return false;

  const expectedHex = createHmac("sha256", secret).update(getRequestRawBody(req)).digest("hex");

  const providedBuffer = Buffer.from(providedHex, "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
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
      const updates: Record<string, unknown> = {};

      if (typeof fullNameRaw === "string") {
        const fullName = fullNameRaw.trim();
        updates.full_name = fullName.length > 0 ? fullName : null;
      }
      if (typeof avatarUrlRaw === "string") {
        const avatarUrl = avatarUrlRaw.trim();
        updates.avatar_url = avatarUrl.length > 0 ? avatarUrl : null;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await client
          .from(USERS_TABLE)
          .update(updates)
          .eq("id", authUser.id);
        if (updateError && !isMissingTableOrColumnError(updateError)) {
          throw updateError;
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

  app.get("/api/agent/listings", async (req: Request, res: Response) => {
    try {
      const actorId = String(req.query?.actorId ?? "").trim();
      const actorRole = String(req.query?.actorRole ?? "").trim();
      const actorName = String(req.query?.actorName ?? "").trim();

      if (!actorId) {
        return res.status(400).json({ message: "actorId is required" });
      }

      const rows = await listAgentListings({
        actorId,
        actorRole: actorRole || undefined,
        actorName: actorName || undefined,
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
      const actorId = String(req.body?.actorId ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "").trim();
      const actorName = String(req.body?.actorName ?? "").trim();
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

      if (!actorId) {
        return res.status(400).json({ message: "actorId is required" });
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
          actorId,
          actorRole: actorRole || undefined,
          actorName: actorName || undefined,
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

  app.patch("/api/agent/listings/:listingId", async (req: Request, res: Response) => {
    try {
      const listingId = String(req.params?.listingId ?? "").trim();
      const actorId = String(req.body?.actorId ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "").trim();
      const actorName = String(req.body?.actorName ?? "").trim();
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

      if (!actorId) {
        return res.status(400).json({ message: "actorId is required" });
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
          actorId,
          actorRole: actorRole || undefined,
          actorName: actorName || undefined,
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
      const listingId = String(req.params?.listingId ?? "").trim();
      const actorId = String(req.body?.actorId ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "").trim();
      const actorName = String(req.body?.actorName ?? "").trim();

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      if (!actorId) {
        return res.status(400).json({ message: "actorId is required" });
      }

      const result = await deleteAgentListing(listingId, {
        actorId,
        actorRole: actorRole || undefined,
        actorName: actorName || undefined,
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
      const listingId = String(req.params?.listingId ?? "").trim();
      const actorId = String(req.body?.actorId ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "").trim();
      const actorName = String(req.body?.actorName ?? "").trim();
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

      if (!actorId) {
        return res.status(400).json({ message: "actorId is required" });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "status must be one of: Draft, Pending Review, Published, Archived, Sold, Rented",
        });
      }

      const updated = await updateAgentListingStatus(listingId, status, {
        actorId,
        actorRole: actorRole || undefined,
        actorName: actorName || undefined,
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

  app.patch("/api/agent/listings/:listingId/payout", async (req: Request, res: Response) => {
    try {
      const listingId = String(req.params?.listingId ?? "").trim();
      const actorId = String(req.body?.actorId ?? "").trim();
      const actorRole = String(req.body?.actorRole ?? "").trim();
      const actorName = String(req.body?.actorName ?? "").trim();
      const payoutStatus = String(req.body?.payoutStatus ?? "").trim() as AgentPayoutStatus;
      const allowedStatuses: AgentPayoutStatus[] = ["Pending", "Paid"];

      if (!listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      if (!actorId) {
        return res.status(400).json({ message: "actorId is required" });
      }

      if (!allowedStatuses.includes(payoutStatus)) {
        return res.status(400).json({ message: "payoutStatus must be one of: Pending, Paid" });
      }

      const updated = await updateAgentListingPayoutStatus(listingId, payoutStatus, {
        actorId,
        actorRole: actorRole || undefined,
        actorName: actorName || undefined,
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
      const userId = String(req.body?.userId ?? "").trim();
      const documentType = String(req.body?.documentType ?? "identity").trim();
      const fileName = String(req.body?.fileName ?? "").trim();
      const mimeType = String(req.body?.mimeType ?? "").trim();
      const contentBase64 = String(req.body?.contentBase64 ?? "").trim();
      const verificationId = String(req.body?.verificationId ?? "").trim();
      const fileSizeRaw = req.body?.fileSizeBytes;
      const fileSizeBytes =
        typeof fileSizeRaw === "number" && Number.isFinite(fileSizeRaw)
          ? Math.max(0, Math.trunc(fileSizeRaw))
          : undefined;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }
      if (!fileName) {
        return res.status(400).json({ message: "fileName is required" });
      }
      if (!contentBase64) {
        return res.status(400).json({ message: "contentBase64 is required" });
      }

      const uploaded = await uploadVerificationDocument({
        userId,
        documentType,
        fileName,
        mimeType: mimeType || undefined,
        fileSizeBytes,
        contentBase64,
        verificationId: verificationId || undefined,
      });

      return res.status(201).json(uploaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload verification document";
      return res.status(502).json({ message });
    }
  });

  app.post("/api/verification/smile-id", async (req: Request, res: Response) => {
    try {
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

      if (mode !== "kyc" && mode !== "biometric") {
        return res
          .status(400)
          .json({ message: "mode must be either 'kyc' or 'biometric'" });
      }

      const result = await submitSmileIdVerification({
        mode,
        userId,
        country,
        idType,
        idNumber,
        firstName,
        lastName,
        dateOfBirth,
        selfieImageBase64,
      });

      let linkedToExistingVerification = false;
      const normalizedVerificationId = String(verificationId ?? "").trim();
      if (normalizedVerificationId) {
        const client = createSupabaseServiceClient();
        if (client) {
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
      const userId = String(req.params?.userId ?? "").trim();
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
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

      const payload = (req.body ?? {}) as Record<string, unknown>;

      const jobId = String(payload.job_id ?? payload.jobId ?? "");
      const status = String(payload.status ?? payload.result ?? "pending").toLowerCase();
      const message =
        typeof payload.message === "string" ? payload.message : "Smile ID callback received.";

      if (!jobId) {
        return res.status(400).json({ message: "job_id is required" });
      }

      const mappedStatus =
        status.includes("pass") || status.includes("approve")
          ? "approved"
          : status.includes("fail") || status.includes("reject")
            ? "failed"
            : "pending";

      const updatedVerification = await updateVerificationByJobId(jobId, mappedStatus, message);
      if (!updatedVerification) {
        return res.status(404).json({ message: "Verification job not found" });
      }

      if (updatedVerification.status === "approved") {
        const userIdFromCallback = String(payload.user_id ?? payload.userId ?? "").trim();
        const resolvedUserId = userIdFromCallback || updatedVerification?.userId || "";
        await setUserVerificationState(resolvedUserId, true);
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
