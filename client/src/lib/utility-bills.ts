import { apiRequest } from "@/lib/queryClient";

export type UtilityBillStatus = "Pending" | "Paid" | "Overdue";
export type UtilityBillType = "Electricity" | "Water" | "Waste Management" | "Maintenance" | "Other";

export type UtilityBill = {
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

function toStatusParam(status: UtilityBillStatus): string {
  if (status === "Paid") return "paid";
  if (status === "Overdue") return "overdue";
  return "pending";
}

export async function fetchUtilityBills(filters?: {
  listingId?: string;
  status?: UtilityBillStatus;
  ownerUserId?: string;
  renterUserId?: string;
}): Promise<UtilityBill[]> {
  const params = new URLSearchParams();
  if (filters?.listingId) params.set("listingId", filters.listingId);
  if (filters?.status) params.set("status", toStatusParam(filters.status));
  if (filters?.ownerUserId) params.set("ownerUserId", filters.ownerUserId);
  if (filters?.renterUserId) params.set("renterUserId", filters.renterUserId);
  const query = params.toString();
  const response = await apiRequest("GET", `/api/utility-bills${query ? `?${query}` : ""}`);
  return response.json();
}

export async function createUtilityBill(input: {
  listingId?: string;
  ownerUserId?: string;
  renterUserId?: string;
  billType: UtilityBillType;
  amount: number;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  dueDate?: string;
  notes?: string;
  status?: UtilityBillStatus;
}): Promise<UtilityBill> {
  const response = await apiRequest("POST", "/api/utility-bills", input);
  return response.json();
}

export async function updateUtilityBill(
  billId: string,
  input: {
    billType?: UtilityBillType;
    amount?: number;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
    dueDate?: string;
    notes?: string;
    status?: UtilityBillStatus;
  },
): Promise<UtilityBill> {
  const response = await apiRequest("PATCH", `/api/utility-bills/${encodeURIComponent(billId)}`, input);
  return response.json();
}

export async function deleteUtilityBill(billId: string): Promise<{ ok: true; billId: string }> {
  const response = await apiRequest("DELETE", `/api/utility-bills/${encodeURIComponent(billId)}`);
  return response.json();
}
