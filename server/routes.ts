import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { submitSmileIdVerification } from "./smile-id";
import {
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

const CHAT_CONVERSATIONS_TABLE =
  process.env.SUPABASE_CHAT_CONVERSATIONS_TABLE || "chat_conversations";
const SERVICE_REQUESTS_TABLE =
  process.env.SUPABASE_SERVICE_REQUESTS_TABLE || "service_request_records";
const CONVERSATION_TRANSCRIPTS_TABLE =
  process.env.SUPABASE_CONVERSATION_TRANSCRIPTS_TABLE || "conversation_transcripts";

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

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
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

  app.post("/api/verification/smile-id", async (req: Request, res: Response) => {
    try {
      const {
        mode = "biometric",
        userId,
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

      await saveVerification({
        user_id: userId,
        mode,
        provider: result.provider,
        status: result.status,
        job_id: result.jobId,
        smile_job_id: result.smileJobId ?? null,
        message: result.message,
      });

      if (result.status === "approved") {
        await setUserVerificationState(userId, true);
      }

      return res.status(200).json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Verification request failed";

      return res.status(502).json({ message });
    }
  });

  app.post("/api/verification/smile-id/callback", async (req: Request, res: Response) => {
    try {
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

      if (mappedStatus === "approved") {
        const userIdFromCallback = String(payload.user_id ?? payload.userId ?? "").trim();
        const resolvedUserId = userIdFromCallback || updatedVerification?.userId || "";
        await setUserVerificationState(resolvedUserId, true);
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Callback processing failed";

      return res.status(502).json({ message });
    }
  });

  return httpServer;
}
