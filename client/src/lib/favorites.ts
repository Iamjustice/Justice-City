import { apiRequest } from "@/lib/queryClient";

export type FavoriteItem = {
  id?: string;
  listingId: string;
  createdAt?: string;
};

type FavoritesResponse = {
  items?: FavoriteItem[];
};

export async function listFavorites(): Promise<FavoriteItem[]> {
  const response = await apiRequest("GET", "/api/favorites");
  const payload = (await response.json()) as FavoritesResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .map((item) => ({
      id: String(item.id ?? "").trim() || undefined,
      listingId: String(item.listingId ?? "").trim(),
      createdAt: String(item.createdAt ?? "").trim() || undefined,
    }))
    .filter((item) => item.listingId.length > 0);
}

export async function saveFavorite(listingId: string): Promise<FavoriteItem> {
  const normalizedListingId = String(listingId ?? "").trim();
  if (!normalizedListingId) {
    throw new Error("listingId is required.");
  }

  const response = await apiRequest("POST", "/api/favorites", { listingId: normalizedListingId });
  const payload = (await response.json()) as { favorite?: FavoriteItem };
  const favorite = payload.favorite;
  if (!favorite?.listingId) {
    throw new Error("Favorite was not saved.");
  }

  return {
    id: String(favorite.id ?? "").trim() || undefined,
    listingId: String(favorite.listingId).trim(),
    createdAt: String(favorite.createdAt ?? "").trim() || undefined,
  };
}

export async function removeFavorite(listingId: string): Promise<{ ok: true; listingId: string }> {
  const normalizedListingId = String(listingId ?? "").trim();
  if (!normalizedListingId) {
    throw new Error("listingId is required.");
  }

  const response = await apiRequest("DELETE", `/api/favorites/${encodeURIComponent(normalizedListingId)}`);
  const payload = (await response.json()) as { ok?: boolean; listingId?: string };
  return {
    ok: true,
    listingId: String(payload.listingId ?? normalizedListingId).trim() || normalizedListingId,
  };
}
