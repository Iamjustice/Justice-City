import { createHash, randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { closeListingConversations } from "./chat-repository";

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || "users";
const LISTINGS_TABLE = process.env.SUPABASE_LISTINGS_TABLE || "listings";
const LISTING_COMMISSIONS_TABLE =
  process.env.SUPABASE_LISTING_COMMISSIONS_TABLE || "listing_commissions";
const LISTING_RECORD_FOLDERS_TABLE =
  process.env.SUPABASE_LISTING_RECORD_FOLDERS_TABLE || "listing_record_folders";

const FORBIDDEN_PREFIX = "FORBIDDEN:";

const TOTAL_COMMISSION_RATE = 0.05;
const AGENT_COMMISSION_SHARE = 0.6;
const COMPANY_COMMISSION_SHARE = 0.4;

type DbListingStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "rejected"
  | "archived"
  | "sold"
  | "rented";
type DbPayoutStatus = "pending" | "processing" | "paid";

export type AgentListingStatus =
  | "Draft"
  | "Pending Review"
  | "Published"
  | "Archived"
  | "Sold"
  | "Rented";

export type AgentPayoutStatus = "Pending" | "Paid";

export type AgentListingRecord = {
  id: string;
  agentId?: string;
  title: string;
  listingType: "Sale" | "Rent";
  location: string;
  description: string;
  status: AgentListingStatus;
  views: number;
  inquiries: number;
  price: string;
  date: string;
  dealAmount?: number;
  totalCommission?: number;
  agentCommission?: number;
  companyCommission?: number;
  agentPayoutStatus?: AgentPayoutStatus;
  closedAt?: string;
};

type FallbackListingRecord = AgentListingRecord & { agentId: string };

type ListingActionActor = {
  actorId: string;
  actorRole?: string;
  actorName?: string;
};

export type UpsertAgentListingInput = {
  title: string;
  listingType: "Sale" | "Rent";
  location: string;
  description?: string;
  price: string | number;
  status?: AgentListingStatus;
};

export type DeleteAgentListingResult = {
  ok: true;
  listingId: string;
};

type ListingCommissionRow = {
  listing_id: string;
  close_amount: number | string | null;
  total_commission: number | string | null;
  agent_commission: number | string | null;
  company_commission: number | string | null;
  agent_payout_status: string | null;
  closed_at: string | null;
};

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
  return String(error.message).toLowerCase().includes("column") &&
    String(error.message).toLowerCase().includes("does not exist");
}

function isDuplicateError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return String(error.message ?? "").toLowerCase().includes("duplicate key");
}

function throwForbidden(message: string): never {
  throw new Error(`${FORBIDDEN_PREFIX} ${message}`);
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

function normalizeRole(rawRole: string | undefined): string {
  const role = String(rawRole ?? "")
    .trim()
    .toLowerCase();

  if (!role) return "buyer";
  if (role.includes("admin")) return "admin";
  if (role.includes("agent")) return "agent";
  if (role.includes("owner")) return "owner";
  if (role.includes("rent")) return "renter";
  if (role.includes("seller")) return "seller";
  return "buyer";
}

function toDbRole(rawRole: string | undefined): "buyer" | "seller" | "agent" | "admin" | "owner" | "renter" {
  const normalized = normalizeRole(rawRole);
  if (normalized === "admin") return "admin";
  if (normalized === "agent") return "agent";
  if (normalized === "owner") return "owner";
  if (normalized === "renter") return "renter";
  if (normalized === "seller") return "seller";
  return "buyer";
}

function isAdminRole(rawRole: string | undefined): boolean {
  return normalizeRole(rawRole) === "admin";
}

function canCreateListing(rawRole: string | undefined): boolean {
  const role = normalizeRole(rawRole);
  return role === "admin" || role === "agent" || role === "seller" || role === "owner";
}

function sanitizeUsername(displayName: string, userId: string): string {
  const safeName = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = userId.replace(/-/g, "").slice(0, 10);
  const prefix = safeName.length > 0 ? safeName.slice(0, 20) : "listing_user";
  return `${prefix}_${suffix}`;
}

function toUiStatus(status: DbListingStatus | string): AgentListingStatus {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "published") return "Published";
  if (normalized === "pending_review") return "Pending Review";
  if (normalized === "archived") return "Archived";
  if (normalized === "sold") return "Sold";
  if (normalized === "rented") return "Rented";
  return "Draft";
}

