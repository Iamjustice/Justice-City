import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const USER_FAVORITES_TABLE = process.env.SUPABASE_USER_FAVORITES_TABLE || "user_favorites";

export type UserFavoriteRecord = {
  id: string;
  userId: string;
  listingId: string;
  createdAt?: string;
};

type UserFavoriteRow = {
  id: string;
  user_id: string;
  listing_id: string;
  created_at?: string | null;
};

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = String(error.message ?? "").trim();
    return message || "Unknown error";
  }

  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const parts = [
      String(payload.message ?? "").trim(),
      String(payload.details ?? "").trim(),
      String(payload.hint ?? "").trim(),
      String(payload.code ?? "").trim(),
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return "Unknown error";
}

function mapFavoriteRow(row: UserFavoriteRow): UserFavoriteRecord {
  return {
    id: String(row.id ?? "").trim(),
    userId: String(row.user_id ?? "").trim(),
    listingId: String(row.listing_id ?? "").trim(),
    createdAt: String(row.created_at ?? "").trim() || undefined,
  };
}

export async function listUserFavorites(userId: string): Promise<UserFavoriteRecord[]> {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return [];

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data, error } = await client
    .from(USER_FAVORITES_TABLE)
    .select("id, user_id, listing_id, created_at")
    .eq("user_id", normalizedUserId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list favorites: ${toErrorMessage(error)}`);
  }

  const rows = Array.isArray(data) ? (data as UserFavoriteRow[]) : [];
  return rows.map(mapFavoriteRow);
}

export async function upsertUserFavorite(
  userId: string,
  listingId: string,
): Promise<UserFavoriteRecord> {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedListingId = String(listingId ?? "").trim();
  if (!normalizedUserId || !normalizedListingId) {
    throw new Error("User ID and listing ID are required.");
  }

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { data: existing, error: existingError } = await client
    .from(USER_FAVORITES_TABLE)
    .select("id, user_id, listing_id, created_at")
    .eq("user_id", normalizedUserId)
    .eq("listing_id", normalizedListingId)
    .maybeSingle<UserFavoriteRow>();

  if (existingError) {
    throw new Error(`Failed to read favorite: ${toErrorMessage(existingError)}`);
  }
  if (existing) {
    return mapFavoriteRow(existing);
  }

  const { data, error } = await client
    .from(USER_FAVORITES_TABLE)
    .insert({
      user_id: normalizedUserId,
      listing_id: normalizedListingId,
    })
    .select("id, user_id, listing_id, created_at")
    .single<UserFavoriteRow>();

  if (error || !data) {
    throw new Error(`Failed to save favorite: ${toErrorMessage(error)}`);
  }

  return mapFavoriteRow(data);
}

export async function removeUserFavorite(userId: string, listingId: string): Promise<boolean> {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedListingId = String(listingId ?? "").trim();
  if (!normalizedUserId || !normalizedListingId) return false;

  const client = getClient();
  if (!client) {
    throw new Error("Supabase service client is not configured.");
  }

  const { error } = await client
    .from(USER_FAVORITES_TABLE)
    .delete()
    .eq("user_id", normalizedUserId)
    .eq("listing_id", normalizedListingId);

  if (error) {
    throw new Error(`Failed to remove favorite: ${toErrorMessage(error)}`);
  }

  return true;
}
