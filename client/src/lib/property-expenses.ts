import { apiRequest } from "@/lib/queryClient";

export type PropertyExpenseCategory =
  | "Maintenance"
  | "Repairs"
  | "Taxes"
  | "Utilities"
  | "Security"
  | "Other";

export type PropertyExpense = {
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

export async function fetchPropertyExpenses(filters?: {
  listingId?: string;
  category?: PropertyExpenseCategory;
  ownerUserId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<PropertyExpense[]> {
  const params = new URLSearchParams();
  if (filters?.listingId) params.set("listingId", filters.listingId);
  if (filters?.category) params.set("category", filters.category.toLowerCase());
  if (filters?.ownerUserId) params.set("ownerUserId", filters.ownerUserId);
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  const query = params.toString();
  const response = await apiRequest("GET", `/api/property-expenses${query ? `?${query}` : ""}`);
  return response.json();
}

export async function createPropertyExpense(input: {
  listingId?: string;
  ownerUserId?: string;
  category: PropertyExpenseCategory;
  amount: number;
  expenseDate?: string;
  notes?: string;
}): Promise<PropertyExpense> {
  const response = await apiRequest("POST", "/api/property-expenses", input);
  return response.json();
}

export async function updatePropertyExpense(
  expenseId: string,
  input: {
    listingId?: string;
    ownerUserId?: string;
    category?: PropertyExpenseCategory;
    amount?: number;
    expenseDate?: string;
    notes?: string;
  },
): Promise<PropertyExpense> {
  const response = await apiRequest(
    "PATCH",
    `/api/property-expenses/${encodeURIComponent(expenseId)}`,
    input,
  );
  return response.json();
}

export async function deletePropertyExpense(
  expenseId: string,
): Promise<{ ok: true; expenseId: string }> {
  const response = await apiRequest("DELETE", `/api/property-expenses/${encodeURIComponent(expenseId)}`);
  return response.json();
}