function toDbStatus(status: AgentListingStatus | string): DbListingStatus {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "published") return "published";
  if (normalized === "pending review" || normalized === "pending_review") return "pending_review";
  if (normalized === "archived") return "archived";
  if (normalized === "sold") return "sold";
  if (normalized === "rented") return "rented";
  return "draft";
}

function assertStatusChangeAllowedForActor(
  nextStatus: DbListingStatus,
  options: {
    isAdmin: boolean;
    currentStatus?: DbListingStatus | null;
  },
): void {
  if (options.isAdmin) return;

  const currentStatus = options.currentStatus ?? null;

  if (nextStatus === "published" && currentStatus !== "published") {
    throwForbidden("Only admins can approve and publish listings.");
  }

  if (
    (nextStatus === "sold" || nextStatus === "rented") &&
    currentStatus !== "published" &&
    currentStatus !== "sold" &&
    currentStatus !== "rented"
  ) {
    throwForbidden("Only published listings can be marked as sold or rented.");
  }
}

function toUiListingType(value: string | null | undefined): "Sale" | "Rent" {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "rent"
    ? "Rent"
    : "Sale";
}

function toDbListingType(value: "Sale" | "Rent" | string): "sale" | "rent" {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "rent"
    ? "rent"
    : "sale";
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parsePriceInput(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[^\d.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPrice(
  amount: unknown,
  listingType: "Sale" | "Rent",
  priceSuffixRaw?: string | null,
): string {
  const numeric = Math.max(parseNumber(amount), 0);
  const formatted = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(numeric);
  const explicitSuffix = String(priceSuffixRaw ?? "").trim();
  const suffix = explicitSuffix || (listingType === "Rent" ? "/yr" : "");
  return `N${formatted}${suffix}`;
}

function formatListingDate(value: unknown): string {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) return new Date().toLocaleDateString("en-US");
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toUiPayoutStatus(rawStatus: unknown): AgentPayoutStatus {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "paid") return "Paid";
  return "Pending";
}

function toDbPayoutStatus(rawStatus: AgentPayoutStatus | string): DbPayoutStatus {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "paid") return "paid";
  return "pending";
}

function buildCommissionFallbackFromPrice(price: string): {
  dealAmount: number;
  totalCommission: number;
  agentCommission: number;
  companyCommission: number;
} {
  const numeric = parseNumber(price.replace(/[^\d.]/g, ""));
  const totalCommission = numeric * TOTAL_COMMISSION_RATE;
  return {
    dealAmount: numeric,
    totalCommission,
    agentCommission: totalCommission * AGENT_COMMISSION_SHARE,
    companyCommission: totalCommission * COMPANY_COMMISSION_SHARE,
  };
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
    password: "listing_placeholder_password",
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
    if (isTableMissingError(error)) return null;
    throw error;
  }

  if (!data) return null;
  return String(data.role ?? "");
}

