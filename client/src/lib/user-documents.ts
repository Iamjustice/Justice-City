import { apiRequest } from "@/lib/queryClient";

export type UserDocumentType =
  | "Contract"
  | "Title"
  | "Invoice"
  | "Receipt"
  | "Attachment"
  | "Other";

export type UserDocumentRecord = {
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

export async function fetchUserDocuments(filters?: {
  userId?: string;
  listingId?: string;
  conversationId?: string;
  documentType?: UserDocumentType;
}): Promise<UserDocumentRecord[]> {
  const params = new URLSearchParams();
  if (filters?.userId) params.set("userId", filters.userId);
  if (filters?.listingId) params.set("listingId", filters.listingId);
  if (filters?.conversationId) params.set("conversationId", filters.conversationId);
  if (filters?.documentType) params.set("documentType", filters.documentType.toLowerCase());
  const query = params.toString();
  const response = await apiRequest("GET", `/api/user-documents${query ? `?${query}` : ""}`);
  return response.json();
}

export async function createUserDocument(input: {
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
}): Promise<UserDocumentRecord> {
  const response = await apiRequest("POST", "/api/user-documents", input);
  return response.json();
}
