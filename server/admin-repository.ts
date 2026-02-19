import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendConversationMessage, upsertChatConversation } from "./chat-repository";
import { setUserVerificationState } from "./verification-repository";

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

export type UserChatCard = {
  id: string;
  userId: string;
  userName: string;
  title: string;
  message: string;
  problemTag: string;
  status: "unread" | "read";
  createdAt: string;
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

export type NewFlaggedCommentInput = {
  comment: string;
  problemTag: string;
  createdBy: string;
  createdById?: string;
};

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
const VERIFICATIONS_TABLE = process.env.SUPABASE_VERIFICATIONS_TABLE || "verifications";
const VERIFICATION_DOCUMENTS_TABLE =
  process.env.SUPABASE_VERIFICATION_DOCUMENTS_TABLE || "verification_documents";
const VERIFICATION_DOCUMENTS_BUCKET =
  process.env.SUPABASE_VERIFICATION_DOCUMENTS_BUCKET || "verification-documents";
const FLAGGED_LISTINGS_TABLE = process.env.SUPABASE_FLAGGED_LISTINGS_TABLE || "flagged_listings";
const FLAGGED_LISTING_COMMENTS_TABLE =
  process.env.SUPABASE_FLAGGED_LISTING_COMMENTS_TABLE || "flagged_listing_comments";
const ADMIN_CHAT_CARDS_TABLE = process.env.SUPABASE_ADMIN_CHAT_CARDS_TABLE || "admin_chat_cards";
const REVENUE_RECORDS_TABLE = process.env.SUPABASE_REVENUE_RECORDS_TABLE || "revenue_records";
const VERIFICATION_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;

const DEFAULT_IDENTITY_DOC_URL = "/sample-identity.txt";
const DEFAULT_UTILITY_DOC_URL = "/sample-utility-bill.txt";

let fallbackUsers: AdminUserRecord[] = [
  {
    id: "usr_101",
    name: "David Adeleke",
    role: "Buyer",
    email: "david.adeleke@example.com",
    status: "Active",
    joinedAt: "2026-01-03T09:00:00.000Z",
  },
  {
    id: "usr_102",
    name: "Wizkid Balogun",
    role: "Seller",
    email: "wizkid.balogun@example.com",
    status: "Active",
    joinedAt: "2026-01-09T12:00:00.000Z",
  },
  {
    id: "usr_103",
    name: "Adekunle Gold",
    role: "Agent",
    email: "adekunle.gold@example.com",
    status: "Active",
    joinedAt: "2026-01-14T10:30:00.000Z",
  },
  {
    id: "usr_104",
    name: "Simi Kosoko",
    role: "Seller",
    email: "simi.kosoko@example.com",
    status: "Active",
    joinedAt: "2026-01-17T14:00:00.000Z",
  },
  {
    id: "usr_105",
    name: "Burna Boy",
    role: "Seller",
    email: "burna.boy@example.com",
    status: "Suspended",
    joinedAt: "2026-01-20T08:15:00.000Z",
  },
];

let fallbackVerifications: AdminVerificationRecord[] = [
  {
    id: "ver_fallback_1",
    userId: "usr_103",
    user: "Adekunle Gold",
    type: "Agent",
    documents: [
      { name: "Identity", url: DEFAULT_IDENTITY_DOC_URL },
      { name: "Utility Bill", url: DEFAULT_UTILITY_DOC_URL },
    ],
    status: "Awaiting Review",
    createdAt: "2026-01-24T09:00:00.000Z",
  },
  {
    id: "ver_fallback_2",
    userId: "usr_104",
    user: "Simi Kosoko",
    type: "Seller",
    documents: [
      { name: "Identity", url: DEFAULT_IDENTITY_DOC_URL },
      { name: "Utility Bill", url: DEFAULT_UTILITY_DOC_URL },
    ],
    status: "Awaiting Review",
    createdAt: "2026-01-25T11:10:00.000Z",
  },
  {
    id: "ver_fallback_3",
    userId: "usr_105",
    user: "Burna Boy",
    type: "Seller",
    documents: [
      { name: "Identity", url: DEFAULT_IDENTITY_DOC_URL },
      { name: "Utility Bill", url: DEFAULT_UTILITY_DOC_URL },
    ],
    status: "Awaiting Review",
    createdAt: "2026-01-26T16:45:00.000Z",
  },
];

let fallbackFlaggedListings: AdminFlaggedListingRecord[] = [
  {
    id: "flag_fallback_1",
    title: "4 Bedroom Duplex",
    location: "Ikoyi, Lagos",
    reason: "Suspicious document mismatch",
    status: "Cleared",
    affectedUserId: "usr_103",
    affectedUserName: "Adekunle Gold",
    comments: [],
    updatedAt: "2026-01-27T08:00:00.000Z",
  },
  {
    id: "flag_fallback_2",
    title: "Oceanfront Plot",
    location: "Ajah, Lagos",
    reason: "Multiple duplicate submissions",
    status: "Open",
    affectedUserId: "usr_104",
    affectedUserName: "Simi Kosoko",
    comments: [],
    updatedAt: "2026-01-27T09:30:00.000Z",
  },
  {
    id: "flag_fallback_3",
    title: "Commercial Plaza",
    location: "Port Harcourt",
    reason: "Ownership conflict alert",
    status: "Under Review",
    affectedUserId: "usr_105",
    affectedUserName: "Burna Boy",
    comments: [],
    updatedAt: "2026-01-27T11:15:00.000Z",
  },
];

let fallbackRevenueRecords: AdminRevenueRecord[] = [
  {
    id: "rev_1",
    month: "2026-01",
    date: "2026-01-04",
    source: "Property Verification Fees",
    grossAmount: 1250000,
    netRevenue: 1250000,
    status: "Received",
  },
  {
    id: "rev_2",
    month: "2026-01",
    date: "2026-01-11",
    source: "Agent Listing Commission",
    grossAmount: 1100000,
    netRevenue: 1100000,
    status: "Received",
  },
  {
    id: "rev_3",
    month: "2026-01",
    date: "2026-01-17",
    source: "Escrow Processing Fees",
    grossAmount: 900000,
    netRevenue: 900000,
    status: "Received",
  },
  {
    id: "rev_4",
    month: "2026-01",
    date: "2026-01-23",
    source: "KYC Service Charges",
    grossAmount: 600000,
    netRevenue: 600000,
    status: "Pending",
  },
  {
    id: "rev_5",
    month: "2026-01",
    date: "2026-01-29",
    source: "Fraud Report Investigations",
    grossAmount: 350000,
    netRevenue: 350000,
    status: "Received",
  },
];

let fallbackChatCards: UserChatCard[] = [];

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

function mapVerificationStatus(status: string): AdminVerificationStatus {
  const normalized = status.toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "failed" || normalized === "rejected") return "Rejected";
  return "Awaiting Review";
}