async function fetchListingCommissions(
  client: SupabaseClient,
  listingIds: string[],
): Promise<Map<string, ListingCommissionRow>> {
  if (listingIds.length === 0) return new Map<string, ListingCommissionRow>();

  const { data, error } = await client
    .from(LISTING_COMMISSIONS_TABLE)
    .select(
      "listing_id, close_amount, total_commission, agent_commission, company_commission, agent_payout_status, closed_at",
    )
    .in("listing_id", listingIds);

  if (error) {
    if (isTableMissingError(error)) return new Map<string, ListingCommissionRow>();
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const byListingId = new Map<string, ListingCommissionRow>();
  for (const row of rows) {
    const listingId = String(row.listing_id ?? "");
    if (!listingId) continue;
    byListingId.set(listingId, {
      listing_id: listingId,
      close_amount: row.close_amount as number | string | null,
      total_commission: row.total_commission as number | string | null,
      agent_commission: row.agent_commission as number | string | null,
      company_commission: row.company_commission as number | string | null,
      agent_payout_status: row.agent_payout_status as string | null,
      closed_at: row.closed_at as string | null,
    });
  }

  return byListingId;
}

function mapDbListingToRecord(
  row: Record<string, unknown>,
  commission?: ListingCommissionRow,
): AgentListingRecord {
  const listingType = toUiListingType(String(row.listing_type ?? "sale"));
  const status = toUiStatus(String(row.status ?? "draft"));
  const price = formatPrice(row.price, listingType, String(row.price_suffix ?? ""));
  const mapped: AgentListingRecord = {
    id: String(row.id ?? randomUUID()),
    agentId: String(row.agent_id ?? ""),
    title: String(row.title ?? "Untitled Listing"),
    listingType,
    location: String(row.location ?? "Unknown"),
    description: String(row.description ?? "No description provided yet."),
    status,
    views: parseNumber(row.views_count),
    inquiries: parseNumber(row.leads_count),
    price,
    date: formatListingDate(row.created_at),
  };

  if (commission) {
    mapped.dealAmount = Math.max(parseNumber(commission.close_amount), 0);
    mapped.totalCommission = Math.max(parseNumber(commission.total_commission), 0);
    mapped.agentCommission = Math.max(parseNumber(commission.agent_commission), 0);
    mapped.companyCommission = Math.max(parseNumber(commission.company_commission), 0);
    mapped.agentPayoutStatus = toUiPayoutStatus(commission.agent_payout_status);
    mapped.closedAt =
      typeof commission.closed_at === "string" && commission.closed_at.trim()
        ? commission.closed_at
        : undefined;
  } else if (status === "Sold" || status === "Rented") {
    const fallback = buildCommissionFallbackFromPrice(price);
    mapped.dealAmount = fallback.dealAmount;
    mapped.totalCommission = fallback.totalCommission;
    mapped.agentCommission = fallback.agentCommission;
    mapped.companyCommission = fallback.companyCommission;
    mapped.agentPayoutStatus = "Pending";
  }

  return mapped;
}

const fallbackAgentId = normalizeUserId("usr_agent_001", "Agent Alex");
const fallbackListings = new Map<string, FallbackListingRecord>(
  [
    {
      id: "prop_1",
      title: "Luxury Apartment in Victoria Island",
      listingType: "Sale",
      location: "Victoria Island, Lagos",
      description: "Premium apartment with waterfront access and concierge services.",
      status: "Published",
      views: 1240,
      inquiries: 18,
      price: "N150,000,000",
      date: "Jan 12, 2026",
      agentId: fallbackAgentId,
    },
    {
      id: "prop_5",
      title: "Unfinished Bungalow in Epe",
      listingType: "Sale",
      location: "Epe, Lagos",
      description: "Unfinished 4-bedroom bungalow in a fast-growing residential corridor.",
      status: "Pending Review",
      views: 0,
      inquiries: 0,
      price: "N25,000,000",
      date: "Jan 14, 2026",
      agentId: fallbackAgentId,
    },
    {
      id: "prop_6",
      title: "3 Bedroom Flat - Yaba",
      listingType: "Rent",
      location: "Yaba, Lagos",
      description: "Newly renovated 3-bedroom flat with dedicated parking.",
      status: "Draft",
      views: 0,
      inquiries: 0,
      price: "N4,000,000/yr",
      date: "Jan 10, 2026",
      agentId: fallbackAgentId,
    },
  ].map((item) => [item.id, item] as [string, FallbackListingRecord]),
);

function listFallbackListings(actorId: string, actorRole?: string): AgentListingRecord[] {
  const isAdmin = isAdminRole(actorRole);
  const rows = Array.from(fallbackListings.values()).filter((listing) => {
    if (isAdmin) return true;
    return listing.agentId === actorId;
  });

  return rows.map((item) => ({ ...item }));
}

function getFallbackListingById(listingId: string): FallbackListingRecord | null {
  const row = fallbackListings.get(listingId);
  return row ? { ...row } : null;
}

function setFallbackListing(next: FallbackListingRecord): void {
  fallbackListings.set(next.id, { ...next });
}

function applyFallbackStatusUpdate(
  listing: AgentListingRecord,
  nextStatus: AgentListingStatus,
): AgentListingRecord {
  const updated: AgentListingRecord = { ...listing, status: nextStatus };
  if (nextStatus === "Sold" || nextStatus === "Rented") {
    const fallback = buildCommissionFallbackFromPrice(updated.price);
    updated.dealAmount = fallback.dealAmount;
    updated.totalCommission = fallback.totalCommission;
    updated.agentCommission = fallback.agentCommission;
    updated.companyCommission = fallback.companyCommission;
    updated.agentPayoutStatus = updated.agentPayoutStatus ?? "Pending";
    updated.closedAt = new Date().toISOString();
  }
  if (nextStatus === "Published" && (updated.agentPayoutStatus as string | undefined) === undefined) {
    delete updated.agentPayoutStatus;
  }
  return updated;
}

function buildFallbackListingDate(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildFallbackListingId(): string {
  return `prop_${Date.now().toString().slice(-6)}`;
}

async function ensureListingFolderRecord(client: SupabaseClient, listingId: string): Promise<void> {
  const folderRoot = `listings/${listingId}`;
  const { error } = await client.from(LISTING_RECORD_FOLDERS_TABLE).upsert(
    {
      listing_id: listingId,
      folder_root: folderRoot,
      documents_folder: `${folderRoot}/documents`,
      contracts_folder: `${folderRoot}/contracts`,
      chat_folder: `${folderRoot}/chat`,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "listing_id" },
  );

  if (error && !isTableMissingError(error) && !isColumnMissingError(error)) {
    throw error;
  }
}

async function getDbListingById(
  client: SupabaseClient,
  listingId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from(LISTINGS_TABLE)
    .select(
      "id, agent_id, title, description, listing_type, price, price_suffix, location, status, views_count, leads_count, created_at, updated_at",
    )
    .eq("id", listingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data as Record<string, unknown>;
}

async function ensureActorAuthorized(
  actor: ListingActionActor,
  listingAgentIdRaw: string,
  client?: SupabaseClient,
): Promise<{ actorId: string; isAdmin: boolean }> {
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  let roleFromDb: string | null = null;
  if (client) {
    roleFromDb = await getUserRole(client, actorId);
  }

  const isAdmin = isAdminRole(roleFromDb ?? actor.actorRole ?? undefined);
  if (isAdmin) return { actorId, isAdmin: true };

  if (listingAgentIdRaw !== actorId) {
    throwForbidden("You can only update listings you own.");
  }

  return { actorId, isAdmin: false };
}

async function maybeRecalculateCommission(client: SupabaseClient, listingId: string): Promise<void> {
  const { error } = await client.rpc("recalculate_listing_commission", {
    p_listing_id: listingId,
  });

  if (error && !String(error.message ?? "").toLowerCase().includes("function")) {
    throw error;
  }
}

async function fetchSingleListingRecord(
  client: SupabaseClient,
  listingId: string,
): Promise<AgentListingRecord | null> {
  const listing = await getDbListingById(client, listingId);
  if (!listing) return null;

  const commissions = await fetchListingCommissions(client, [listingId]);
  return mapDbListingToRecord(listing, commissions.get(listingId));
}

export async function listAgentListings(
  actor: ListingActionActor,
): Promise<AgentListingRecord[]> {
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  const client = getClient();

  if (!client) {
    return listFallbackListings(actorId, actor.actorRole);
  }

  try {
    if (actor.actorName || actor.actorRole) {
      await ensureUserExists(client, actorId, actor.actorName || "Agent User", actor.actorRole);
    }

    const roleFromDb = await getUserRole(client, actorId);
    const isAdmin = isAdminRole(roleFromDb ?? undefined);

    let query = client
      .from(LISTINGS_TABLE)
      .select(
        "id, agent_id, title, description, listing_type, price, price_suffix, location, status, views_count, leads_count, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(250);

    if (!isAdmin) {
      query = query.eq("agent_id", actorId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return [];
    }

    const listingIds = rows
      .map((row) => String(row.id ?? ""))
      .filter(Boolean);
    const commissions = await fetchListingCommissions(client, listingIds);

    return rows.map((row) => mapDbListingToRecord(row as Record<string, unknown>, commissions.get(String(row.id))));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      return listFallbackListings(actorId, actor.actorRole);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to load listings: ${message}`);
  }
}

export async function updateAgentListingStatus(
  listingId: string,
  nextStatus: AgentListingStatus,
  actor: ListingActionActor,
): Promise<AgentListingRecord> {
  const normalizedStatus = toDbStatus(nextStatus);
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  const client = getClient();

  if (!client) {
    const existing = getFallbackListingById(listingId);
    if (!existing) {
      throw new Error("Listing was not found.");
    }

    const { isAdmin } = await ensureActorAuthorized(actor, existing.agentId || actorId);
    assertStatusChangeAllowedForActor(normalizedStatus, {
      isAdmin,
      currentStatus: toDbStatus(existing.status),
    });
    const updated = applyFallbackStatusUpdate(existing, toUiStatus(normalizedStatus));
    setFallbackListing({ ...updated, agentId: existing.agentId });
    if (nextStatus === "Sold" || nextStatus === "Rented") {
      await closeListingConversations(listingId, "listing_closed_deal");
    }
    return updated;
  }

  try {
    if (actor.actorName || actor.actorRole) {
      await ensureUserExists(client, actorId, actor.actorName || "Agent User", actor.actorRole);
    }

    const listing = await getDbListingById(client, listingId);
    if (!listing) {
      const fallback = getFallbackListingById(listingId);
      if (fallback) {
        const { isAdmin } = await ensureActorAuthorized(actor, fallback.agentId || actorId);
        assertStatusChangeAllowedForActor(normalizedStatus, {
          isAdmin,
          currentStatus: toDbStatus(fallback.status),
        });
        const updated = applyFallbackStatusUpdate(fallback, toUiStatus(normalizedStatus));
        setFallbackListing({ ...updated, agentId: fallback.agentId });
        return updated;
      }
      throw new Error("Listing was not found.");
    }

    const { isAdmin } = await ensureActorAuthorized(actor, String(listing.agent_id ?? ""), client);
    assertStatusChangeAllowedForActor(normalizedStatus, {
      isAdmin,
      currentStatus: toDbStatus(String(listing.status ?? "draft")),
    });

    const { error: updateError } = await client
      .from(LISTINGS_TABLE)
      .update({
        status: normalizedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", listingId);

    if (updateError) throw updateError;

    if (normalizedStatus === "sold" || normalizedStatus === "rented") {
      await maybeRecalculateCommission(client, listingId);
      await closeListingConversations(listingId, "listing_closed_deal");
      await ensureListingFolderRecord(client, listingId);
    }

    const mapped = await fetchSingleListingRecord(client, listingId);
    if (!mapped) {
      throw new Error("Listing update succeeded but could not reload listing.");
    }

    return mapped;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw error;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const fallback = getFallbackListingById(listingId);
      if (!fallback) {
        throw new Error("Listing was not found.");
      }
      const { isAdmin } = await ensureActorAuthorized(actor, fallback.agentId || actorId);
      assertStatusChangeAllowedForActor(normalizedStatus, {
        isAdmin,
        currentStatus: toDbStatus(fallback.status),
      });
      const updated = applyFallbackStatusUpdate(fallback, toUiStatus(normalizedStatus));
      setFallbackListing({ ...updated, agentId: fallback.agentId });
      return updated;
    }
    throw new Error(`Failed to update listing status: ${message}`);
  }
}

export async function updateAgentListingPayoutStatus(
  listingId: string,
  nextStatus: AgentPayoutStatus,
  actor: ListingActionActor,
): Promise<AgentListingRecord> {
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  const client = getClient();

  if (!client) {
    const existing = getFallbackListingById(listingId);
    if (!existing) throw new Error("Listing was not found.");
    await ensureActorAuthorized(actor, existing.agentId || actorId);
    const updated: AgentListingRecord = { ...existing, agentPayoutStatus: nextStatus };
    setFallbackListing({ ...updated, agentId: existing.agentId });
    return updated;
  }

  try {
    if (actor.actorName || actor.actorRole) {
      await ensureUserExists(client, actorId, actor.actorName || "Agent User", actor.actorRole);
    }

    const listing = await getDbListingById(client, listingId);
    if (!listing) throw new Error("Listing was not found.");

    await ensureActorAuthorized(actor, String(listing.agent_id ?? ""), client);

    await maybeRecalculateCommission(client, listingId);

    const { data, error } = await client
      .from(LISTING_COMMISSIONS_TABLE)
      .update({
        agent_payout_status: toDbPayoutStatus(nextStatus),
        updated_at: new Date().toISOString(),
      })
      .eq("listing_id", listingId)
      .select("listing_id")
      .maybeSingle();

    if (error) throw error;
    if (!data?.listing_id) {
      throw new Error("No commission record found for this listing yet.");
    }

    const mapped = await fetchSingleListingRecord(client, listingId);
    if (!mapped) {
      throw new Error("Payout status updated but could not reload listing.");
    }

    mapped.agentPayoutStatus = nextStatus;
    return mapped;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const fallback = getFallbackListingById(listingId);
      if (!fallback) throw new Error("Listing was not found.");
      const updated: AgentListingRecord = { ...fallback, agentPayoutStatus: nextStatus };
      setFallbackListing({ ...updated, agentId: fallback.agentId });
      return updated;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw error;
    }
    throw new Error(`Failed to update payout status: ${message}`);
  }
}

export async function createAgentListing(
  input: UpsertAgentListingInput,
  actor: ListingActionActor,
): Promise<AgentListingRecord> {
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  const title = String(input.title ?? "").trim();
  const location = String(input.location ?? "").trim();
  const description = String(input.description ?? "").trim() || "No description provided yet.";
  const listingType = toUiListingType(String(input.listingType ?? "sale"));
  const priceValue = Math.max(parsePriceInput(input.price), 0);
  const requestedStatus = toDbStatus(input.status ?? "Pending Review");
  const client = getClient();

  if (!title || !location || priceValue <= 0) {
    throw new Error("Title, location, and a valid price are required.");
  }

  if (!client) {
    const isAdmin = isAdminRole(actor.actorRole);
    assertStatusChangeAllowedForActor(requestedStatus, {
      isAdmin,
      currentStatus: null,
    });

    const fallbackListing: FallbackListingRecord = {
      id: buildFallbackListingId(),
      title,
      listingType,
      location,
      description,
      status: toUiStatus(requestedStatus),
      views: 0,
      inquiries: 0,
      price: formatPrice(priceValue, listingType, listingType === "Rent" ? "/yr" : null),
      date: buildFallbackListingDate(),
      agentId: actorId,
    };
    setFallbackListing(fallbackListing);
    return fallbackListing;
  }

  try {
    if (actor.actorName || actor.actorRole) {
      await ensureUserExists(client, actorId, actor.actorName || "Agent User", actor.actorRole);
    }

    const roleFromDb = await getUserRole(client, actorId);
    if (!canCreateListing(roleFromDb ?? undefined)) {
      throwForbidden("Only agents, sellers, owners, or admins can create listings.");
    }
    const isAdmin = isAdminRole(roleFromDb ?? undefined);
    assertStatusChangeAllowedForActor(requestedStatus, {
      isAdmin,
      currentStatus: null,
    });

    const { data, error } = await client
      .from(LISTINGS_TABLE)
      .insert({
        agent_id: actorId,
        title,
        description,
        listing_type: toDbListingType(listingType),
        price: priceValue,
        price_suffix: listingType === "Rent" ? "/yr" : null,
        location,
        status: requestedStatus,
        views_count: 0,
        leads_count: 0,
      })
      .select("id")
      .single();

    if (error) throw error;

    const listingId = String(data?.id ?? "").trim();
    if (!listingId) {
      throw new Error("Listing created but returned no identifier.");
    }

    await ensureListingFolderRecord(client, listingId);
    await maybeRecalculateCommission(client, listingId);
    if (requestedStatus === "sold" || requestedStatus === "rented") {
      await closeListingConversations(listingId, "listing_closed_deal");
    }

    const mapped = await fetchSingleListingRecord(client, listingId);
    if (!mapped) {
      throw new Error("Listing created but could not be reloaded.");
    }

    return mapped;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const fallbackListing: FallbackListingRecord = {
        id: buildFallbackListingId(),
        title,
        listingType,
        location,
        description,
        status: toUiStatus(requestedStatus),
        views: 0,
        inquiries: 0,
        price: formatPrice(priceValue, listingType, listingType === "Rent" ? "/yr" : null),
        date: buildFallbackListingDate(),
        agentId: actorId,
      };
      setFallbackListing(fallbackListing);
      return fallbackListing;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw error;
    }
    throw new Error(`Failed to create listing: ${message}`);
  }
}

export async function updateAgentListing(
  listingId: string,
  input: UpsertAgentListingInput,
  actor: ListingActionActor,
): Promise<AgentListingRecord> {
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  const title = String(input.title ?? "").trim();
  const location = String(input.location ?? "").trim();
  const description = String(input.description ?? "").trim() || "No description provided yet.";
  const listingType = toUiListingType(String(input.listingType ?? "sale"));
  const priceValue = Math.max(parsePriceInput(input.price), 0);
  const requestedStatus = toDbStatus(input.status ?? "Draft");
  const client = getClient();

  if (!title || !location || priceValue <= 0) {
    throw new Error("Title, location, and a valid price are required.");
  }

  if (!client) {
    const existing = getFallbackListingById(listingId);
    if (!existing) {
      throw new Error("Listing was not found.");
    }
    const { isAdmin } = await ensureActorAuthorized(actor, existing.agentId || actorId);
    assertStatusChangeAllowedForActor(requestedStatus, {
      isAdmin,
      currentStatus: toDbStatus(existing.status),
    });

    const updatedStatus = toUiStatus(requestedStatus);
    const updated: AgentListingRecord = {
      ...existing,
      title,
      listingType,
      location,
      description,
      status: updatedStatus,
      price: formatPrice(priceValue, listingType, listingType === "Rent" ? "/yr" : null),
    };

    if (updatedStatus === "Sold" || updatedStatus === "Rented") {
      const fallback = buildCommissionFallbackFromPrice(updated.price);
      updated.dealAmount = fallback.dealAmount;
      updated.totalCommission = fallback.totalCommission;
      updated.agentCommission = fallback.agentCommission;
      updated.companyCommission = fallback.companyCommission;
      updated.agentPayoutStatus = updated.agentPayoutStatus ?? "Pending";
      updated.closedAt = updated.closedAt ?? new Date().toISOString();
      await closeListingConversations(listingId, "listing_closed_deal");
    } else {
      delete updated.dealAmount;
      delete updated.totalCommission;
      delete updated.agentCommission;
      delete updated.companyCommission;
      delete updated.agentPayoutStatus;
      delete updated.closedAt;
    }

    setFallbackListing({ ...updated, agentId: existing.agentId });
    return updated;
  }

  try {
    if (actor.actorName || actor.actorRole) {
      await ensureUserExists(client, actorId, actor.actorName || "Agent User", actor.actorRole);
    }

    const listing = await getDbListingById(client, listingId);
    if (!listing) {
      throw new Error("Listing was not found.");
    }

    const { isAdmin } = await ensureActorAuthorized(actor, String(listing.agent_id ?? ""), client);
    assertStatusChangeAllowedForActor(requestedStatus, {
      isAdmin,
      currentStatus: toDbStatus(String(listing.status ?? "draft")),
    });

    const { error: updateError } = await client
      .from(LISTINGS_TABLE)
      .update({
        title,
        location,
        description,
        listing_type: toDbListingType(listingType),
        price: priceValue,
        price_suffix: listingType === "Rent" ? "/yr" : null,
        status: requestedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", listingId);

    if (updateError) throw updateError;

    await maybeRecalculateCommission(client, listingId);
    if (requestedStatus === "sold" || requestedStatus === "rented") {
      await closeListingConversations(listingId, "listing_closed_deal");
      await ensureListingFolderRecord(client, listingId);
    }

    const mapped = await fetchSingleListingRecord(client, listingId);
    if (!mapped) {
      throw new Error("Listing updated but could not be reloaded.");
    }

    return mapped;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const existing = getFallbackListingById(listingId);
      if (!existing) {
        throw new Error("Listing was not found.");
      }
      const { isAdmin } = await ensureActorAuthorized(actor, existing.agentId || actorId);
      assertStatusChangeAllowedForActor(requestedStatus, {
        isAdmin,
        currentStatus: toDbStatus(existing.status),
      });

      const updatedStatus = toUiStatus(requestedStatus);
      const updated: AgentListingRecord = {
        ...existing,
        title,
        listingType,
        location,
        description,
        status: updatedStatus,
        price: formatPrice(priceValue, listingType, listingType === "Rent" ? "/yr" : null),
      };

      if (updatedStatus === "Sold" || updatedStatus === "Rented") {
        const fallback = buildCommissionFallbackFromPrice(updated.price);
        updated.dealAmount = fallback.dealAmount;
        updated.totalCommission = fallback.totalCommission;
        updated.agentCommission = fallback.agentCommission;
        updated.companyCommission = fallback.companyCommission;
        updated.agentPayoutStatus = updated.agentPayoutStatus ?? "Pending";
        updated.closedAt = updated.closedAt ?? new Date().toISOString();
        await closeListingConversations(listingId, "listing_closed_deal");
      } else {
        delete updated.dealAmount;
        delete updated.totalCommission;
        delete updated.agentCommission;
        delete updated.companyCommission;
        delete updated.agentPayoutStatus;
        delete updated.closedAt;
      }

      setFallbackListing({ ...updated, agentId: existing.agentId });
      return updated;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw error;
    }
    throw new Error(`Failed to update listing: ${message}`);
  }
}

export async function deleteAgentListing(
  listingId: string,
  actor: ListingActionActor,
): Promise<DeleteAgentListingResult> {
  const actorId = normalizeUserId(actor.actorId, actor.actorName || actor.actorId);
  const client = getClient();

  if (!client) {
    const existing = getFallbackListingById(listingId);
    if (!existing) throw new Error("Listing was not found.");
    await ensureActorAuthorized(actor, existing.agentId || actorId);
    fallbackListings.delete(listingId);
    await closeListingConversations(listingId, "listing_deleted");
    return { ok: true, listingId };
  }

  try {
    if (actor.actorName || actor.actorRole) {
      await ensureUserExists(client, actorId, actor.actorName || "Agent User", actor.actorRole);
    }

    const listing = await getDbListingById(client, listingId);
    if (!listing) {
      throw new Error("Listing was not found.");
    }

    await ensureActorAuthorized(actor, String(listing.agent_id ?? ""), client);

    const { error } = await client.from(LISTINGS_TABLE).delete().eq("id", listingId);
    if (error) throw error;

    await closeListingConversations(listingId, "listing_deleted");
    fallbackListings.delete(listingId);
    return { ok: true, listingId };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      (isTableMissingError(error as { message?: string }) ||
        isColumnMissingError(error as { message?: string }))
    ) {
      const fallback = getFallbackListingById(listingId);
      if (!fallback) throw new Error("Listing was not found.");
      await ensureActorAuthorized(actor, fallback.agentId || actorId);
      fallbackListings.delete(listingId);
      return { ok: true, listingId };
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith(FORBIDDEN_PREFIX)) {
      throw error;
    }
    throw new Error(`Failed to delete listing: ${message}`);
  }
}
