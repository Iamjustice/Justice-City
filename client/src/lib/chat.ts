import { apiRequest } from "@/lib/queryClient";

export type ChatMessageSender = "me" | "them" | "system";
export type ChatMessageType = "text" | "system" | "issue_card";

export type ChatMessageAttachment = {
  bucketId?: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  previewUrl?: string;
};

export type ChatMessage = {
  id: string;
  sender: ChatMessageSender;
  content: string;
  time: string;
  createdAt: string;
  senderId?: string;
  messageType: ChatMessageType;
  metadata?: Record<string, unknown>;
  attachments?: ChatMessageAttachment[];
};

export type ChatConversation = {
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

export type UpsertConversationPayload = {
  requesterId: string;
  requesterName: string;
  requesterRole?: string;
  recipientId?: string;
  recipientName: string;
  recipientRole?: string;
  subject?: string;
  listingId?: string;
  initialMessage?: string;
  conversationScope?: "listing" | "renting" | "service" | "support" | string;
  serviceCode?: string;
};

export type UpsertConversationResponse = {
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

export type SendConversationMessagePayload = {
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  content: string;
  messageType?: ChatMessageType;
  metadata?: Record<string, unknown>;
  attachments?: Array<{
    bucketId?: string;
    storagePath: string;
    fileName: string;
    mimeType?: string;
    fileSizeBytes?: number;
  }>;
};

export type UploadConversationAttachmentsPayload = {
  conversationId: string;
  senderId: string;
  scope?: "listing" | "renting" | "service" | "support" | string;
  files: File[];
};

export type UploadedConversationAttachment = {
  bucketId?: string;
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Failed to read file "${file.name}".`));
        return;
      }

      const base64 = result.includes(",") ? result.split(",").pop() ?? "" : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

export async function upsertConversation(
  payload: UpsertConversationPayload,
): Promise<UpsertConversationResponse> {
  const response = await apiRequest("POST", "/api/chat/conversations/upsert", payload);
  return response.json();
}

export async function fetchConversationMessages(
  conversationId: string,
  viewerId: string,
): Promise<ChatMessage[]> {
  const response = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?viewerId=${encodeURIComponent(viewerId)}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

export async function fetchUserConversations(
  viewerId: string,
  options?: { viewerRole?: string; viewerName?: string },
): Promise<ChatConversation[]> {
  const params = new URLSearchParams({ viewerId });
  if (options?.viewerRole) params.set("viewerRole", options.viewerRole);
  if (options?.viewerName) params.set("viewerName", options.viewerName);

  const response = await fetch(
    `/api/chat/conversations?${params.toString()}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

export async function fetchAdminConversations(
  viewerId: string,
  options?: { viewerRole?: string; viewerName?: string },
): Promise<ChatConversation[]> {
  const params = new URLSearchParams({ viewerId });
  if (options?.viewerRole) params.set("viewerRole", options.viewerRole);
  if (options?.viewerName) params.set("viewerName", options.viewerName);

  const response = await fetch(
    `/api/admin/chat/conversations?${params.toString()}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

export async function sendConversationMessage(
  payload: SendConversationMessagePayload,
): Promise<ChatMessage> {
  const response = await apiRequest(
    "POST",
    `/api/chat/conversations/${encodeURIComponent(payload.conversationId)}/messages`,
    {
      senderId: payload.senderId,
      senderName: payload.senderName,
      senderRole: payload.senderRole,
      content: payload.content,
      messageType: payload.messageType,
      metadata: payload.metadata,
      attachments: payload.attachments,
    },
  );

  return response.json();
}

export async function fetchConversationFiles(
  conversationId: string,
): Promise<ConversationFileRecord[]> {
  const response = await apiRequest(
    "GET",
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/files`,
  );
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as ConversationFileRecord[]) : [];
}

export async function uploadConversationAttachments(
  payload: UploadConversationAttachmentsPayload,
): Promise<UploadedConversationAttachment[]> {
  if (!payload.conversationId) {
    throw new Error("conversationId is required");
  }
  if (!payload.senderId) {
    throw new Error("senderId is required");
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    return [];
  }

  const files = await Promise.all(
    payload.files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSizeBytes: file.size,
      contentBase64: await fileToBase64(file),
    })),
  );

  const response = await apiRequest(
    "POST",
    `/api/chat/conversations/${encodeURIComponent(payload.conversationId)}/attachments`,
    {
      senderId: payload.senderId,
      scope: payload.scope,
      files,
    },
  );

  const data = (await response.json()) as {
    attachments?: UploadedConversationAttachment[];
  };
  return Array.isArray(data.attachments) ? data.attachments : [];
}