function toDbVerificationStatus(status: AdminVerificationStatus): "approved" | "pending" | "failed" {
  if (status === "Approved") return "approved";
  if (status === "Rejected") return "failed";
  return "pending";
}

function mapFlaggedStatus(status: string): AdminFlaggedListingStatus {
  const normalized = status.toLowerCase();
  if (normalized === "cleared") return "Cleared";
  if (normalized === "under_review" || normalized === "under review") return "Under Review";
  return "Open";
}

function toDbFlaggedStatus(status: AdminFlaggedListingStatus): "open" | "under_review" | "cleared" {
  if (status === "Under Review") return "under_review";
  if (status === "Cleared") return "cleared";
  return "open";
}

function mapRole(rawRole: unknown, username: string): "Buyer" | "Seller" | "Agent" {
  if (typeof rawRole === "string") {
    const normalized = rawRole.toLowerCase();
    if (normalized.includes("agent")) return "Agent";
    if (normalized.includes("seller") || normalized.includes("owner")) return "Seller";
    if (normalized.includes("renter")) return "Buyer";
  }

  const normalizedName = username.toLowerCase();
  if (normalizedName.includes("agent")) return "Agent";
  if (normalizedName.includes("seller")) return "Seller";

  return "Buyer";
}

function mapUserStatus(rawStatus: unknown): "Active" | "Suspended" {
  if (typeof rawStatus === "string" && rawStatus.toLowerCase().includes("suspend")) {
    return "Suspended";
  }
  return "Active";
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatCompactNaira(value: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function defaultDocuments(): AdminVerificationDocument[] {
  return [
    { name: "Identity", url: DEFAULT_IDENTITY_DOC_URL },
    { name: "Utility Bill", url: DEFAULT_UTILITY_DOC_URL },
  ];
}

function buildRevenueTrend(records: AdminRevenueRecord[]): AdminRevenueTrendPoint[] {
  const grouped = new Map<string, number>();

  for (const record of records) {
    const label = new Date(record.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    grouped.set(label, (grouped.get(label) ?? 0) + record.netRevenue);
  }

  return Array.from(grouped.entries()).map(([label, amount]) => ({ label, amount }));
}

async function fetchUsersFromSupabase(client: SupabaseClient): Promise<AdminUserRecord[]> {
  const { data, error } = await client.from(USERS_TABLE).select("*").order("created_at", {
    ascending: false,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows.map((row) => {
    const username = typeof row.username === "string" ? row.username : "user";
    return {
      id: String(row.id ?? randomUUID()),
      name: typeof row.full_name === "string" && row.full_name.trim() ? row.full_name : username,
      role: mapRole(row.role, username),
      email:
        typeof row.email === "string" && row.email.trim()
          ? row.email
          : `${username.toLowerCase().replace(/\s+/g, ".")}@justicecity.local`,
      status: mapUserStatus(row.status),
      joinedAt:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at
          : new Date().toISOString(),
    } satisfies AdminUserRecord;
  });
}

async function fetchVerificationDocuments(
  client: SupabaseClient,
): Promise<Map<string, AdminVerificationDocument[]>> {
  const { data, error } = await client.from(VERIFICATION_DOCUMENTS_TABLE).select("*");

  if (error) {
    if (isTableMissingError(error)) return new Map<string, AdminVerificationDocument[]>();
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const docsByVerificationId = new Map<string, AdminVerificationDocument[]>();

  for (const row of rows) {
    const verificationId = String(row.verification_id ?? "");
    if (!verificationId) continue;

    const bucketId = String(row.bucket_id ?? VERIFICATION_DOCUMENTS_BUCKET).trim() || VERIFICATION_DOCUMENTS_BUCKET;
    const storagePath = String(row.storage_path ?? "").trim();
    let resolvedUrl =
      typeof row.document_url === "string" && row.document_url.trim()
        ? row.document_url
        : DEFAULT_IDENTITY_DOC_URL;

    if (storagePath) {
      const { data: signedData, error: signedError } = await client.storage
        .from(bucketId)
        .createSignedUrl(storagePath, VERIFICATION_DOCUMENT_SIGNED_URL_TTL_SECONDS);

      if (!signedError && signedData?.signedUrl) {
        resolvedUrl = String(signedData.signedUrl);
      } else {
        resolvedUrl = storagePath;
      }
    }

    const currentDocs = docsByVerificationId.get(verificationId) ?? [];
    currentDocs.push({
      name: String(row.document_type ?? "Identity"),
      url: resolvedUrl,
    });
    docsByVerificationId.set(verificationId, currentDocs);
  }

  return docsByVerificationId;
}

async function fetchVerificationsFromSupabase(
  client: SupabaseClient,
  users: AdminUserRecord[],
): Promise<AdminVerificationRecord[]> {
  const { data, error } = await client.from(VERIFICATIONS_TABLE).select("*").order("created_at", {
    ascending: false,
  });

  if (error) throw error;

  const userLookup = new Map(users.map((user) => [user.id, user.name]));
  const docsByVerificationId = await fetchVerificationDocuments(client);
  const rows = Array.isArray(data) ? data : [];

  return rows.map((row) => {
    const id = String(row.id ?? row.job_id ?? randomUUID());
    const userId = String(row.user_id ?? "unknown_user");
    const mode = String(row.mode ?? "kyc").toLowerCase();
    const type: "Agent" | "Seller" = mode === "biometric" ? "Agent" : "Seller";
    const docs = docsByVerificationId.get(id);

    return {
      id,
      userId,
      user: userLookup.get(userId) ?? userId,
      type,
      documents: docs && docs.length > 0 ? docs : defaultDocuments(),
      status: mapVerificationStatus(String(row.status ?? "pending")),
      createdAt:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at
          : new Date().toISOString(),
    } satisfies AdminVerificationRecord;
  });
}

async function fetchFlaggedListingComments(
  client: SupabaseClient,
): Promise<Map<string, AdminFlaggedListingComment[]>> {
  const { data, error } = await client
    .from(FLAGGED_LISTING_COMMENTS_TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (isTableMissingError(error)) return new Map<string, AdminFlaggedListingComment[]>();
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const commentsByListingId = new Map<string, AdminFlaggedListingComment[]>();

  for (const row of rows) {
    const listingId = String(row.flagged_listing_id ?? "");
    if (!listingId) continue;

    const existing = commentsByListingId.get(listingId) ?? [];
    existing.push({
      id: String(row.id ?? randomUUID()),
      listingId,
      comment: String(row.comment ?? ""),
      problemTag: String(row.problem_tag ?? "General"),
      createdBy: String(row.created_by ?? "Admin"),
      createdAt:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at
          : new Date().toISOString(),
      sentToChat: true,
    });
    commentsByListingId.set(listingId, existing);
  }

  return commentsByListingId;
}

async function fetchFlaggedListingsFromSupabase(
  client: SupabaseClient,
): Promise<AdminFlaggedListingRecord[]> {
  const { data, error } = await client.from(FLAGGED_LISTINGS_TABLE).select("*").order("updated_at", {
    ascending: false,
  });

  if (error) {
    if (isTableMissingError(error)) return fallbackFlaggedListings;
    throw error;
  }

  const commentsByListingId = await fetchFlaggedListingComments(client);
  const rows = Array.isArray(data) ? data : [];

  return rows.map((row) => {
    const id = String(row.id ?? randomUUID());
    return {
      id,
      title: String(row.listing_title ?? "Untitled Listing"),
      location: String(row.location ?? "Unknown"),
      reason: String(row.issue_reason ?? "Needs admin review"),
      status: mapFlaggedStatus(String(row.status ?? "open")),
      affectedUserId: String(row.affected_user_id ?? "unknown_user"),
      affectedUserName: String(row.affected_user_name ?? row.affected_user_id ?? "Unknown User"),
      comments: commentsByListingId.get(id) ?? [],
      updatedAt:
        typeof row.updated_at === "string" && row.updated_at.trim()
          ? row.updated_at
          : new Date().toISOString(),
    } satisfies AdminFlaggedListingRecord;
  });
}

async function fetchRevenueRecordsFromSupabase(client: SupabaseClient): Promise<AdminRevenueRecord[]> {
  const { data, error } = await client.from(REVENUE_RECORDS_TABLE).select("*").order("record_date", {
    ascending: true,
  });

  if (error) {
    if (isTableMissingError(error)) return fallbackRevenueRecords;
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];

  return rows.map((row) => ({
    id: String(row.id ?? randomUUID()),
    month: String(row.month ?? ""),
    date:
      typeof row.record_date === "string" && row.record_date.trim()
        ? row.record_date
        : new Date().toISOString().slice(0, 10),
    source: String(row.source ?? "Platform Revenue"),
    grossAmount: parseNumber(row.gross_amount),
    netRevenue: parseNumber(row.net_revenue),
    status: String(row.status ?? "received").toLowerCase().includes("pending")
      ? "Pending"
      : "Received",
  }));
}

function buildOverview(
  users: AdminUserRecord[],
  verifications: AdminVerificationRecord[],
  flaggedListings: AdminFlaggedListingRecord[],
  revenueRecords: AdminRevenueRecord[],
): AdminDashboardData["overview"] {
  const januaryMonth = `${new Date().getFullYear()}-01`;
  const januaryRevenue = revenueRecords
    .filter((record) => record.month === januaryMonth || record.date.startsWith(januaryMonth))
    .reduce((sum, record) => sum + record.netRevenue, 0);

  const effectiveJanuaryRevenue =
    januaryRevenue > 0
      ? januaryRevenue
      : revenueRecords.reduce((sum, record) => sum + record.netRevenue, 0);

  return {
    commissionRate: 5.0,
    totalUsers: users.length,
    pendingVerifications: verifications.filter((item) => item.status === "Awaiting Review").length,
    flaggedListings: flaggedListings.filter((item) => item.status !== "Cleared").length,
    revenueJanLabel: formatCompactNaira(effectiveJanuaryRevenue),
  };
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const client = getClient();

  if (!client) {
    const overview = buildOverview(
      fallbackUsers,
      fallbackVerifications,
      fallbackFlaggedListings,
      fallbackRevenueRecords,
    );
    return {
      overview,
      users: fallbackUsers,
      verifications: fallbackVerifications,
      flaggedListings: fallbackFlaggedListings,
      revenue: {
        records: fallbackRevenueRecords,
        trend: buildRevenueTrend(fallbackRevenueRecords),
      },
    };
  }

  try {
    const users = await fetchUsersFromSupabase(client);
    const verifications = await fetchVerificationsFromSupabase(client, users);
    const flaggedListings = await fetchFlaggedListingsFromSupabase(client);
    const revenueRecords = await fetchRevenueRecordsFromSupabase(client);
    const overview = buildOverview(users, verifications, flaggedListings, revenueRecords);

    return {
      overview,
      users,
      verifications,
      flaggedListings,
      revenue: {
        records: revenueRecords,
        trend: buildRevenueTrend(revenueRecords),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Admin dashboard query failed: ${message}`);
  }
}

export async function setVerificationStatus(
  verificationId: string,
  status: AdminVerificationStatus,
): Promise<void> {
  const client = getClient();

  if (!client) {
    fallbackVerifications = fallbackVerifications.map((item) =>
      item.id === verificationId ? { ...item, status } : item,
    );
    return;
  }

  const nextStatus = toDbVerificationStatus(status);
  const { data, error } = await client
    .from(VERIFICATIONS_TABLE)
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", verificationId)
    .select("user_id")
    .maybeSingle<{ user_id?: string | null }>();

  if (error) {
    if (isTableMissingError(error)) {
      fallbackVerifications = fallbackVerifications.map((item) =>
        item.id === verificationId ? { ...item, status } : item,
      );
      return;
    }
    throw new Error(`Failed to update verification status: ${error.message}`);
  }

  if (nextStatus === "approved") {
    const userId = String(data?.user_id ?? "").trim();
    if (userId) {
      await setUserVerificationState(userId, true);
    }
  }
}

export async function setFlaggedListingStatus(
  listingId: string,
  status: AdminFlaggedListingStatus,
): Promise<void> {
  const client = getClient();

  if (!client) {
    fallbackFlaggedListings = fallbackFlaggedListings.map((item) =>
      item.id === listingId
        ? { ...item, status, updatedAt: new Date().toISOString() }
        : item,
    );
    return;
  }

  const { error } = await client
    .from(FLAGGED_LISTINGS_TABLE)
    .update({
      status: toDbFlaggedStatus(status),
      updated_at: new Date().toISOString(),
    })
    .eq("id", listingId);

  if (error) {
    if (isTableMissingError(error)) {
      fallbackFlaggedListings = fallbackFlaggedListings.map((item) =>
        item.id === listingId
          ? { ...item, status, updatedAt: new Date().toISOString() }
          : item,
      );
      return;
    }
    throw new Error(`Failed to update flagged listing status: ${error.message}`);
  }
}

export async function addFlaggedListingComment(
  listingId: string,
  payload: NewFlaggedCommentInput,
): Promise<AdminFlaggedListingComment> {
  const newComment: AdminFlaggedListingComment = {
    id: randomUUID(),
    listingId,
    comment: payload.comment.trim(),
    problemTag: payload.problemTag.trim(),
    createdBy: payload.createdBy.trim() || "Admin",
    createdAt: new Date().toISOString(),
    sentToChat: true,
  };

  const client = getClient();
  if (!client) {
    const fallbackListing = fallbackFlaggedListings.find((item) => item.id === listingId);
    const affectedUserId = fallbackListing?.affectedUserId ?? "unknown_user";
    const affectedUserName = fallbackListing?.affectedUserName ?? "User";
    const listingTitle = fallbackListing?.title ?? "Property Listing";

    if (affectedUserId && affectedUserId !== "unknown_user") {
      try {
        const adminDisplayName = payload.createdBy.trim() || "Justice City Admin";
        const adminIdSeed = String(payload.createdById ?? "").trim();
        const adminId =
          adminIdSeed || `admin_${adminDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

        const upserted = await upsertChatConversation({
          requesterId: adminId,
          requesterName: adminDisplayName,
          requesterRole: "admin",
          recipientId: affectedUserId,
          recipientName: affectedUserName,
          subject: `Issue Review: ${listingTitle}`,
          conversationScope: "support",
        });

        await sendConversationMessage({
          conversationId: upserted.conversation.id,
          senderId: upserted.requester.id,
          senderName: upserted.requester.name,
          senderRole: "admin",
          messageType: "issue_card",
          content: newComment.comment,
          metadata: {
            issueCard: {
              title: `Issue update: ${listingTitle}`,
              message: newComment.comment,
              problemTag: newComment.problemTag,
              status: "open",
              listingId,
              listingTitle,
            },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`Fallback issue card chat delivery failed for listing ${listingId}: ${message}`);
      }
    }

    fallbackChatCards.unshift({
      id: randomUUID(),
      userId: affectedUserId,
      userName: affectedUserName,
      title: `Issue update: ${listingTitle}`,
      message: newComment.comment,
      problemTag: newComment.problemTag,
      status: "unread",
      createdAt: new Date().toISOString(),
    });

    fallbackFlaggedListings = fallbackFlaggedListings.map((item) =>
      item.id === listingId ? { ...item, comments: [newComment, ...item.comments] } : item,
    );
    return newComment;
  }

  const { error: commentError } = await client.from(FLAGGED_LISTING_COMMENTS_TABLE).insert({
    id: newComment.id,
    flagged_listing_id: listingId,
    comment: newComment.comment,
    problem_tag: newComment.problemTag,
    created_by: newComment.createdBy,
  });

  if (commentError && !isTableMissingError(commentError)) {
    throw new Error(`Failed to create listing comment: ${commentError.message}`);
  }

  const { data: listingData } = await client
    .from(FLAGGED_LISTINGS_TABLE)
    .select("listing_title, affected_user_id, affected_user_name")
    .eq("id", listingId)
    .maybeSingle();

  const listingTitle = String(listingData?.listing_title ?? "Property Listing");
  const affectedUserId = String(listingData?.affected_user_id ?? "unknown_user");
  const affectedUserName = String(listingData?.affected_user_name ?? "User");

  if (affectedUserId && affectedUserId !== "unknown_user") {
    try {
      const adminDisplayName = payload.createdBy.trim() || "Justice City Admin";
      const adminIdSeed = String(payload.createdById ?? "").trim();
      const adminId =
        adminIdSeed || `admin_${adminDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

      const upserted = await upsertChatConversation({
        requesterId: adminId,
        requesterName: adminDisplayName,
        requesterRole: "admin",
        recipientId: affectedUserId,
        recipientName: affectedUserName,
        subject: `Issue Review: ${listingTitle}`,
        conversationScope: "support",
      });

      await sendConversationMessage({
        conversationId: upserted.conversation.id,
        senderId: upserted.requester.id,
        senderName: upserted.requester.name,
        senderRole: "admin",
        messageType: "issue_card",
        content: newComment.comment,
        metadata: {
          issueCard: {
            title: `Issue update: ${listingTitle}`,
            message: newComment.comment,
            problemTag: newComment.problemTag,
            status: "open",
            listingId,
            listingTitle,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn(`Issue card chat delivery failed for listing ${listingId}: ${message}`);
    }
  }

  const { error: chatCardError } = await client.from(ADMIN_CHAT_CARDS_TABLE).insert({
    user_id: affectedUserId,
    user_name: affectedUserName,
    title: `Issue update: ${listingTitle}`,
    message: newComment.comment,
    problem_tag: newComment.problemTag,
    status: "unread",
  });

  if (chatCardError && !isTableMissingError(chatCardError)) {
    throw new Error(`Failed to send in-app chat card: ${chatCardError.message}`);
  }

  if (commentError && isTableMissingError(commentError)) {
    fallbackChatCards.unshift({
      id: randomUUID(),
      userId: affectedUserId,
      userName: affectedUserName,
      title: `Issue update: ${listingTitle}`,
      message: newComment.comment,
      problemTag: newComment.problemTag,
      status: "unread",
      createdAt: new Date().toISOString(),
    });

    fallbackFlaggedListings = fallbackFlaggedListings.map((item) =>
      item.id === listingId ? { ...item, comments: [newComment, ...item.comments] } : item,
    );
  }

  return newComment;
}

export async function getUserChatCards(userId: string): Promise<UserChatCard[]> {
  const client = getClient();

  if (!client) {
    return fallbackChatCards.filter((item) => item.userId === userId);
  }

  const { data, error } = await client
    .from(ADMIN_CHAT_CARDS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isTableMissingError(error)) {
      return fallbackChatCards.filter((item) => item.userId === userId);
    }
    throw new Error(`Failed to load user chat cards: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => ({
    id: String(row.id ?? randomUUID()),
    userId: String(row.user_id ?? userId),
    userName: String(row.user_name ?? "User"),
    title: String(row.title ?? "Issue update"),
    message: String(row.message ?? ""),
    problemTag: String(row.problem_tag ?? "General"),
    status: String(row.status ?? "unread").toLowerCase().includes("read") ? "read" : "unread",
    createdAt:
      typeof row.created_at === "string" && row.created_at.trim()
        ? row.created_at
        : new Date().toISOString(),
  }));
}
