import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  FileUp,
  ImageIcon,
  Link2,
  Loader2,
  MoreVertical,
  Paperclip,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  fetchConversationFiles,
  fetchConversationMessages,
  sendConversationMessage,
  uploadConversationAttachments,
  upsertConversation,
  type ConversationFileRecord,
  type ChatMessage,
} from "@/lib/chat";
import {
  createProviderLink,
  getTransactionByConversation,
  listPayoutLedger,
  listServicePdfJobsByConversation,
  listTransactionStatusHistory,
  openDispute,
  queueServicePdfJob,
  resolveTransactionAction,
  updatePayoutLedgerStatus,
  upsertTransactionForConversation,
  type PayoutLedgerEntry,
  type PayoutLedgerStatus,
  type ServicePdfJob,
  type TransactionStatusHistoryItem,
  type TransactionAction,
  type TransactionSummary,
} from "@/lib/transaction-automation";

const SAFETY_SYSTEM_MESSAGE =
  "This chat is monitored by Justice City for your safety. Do not share financial details off-platform.";

interface ChatInterfaceProps {
  recipient: {
    id?: string;
    name: string;
    image: string;
    verified: boolean;
    role?: string;
  };
  propertyTitle: string;
  initialMessage?: string;
  listingId?: string;
  conversationId?: string;
  requesterId?: string;
  requesterName?: string;
  requesterRole?: string;
  conversationScope?: "listing" | "renting" | "service" | "support";
  serviceCode?: string;
}

function formatLocalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildFallbackMessages(initialMessage: string): ChatMessage[] {
  const now = new Date();
  const next = new Date(now.getTime() + 1000);

  return [
    {
      id: "local-system-message",
      sender: "system",
      content: SAFETY_SYSTEM_MESSAGE,
      time: formatLocalTime(now.toISOString()),
      createdAt: now.toISOString(),
      messageType: "system",
    },
    {
      id: "local-intro-message",
      sender: "them",
      content: initialMessage,
      time: formatLocalTime(next.toISOString()),
      createdAt: next.toISOString(),
      messageType: "text",
    },
  ];
}

function parseIssueCard(message: ChatMessage): {
  title: string;
  problemTag?: string;
  status?: string;
  detail: string;
} | null {
  if (message.messageType !== "issue_card") return null;
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : undefined;
  const issueCard =
    metadata?.issueCard && typeof metadata.issueCard === "object"
      ? (metadata.issueCard as Record<string, unknown>)
      : undefined;

  const title = String(issueCard?.title ?? "Issue Card").trim() || "Issue Card";
  const detail =
    String(issueCard?.message ?? "").trim() ||
    String(message.content ?? "").trim() ||
    "Issue update";
  const problemTag = String(issueCard?.problemTag ?? "").trim() || undefined;
  const status = String(issueCard?.status ?? "").trim() || undefined;

  return { title, problemTag, status, detail };
}

function parseActionCard(message: ChatMessage): TransactionAction | null {
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : undefined;
  const actionCard =
    metadata?.actionCard && typeof metadata.actionCard === "object"
      ? (metadata.actionCard as Record<string, unknown>)
      : undefined;
  if (!actionCard) return null;

  const id = String(actionCard.id ?? "").trim();
  const transactionId = String(actionCard.transactionId ?? "").trim();
  const conversationId = String(actionCard.conversationId ?? "").trim();
  const actionType = String(actionCard.actionType ?? "").trim().toLowerCase();
  if (!id || !transactionId || !actionType) return null;

  return {
    id,
    transactionId,
    conversationId,
    actionType,
    targetRole: String(actionCard.targetRole ?? "buyer").trim().toLowerCase(),
    status: String(actionCard.status ?? "pending").trim().toLowerCase() as TransactionAction["status"],
    payload:
      actionCard.payload && typeof actionCard.payload === "object"
        ? (actionCard.payload as Record<string, unknown>)
        : {},
    expiresAt: actionCard.expiresAt ? String(actionCard.expiresAt) : null,
  };
}

function normalizeUserRole(rawRole: unknown): string {
  const role = String(rawRole ?? "").trim().toLowerCase();
  if (role === "admin" || role === "support") return role;
  if (role === "agent") return role;
  if (role === "seller") return role;
  if (role === "owner") return role;
  if (role === "renter") return role;
  return "buyer";
}

function canResolveAction(action: TransactionAction, userRoleRaw: unknown): boolean {
  const userRole = normalizeUserRole(userRoleRaw);
  if (action.status !== "pending") return false;
  if (userRole === "admin" || userRole === "support") return true;
  return action.targetRole === userRole;
}

function resolveActionPrimaryLabel(actionType: string): string {
  if (actionType === "upload_payment_proof") return "Submit";
  if (actionType === "upload_signed_closing_contract") return "Submit";
  if (actionType === "upload_service_deliverable") return "Submit";
  if (actionType === "accept_delivery") return "Accept";
  return "Accept";
}

function resolveActionSecondaryLabel(actionType: string): string {
  if (actionType === "accept_delivery") return "Dispute";
  return "Decline";
}

function isImageAttachment(mimeType?: string): boolean {
  return String(mimeType ?? "")
    .toLowerCase()
    .startsWith("image/");
}

function isUuid(value: string | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? "").trim(),
  );
}

function formatAmount(amount: number, currency: string): string {
  const normalizedCurrency = String(currency || "NGN")
    .trim()
    .toUpperCase();
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${normalizedCurrency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
  }
}

function payoutStatusBadgeClass(status: PayoutLedgerStatus): string {
  if (status === "paid") return "bg-green-100 text-green-700 border-green-200";
  if (status === "failed") return "bg-red-100 text-red-700 border-red-200";
  if (status === "cancelled") return "bg-slate-200 text-slate-700 border-slate-300";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

export function ChatInterface({
  recipient,
  propertyTitle,
  initialMessage,
  listingId,
  conversationId: initialConversationId,
  requesterId,
  requesterName,
  requesterRole,
  conversationScope,
  serviceCode,
}: ChatInterfaceProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resolvedSenderId, setResolvedSenderId] = useState<string>("");
  const [resolvedSenderName, setResolvedSenderName] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isLocalFallback, setIsLocalFallback] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [conversationFiles, setConversationFiles] = useState<ConversationFileRecord[]>([]);
  const [isLoadingConversationFiles, setIsLoadingConversationFiles] = useState(false);
  const [conversationFilesError, setConversationFilesError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<TransactionSummary | null>(null);
  const [isResolvingActionId, setIsResolvingActionId] = useState<string | null>(null);
  const [isQueueingPdf, setIsQueueingPdf] = useState(false);
  const [latestPdfJob, setLatestPdfJob] = useState<ServicePdfJob | null>(null);
  const [statusHistory, setStatusHistory] = useState<TransactionStatusHistoryItem[]>([]);
  const [payoutLedgerEntries, setPayoutLedgerEntries] = useState<PayoutLedgerEntry[]>([]);
  const [isLoadingTransactionAudit, setIsLoadingTransactionAudit] = useState(false);
  const [transactionAuditError, setTransactionAuditError] = useState<string | null>(null);
  const [payoutStatusActionId, setPayoutStatusActionId] = useState<string | null>(null);
  const [providerUserId, setProviderUserId] = useState("");
  const [providerLinkUrl, setProviderLinkUrl] = useState("");
  const [isCreatingProviderLink, setIsCreatingProviderLink] = useState(false);
  const [isOpeningDispute, setIsOpeningDispute] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const initialRecipientMessage =
    initialMessage || `Hello! I saw you were interested in ${propertyTitle}. Do you have any questions?`;

  const resolvedRequester = useMemo(
    () => ({
      id: requesterId || user?.id || "guest_user",
      name: requesterName || user?.name || "Guest User",
      role: requesterRole || user?.role || "buyer",
    }),
    [requesterId, requesterName, requesterRole, user?.id, user?.name, user?.role],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrapConversation = async () => {
      setIsInitializing(true);
      setLoadError(null);
      setIsLocalFallback(false);
      setConversationFilesError(null);

      try {
        if (initialConversationId) {
          const nextSenderId = resolvedRequester.id;
          const nextSenderName = resolvedRequester.name;

          setConversationId(initialConversationId);
          setResolvedSenderId(nextSenderId);
          setResolvedSenderName(nextSenderName);

          const history = await fetchConversationMessages(initialConversationId, nextSenderId);
          if (cancelled) return;

          setMessages(Array.isArray(history) ? history : []);
          return;
        }

        const upserted = await upsertConversation({
          requesterId: resolvedRequester.id,
          requesterName: resolvedRequester.name,
          requesterRole: resolvedRequester.role || undefined,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          subject: propertyTitle,
          listingId,
          initialMessage: initialRecipientMessage,
          conversationScope,
          serviceCode,
        });

        if (cancelled) return;

        const nextConversationId = String(upserted.conversation.id);
        const nextSenderId = String(upserted.requester.id || resolvedRequester.id);
        const nextSenderName = String(upserted.requester.name || resolvedRequester.name);

        setConversationId(nextConversationId);
        setResolvedSenderId(nextSenderId);
        setResolvedSenderName(nextSenderName);

        const history = await fetchConversationMessages(nextConversationId, nextSenderId);
        if (cancelled) return;

        setMessages(Array.isArray(history) ? history : []);
      } catch (error) {
        if (cancelled) return;

        const message = error instanceof Error ? error.message : "Unable to load chat history.";
        setLoadError(message);
        setIsLocalFallback(true);
        setConversationId(null);
        setResolvedSenderId(resolvedRequester.id);
        setResolvedSenderName(resolvedRequester.name);
        setMessages(buildFallbackMessages(initialRecipientMessage));
        setConversationFiles([]);
        setConversationFilesError(null);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    void bootstrapConversation();

    return () => {
      cancelled = true;
    };
  }, [
    initialConversationId,
    initialRecipientMessage,
    listingId,
    propertyTitle,
    recipient.id,
    recipient.name,
    recipient.role,
    resolvedRequester.id,
    resolvedRequester.name,
    resolvedRequester.role,
    conversationScope,
    serviceCode,
  ]);

  const refreshMessages = async (targetConversationId: string, viewerId: string): Promise<void> => {
    const history = await fetchConversationMessages(targetConversationId, viewerId);
    setMessages(Array.isArray(history) ? history : []);
  };

  const refreshConversationFiles = async (targetConversationId: string): Promise<void> => {
    const files = await fetchConversationFiles(targetConversationId);
    setConversationFiles(Array.isArray(files) ? files : []);
  };

  const refreshTransactionAudit = async (
    targetTransactionId: string,
    options?: { silent?: boolean },
  ): Promise<void> => {
    if (!targetTransactionId) {
      setStatusHistory([]);
      setPayoutLedgerEntries([]);
      setTransactionAuditError(null);
      return;
    }

    const isSilent = options?.silent === true;
    if (!isSilent) setIsLoadingTransactionAudit(true);

    try {
      const [historyRows, payoutRows] = await Promise.all([
        listTransactionStatusHistory(targetTransactionId, { limit: 80 }),
        listPayoutLedger(targetTransactionId, { limit: 80 }),
      ]);
      setStatusHistory(Array.isArray(historyRows) ? historyRows : []);
      setPayoutLedgerEntries(Array.isArray(payoutRows) ? payoutRows : []);
      setTransactionAuditError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load transaction timeline.";
      setStatusHistory([]);
      setPayoutLedgerEntries([]);
      setTransactionAuditError(message);
    } finally {
      if (!isSilent) setIsLoadingTransactionAudit(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadConversationFiles = async () => {
      if (!conversationId || isLocalFallback) {
        setConversationFiles([]);
        setConversationFilesError(null);
        setIsLoadingConversationFiles(false);
        return;
      }

      setIsLoadingConversationFiles(true);
      try {
        const files = await fetchConversationFiles(conversationId);
        if (!active) return;
        setConversationFiles(Array.isArray(files) ? files : []);
        setConversationFilesError(null);
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Failed to load conversation files.";
        setConversationFiles([]);
        setConversationFilesError(message);
      } finally {
        if (active) {
          setIsLoadingConversationFiles(false);
        }
      }
    };

    void loadConversationFiles();
    return () => {
      active = false;
    };
  }, [conversationId, isLocalFallback]);

  useEffect(() => {
    let active = true;

    const loadAutomationState = async () => {
      if (!conversationId || isLocalFallback) {
        setTransaction(null);
        setLatestPdfJob(null);
        setStatusHistory([]);
        setPayoutLedgerEntries([]);
        setTransactionAuditError(null);
        return;
      }

      try {
        let resolvedTransaction = await getTransactionByConversation(conversationId);
        if (
          !resolvedTransaction &&
          conversationScope === "service" &&
          user?.id
        ) {
          resolvedTransaction = await upsertTransactionForConversation({
            conversationId,
            transactionKind: "service",
            status: "service_intake_pending",
            buyerUserId: user.id,
            providerUserId: isUuid(recipient.id) ? recipient.id : undefined,
          });
        }

        if (!active) return;
        setTransaction(resolvedTransaction);
        if (resolvedTransaction?.id) {
          await refreshTransactionAudit(resolvedTransaction.id);
        } else {
          setStatusHistory([]);
          setPayoutLedgerEntries([]);
          setTransactionAuditError(null);
        }
      } catch {
        if (!active) return;
        setTransaction(null);
        setStatusHistory([]);
        setPayoutLedgerEntries([]);
        setTransactionAuditError(null);
      }

      if (conversationScope === "service") {
        try {
          const jobs = await listServicePdfJobsByConversation(conversationId);
          if (!active) return;
          setLatestPdfJob(jobs[0] ?? null);
        } catch {
          if (!active) return;
          setLatestPdfJob(null);
        }
      }
    };

    void loadAutomationState();
    return () => {
      active = false;
    };
  }, [conversationId, conversationScope, isLocalFallback, recipient.id, user?.id]);

  const handleSend = async () => {
    const content = newMessage.trim();
    if ((!content && pendingFiles.length === 0) || isSending) return;

    setNewMessage("");

    if (!conversationId || isLocalFallback) {
      const createdAt = new Date().toISOString();
      const localText =
        content ||
        (pendingFiles.length === 1
          ? `Shared attachment: ${pendingFiles[0].name}`
          : `Shared ${pendingFiles.length} attachments`);
      setMessages((current) => [
        ...current,
        {
          id: `local-${Date.now()}`,
          sender: "me",
          content: localText,
          time: formatLocalTime(createdAt),
          createdAt,
          senderId: resolvedSenderId || resolvedRequester.id,
          messageType: "text",
        },
      ]);
      setPendingFiles([]);
      return;
    }

    setIsSending(true);
    setLoadError(null);

    try {
      const attachments =
        pendingFiles.length > 0
          ? await uploadConversationAttachments({
              conversationId,
              senderId: resolvedSenderId || resolvedRequester.id,
              scope: conversationScope,
              files: pendingFiles,
            })
          : undefined;

      const messageContent =
        content ||
        (pendingFiles.length === 1
          ? `Shared attachment: ${pendingFiles[0].name}`
          : `Shared ${pendingFiles.length} attachments`);

      const saved = await sendConversationMessage({
        conversationId,
        senderId: resolvedSenderId || resolvedRequester.id,
        senderName: resolvedSenderName || resolvedRequester.name,
        senderRole: resolvedRequester.role || undefined,
        content: messageContent,
        attachments,
      });

      setMessages((current) => [...current, saved]);
      try {
        await refreshConversationFiles(conversationId);
        setConversationFilesError(null);
      } catch (filesError) {
        const message =
          filesError instanceof Error ? filesError.message : "Failed to refresh conversation files.";
        setConversationFilesError(message);
      }
      setPendingFiles([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message.";
      setLoadError(message);

      const createdAt = new Date().toISOString();
      const fallbackContent =
        content ||
        (pendingFiles.length === 1
          ? `Shared attachment: ${pendingFiles[0].name}`
          : `Shared ${pendingFiles.length} attachments`);
      setMessages((current) => [
        ...current,
        {
          id: `local-${Date.now()}`,
          sender: "me",
          content: fallbackContent,
          time: formatLocalTime(createdAt),
          createdAt,
          senderId: resolvedSenderId || resolvedRequester.id,
          messageType: "text",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleResolveAction = async (
    action: TransactionAction,
    decision: "accept" | "decline" | "submit",
  ) => {
    if (!user?.id) {
      toast({
        title: "Sign in required",
        description: "Please sign in to resolve this action card.",
        variant: "destructive",
      });
      return;
    }

    setIsResolvingActionId(action.id);
    setLoadError(null);
    try {
      const result = await resolveTransactionAction({
        actionId: action.id,
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role ?? undefined,
        decision,
      });
      setTransaction(result.transaction);
      if (result.transaction?.id) {
        await refreshTransactionAudit(result.transaction.id, { silent: true });
      }
      if (conversationId) {
        await refreshMessages(conversationId, resolvedSenderId || resolvedRequester.id);
      }
      if (result.warnings && result.warnings.length > 0) {
        toast({
          title: "Action resolved with warnings",
          description: result.warnings[0],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve action.";
      setLoadError(message);
      toast({
        title: "Action failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsResolvingActionId(null);
    }
  };

  const handleQueueServicePdf = async () => {
    if (!conversationId || !user?.id) return;

    setIsQueueingPdf(true);
    setLoadError(null);
    try {
      const job = await queueServicePdfJob({
        conversationId,
        transactionId: transaction?.id,
        createdByUserId: user.id,
        actorRole: user.role ?? undefined,
      });
      setLatestPdfJob(job);
      try {
        await refreshConversationFiles(conversationId);
        setConversationFilesError(null);
      } catch (filesError) {
        const message =
          filesError instanceof Error ? filesError.message : "Failed to refresh conversation files.";
        setConversationFilesError(message);
      }
      toast({
        title: "PDF job queued",
        description: "The service transcript PDF is queued for background generation.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to queue PDF job.";
      setLoadError(message);
      toast({
        title: "Queue failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsQueueingPdf(false);
    }
  };

  const handleCreateProviderLink = async () => {
    if (!conversationId || !user?.id) return;

    setIsCreatingProviderLink(true);
    setLoadError(null);
    try {
      const created = await createProviderLink({
        conversationId,
        providerUserId: providerUserId.trim() || undefined,
        createdByUserId: user.id,
        createdByRole: user.role ?? undefined,
        payload: {
          source: "chat_interface",
          conversationScope,
          propertyTitle,
        },
      });
      setProviderLinkUrl(created.packageUrl);
      toast({
        title: "Provider link created",
        description: "Secure package link is ready to share with the assigned provider.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create provider link.";
      setLoadError(message);
      toast({
        title: "Provider link failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsCreatingProviderLink(false);
    }
  };

  const handleOpenDispute = async () => {
    if (!transaction?.id || !conversationId || !user?.id) return;

    const reason = window.prompt("Enter dispute reason:");
    if (!reason || !reason.trim()) return;
    const details = window.prompt("Add more details (optional):") ?? "";

    setIsOpeningDispute(true);
    setLoadError(null);
    try {
      await openDispute({
        transactionId: transaction.id,
        conversationId,
        reason: reason.trim(),
        details: details.trim() || undefined,
        openedByUserId: user.id,
        openedByName: user.name,
        openedByRole: user.role ?? undefined,
      });
      const refreshed = await getTransactionByConversation(conversationId);
      setTransaction(refreshed);
      if (refreshed?.id) {
        await refreshTransactionAudit(refreshed.id, { silent: true });
      }
      await refreshMessages(conversationId, resolvedSenderId || resolvedRequester.id);
      toast({
        title: "Dispute opened",
        description: "Escrow is frozen pending admin resolution.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open dispute.";
      setLoadError(message);
      toast({
        title: "Dispute failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsOpeningDispute(false);
    }
  };

  const handleUpdatePayoutLedgerStatus = async (
    entry: PayoutLedgerEntry,
    nextStatus: PayoutLedgerStatus,
  ) => {
    if (!user?.id) return;
    setPayoutStatusActionId(entry.id);
    setLoadError(null);
    try {
      const updated = await updatePayoutLedgerStatus({
        entryId: entry.id,
        status: nextStatus,
        actorRole: user.role ?? undefined,
        actorUserId: user.id,
      });
      setPayoutLedgerEntries((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (transaction?.id) {
        await refreshTransactionAudit(transaction.id, { silent: true });
      }
      toast({
        title: "Payout ledger updated",
        description: `Entry marked ${nextStatus}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update payout ledger status.";
      setLoadError(message);
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPayoutStatusActionId(null);
    }
  };

  const canUseServiceAutomationTools =
    conversationScope === "service" &&
    Boolean(conversationId) &&
    !isLocalFallback &&
    ["admin", "support", "agent"].includes(normalizeUserRole(user?.role));

  const canOpenDispute =
    Boolean(transaction?.id) &&
    !isLocalFallback &&
    transaction?.status !== "completed" &&
    transaction?.status !== "closed" &&
    transaction?.status !== "cancelled";

  const canManagePayoutLedger =
    Boolean(transaction?.id) &&
    !isLocalFallback &&
    ["admin", "support"].includes(normalizeUserRole(user?.role));

  return (
    <div className="flex flex-col h-[500px] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar>
              <AvatarImage src={recipient.image} />
              <AvatarFallback>{recipient.name.charAt(0)}</AvatarFallback>
            </Avatar>
            {recipient.verified && (
              <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-green-600 fill-green-100" />
              </div>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">{recipient.name}</h3>
            <p className="text-xs text-slate-500 truncate max-w-[220px]">Re: {propertyTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canUseServiceAutomationTools && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void handleQueueServicePdf()}
                disabled={isQueueingPdf}
              >
                {isQueueingPdf ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1 h-3.5 w-3.5" />}
                Queue PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void handleCreateProviderLink()}
                disabled={isCreatingProviderLink}
              >
                {isCreatingProviderLink ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="mr-1 h-3.5 w-3.5" />
                )}
                Provider Link
              </Button>
            </>
          )}
          {canOpenDispute && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => void handleOpenDispute()}
              disabled={isOpeningDispute}
            >
              {isOpeningDispute ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              )}
              Dispute
            </Button>
          )}
          <Button variant="ghost" size="icon">
            <MoreVertical className="w-4 h-4 text-slate-400" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4 bg-slate-50/30">
        {isInitializing ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-500">
            Loading conversation...
          </div>
        ) : (
          <div className="space-y-4">
            {(isLoadingConversationFiles || conversationFiles.length > 0 || conversationFilesError) && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Conversation Files
                  </p>
                  {isLoadingConversationFiles && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Syncing...
                    </span>
                  )}
                </div>
                {conversationFilesError && (
                  <p className="mt-2 text-xs text-amber-700">{conversationFilesError}</p>
                )}
                {!isLoadingConversationFiles && conversationFiles.length === 0 && !conversationFilesError && (
                  <p className="mt-2 text-xs text-slate-500">No files shared yet.</p>
                )}
                {conversationFiles.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {conversationFiles.slice(0, 8).map((file) => {
                      const fileLabel = file.kind === "transcript" ? "Transcript" : "Attachment";
                      const fileHref = String(file.previewUrl ?? "").trim();
                      const createdAt = file.createdAt ? new Date(file.createdAt) : null;
                      const createdLabel =
                        createdAt && !Number.isNaN(createdAt.getTime())
                          ? createdAt.toLocaleString()
                          : "Unknown time";

                      return (
                        <a
                          key={file.id}
                          href={fileHref || "#"}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            if (!fileHref) event.preventDefault();
                          }}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                            fileHref
                              ? "border-slate-200 bg-slate-50 hover:bg-slate-100"
                              : "border-slate-100 bg-slate-50 text-slate-400",
                          )}
                        >
                          {file.kind === "transcript" ? (
                            <Link2 className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{file.fileName}</p>
                            <p className="truncate text-[10px] text-slate-500">
                              {fileLabel}  |  {createdLabel}
                            </p>
                          </div>
                          {fileHref && <ExternalLink className="h-3.5 w-3.5 shrink-0" />}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {(isLoadingTransactionAudit ||
              statusHistory.length > 0 ||
              payoutLedgerEntries.length > 0 ||
              transactionAuditError) && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Transaction Timeline
                  </p>
                  {isLoadingTransactionAudit && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Syncing...
                    </span>
                  )}
                </div>
                {transactionAuditError && (
                  <p className="mt-2 text-xs text-amber-700">{transactionAuditError}</p>
                )}
                {!isLoadingTransactionAudit && statusHistory.length === 0 && !transactionAuditError && (
                  <p className="mt-2 text-xs text-slate-500">No transaction timeline events yet.</p>
                )}
                {statusHistory.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {statusHistory.slice(0, 6).map((event) => (
                      <div
                        key={event.id}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs"
                      >
                        <p className="font-medium text-slate-800">
                          {event.fromStatus && event.fromStatus !== event.toStatus
                            ? `${event.fromStatus} -> ${event.toStatus}`
                            : event.toStatus}
                        </p>
                        {event.reason && <p className="text-slate-600">{event.reason}</p>}
                        <p className="text-[10px] text-slate-500">
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {(payoutLedgerEntries.length > 0 || canManagePayoutLedger) && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Payout Ledger
                    </p>
                    {payoutLedgerEntries.length === 0 && !isLoadingTransactionAudit ? (
                      <p className="mt-2 text-xs text-slate-500">No payout ledger entries yet.</p>
                    ) : (
                      <div className="mt-2 grid gap-2">
                        {payoutLedgerEntries.slice(0, 6).map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-slate-800">
                                {entry.ledgerType.replace(/_/g, " ")} -{" "}
                                {formatAmount(entry.amount, entry.currency)}
                              </p>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${payoutStatusBadgeClass(
                                  entry.status,
                                )}`}
                              >
                                {entry.status}
                              </span>
                            </div>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {new Date(entry.createdAt).toLocaleString()}
                              {entry.reference ? `  |  Ref: ${entry.reference}` : ""}
                            </p>
                            {canManagePayoutLedger && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {(["paid", "failed", "cancelled"] as const).map((nextStatus) => (
                                  <Button
                                    key={`${entry.id}-${nextStatus}`}
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-[10px]"
                                    disabled={
                                      payoutStatusActionId === entry.id || entry.status === nextStatus
                                    }
                                    onClick={() => void handleUpdatePayoutLedgerStatus(entry, nextStatus)}
                                  >
                                    {nextStatus}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex w-full",
                  msg.sender === "me" ? "justify-end" : "justify-start",
                  msg.sender === "system" ? "justify-center" : "",
                )}
              >
                {msg.sender === "system" ? (
                  <div className="bg-amber-50 text-amber-800 text-xs px-3 py-1.5 rounded-full border border-amber-100 flex items-center gap-1.5 max-w-[90%] text-center">
                    <ShieldCheck className="w-3 h-3" />
                    {msg.content}
                  </div>
                ) : (
                  (() => {
                    const issueCard = parseIssueCard(msg);
                    const actionCard = parseActionCard(msg);
                    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                    const canResolveCurrentAction =
                      actionCard && canResolveAction(actionCard, user?.role);
                    const actionPending = actionCard?.status === "pending";

                    return (
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl px-4 py-2 text-sm",
                          msg.sender === "me"
                            ? "bg-blue-600 text-white rounded-br-none"
                            : "bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm",
                        )}
                      >
                        {issueCard ? (
                          <div
                            className={cn(
                              "rounded-xl border px-3 py-2",
                              msg.sender === "me"
                                ? "border-blue-300/60 bg-blue-500/40"
                                : "border-amber-200 bg-amber-50",
                            )}
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide opacity-90">
                              {issueCard.title}
                            </p>
                            {(issueCard.problemTag || issueCard.status) && (
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] opacity-90">
                                {issueCard.problemTag && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    {issueCard.problemTag}
                                  </span>
                                )}
                                {issueCard.status && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    {issueCard.status}
                                  </span>
                                )}
                              </div>
                            )}
                            <p className="mt-2 text-sm">{issueCard.detail}</p>
                            {actionCard && (
                              <div className="mt-2 space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] opacity-90">
                                  <span className="rounded-full border px-2 py-0.5">
                                    Action: {actionCard.actionType.replace(/_/g, " ")}
                                  </span>
                                  <span className="rounded-full border px-2 py-0.5">
                                    Target: {actionCard.targetRole}
                                  </span>
                                  {actionCard.expiresAt && (
                                    <span className="rounded-full border px-2 py-0.5">
                                      Expires: {new Date(actionCard.expiresAt).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                                {canResolveCurrentAction && actionPending && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      size="sm"
                                      className="h-7"
                                      disabled={isResolvingActionId === actionCard.id}
                                      onClick={() =>
                                        void handleResolveAction(
                                          actionCard,
                                          actionCard.actionType === "upload_payment_proof" ||
                                            actionCard.actionType === "upload_signed_closing_contract" ||
                                            actionCard.actionType === "upload_service_deliverable"
                                            ? "submit"
                                            : "accept",
                                        )
                                      }
                                    >
                                      {isResolvingActionId === actionCard.id ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : null}
                                      {resolveActionPrimaryLabel(actionCard.actionType)}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7"
                                      disabled={isResolvingActionId === actionCard.id}
                                      onClick={() =>
                                        void handleResolveAction(actionCard, "decline")
                                      }
                                    >
                                      {resolveActionSecondaryLabel(actionCard.actionType)}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p>{msg.content}</p>
                        )}
                        {attachments.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {attachments.map((attachment, index) => {
                              const previewUrl = String(attachment.previewUrl ?? "").trim();
                              const fileName = String(attachment.fileName ?? "Attachment");
                              const isImage = isImageAttachment(attachment.mimeType);

                              if (previewUrl && isImage) {
                                return (
                                  <a
                                    key={`${attachment.storagePath}-${index}`}
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(
                                      "block rounded-lg border overflow-hidden",
                                      msg.sender === "me"
                                        ? "border-blue-300/70"
                                        : "border-slate-200 bg-slate-50",
                                    )}
                                  >
                                    <img
                                      src={previewUrl}
                                      alt={fileName}
                                      className="max-h-44 w-full object-cover"
                                      loading="lazy"
                                    />
                                    <div className="flex items-center justify-between px-2 py-1 text-[11px]">
                                      <span className="truncate">{fileName}</span>
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                    </div>
                                  </a>
                                );
                              }

                              if (previewUrl) {
                                return (
                                  <a
                                    key={`${attachment.storagePath}-${index}`}
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(
                                      "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
                                      msg.sender === "me"
                                        ? "border-blue-300/70 hover:bg-blue-500/30"
                                        : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                                    )}
                                  >
                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{fileName}</span>
                                    <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0" />
                                  </a>
                                );
                              }

                              return (
                                <div
                                  key={`${attachment.storagePath}-${index}`}
                                  className={cn(
                                    "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
                                    msg.sender === "me"
                                      ? "border-blue-300/70"
                                      : "border-slate-200 bg-slate-50",
                                  )}
                                >
                                  {isImage ? (
                                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                                  ) : (
                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                  <span className="truncate">{fileName}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p
                          className={cn(
                            "text-[10px] mt-1 text-right",
                            msg.sender === "me" ? "text-blue-100" : "text-slate-400",
                          )}
                        >
                          {msg.time}
                        </p>
                      </div>
                    );
                  })()
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="p-3 bg-white border-t border-slate-100 space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length === 0) return;

            setPendingFiles((current) => {
              const existing = new Set(
                current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
              );
              const merged = [...current];
              selected.forEach((file) => {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                if (!existing.has(key)) {
                  existing.add(key);
                  merged.push(file);
                }
              });
              return merged.slice(0, 5);
            });

            event.currentTarget.value = "";
          }}
        />
        {canUseServiceAutomationTools && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input
                placeholder="Provider user UUID (optional)"
                value={providerUserId}
                onChange={(event) => setProviderUserId(event.target.value)}
                className="h-8 bg-white"
              />
              {providerLinkUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(providerLinkUrl);
                      toast({ title: "Copied", description: "Provider package link copied." });
                    } catch {
                      toast({
                        title: "Copy failed",
                        description: "Copy the provider link manually.",
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  Copy Link
                </Button>
              )}
            </div>
            {providerLinkUrl && (
              <p className="truncate text-xs text-blue-700">
                Provider package:{" "}
                <a href={providerLinkUrl} target="_blank" rel="noreferrer" className="underline">
                  {providerLinkUrl}
                </a>
              </p>
            )}
            {latestPdfJob && (
              <p className="text-xs text-slate-600">
                PDF job: <span className="font-medium">{latestPdfJob.status}</span>
                {latestPdfJob.outputPath ? `  •  ${latestPdfJob.outputPath}` : ""}
              </p>
            )}
          </div>
        )}
        {loadError && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">
            {isLocalFallback
              ? "Chat sync unavailable, using local temporary messages."
              : loadError}
          </p>
        )}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
              >
                <span className="max-w-[180px] truncate">{file.name}</span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700"
                  onClick={() =>
                    setPendingFiles((current) =>
                      current.filter((candidate, candidateIndex) => {
                        const sameFile =
                          candidate.name === file.name &&
                          candidate.size === file.size &&
                          candidate.lastModified === file.lastModified;
                        return !(sameFile && candidateIndex === index);
                      }),
                    )
                  }
                  disabled={isSending}
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:text-slate-600 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isInitializing || isSending}
            title="Attach files"
          >
            <Paperclip className="w-5 h-5" />
          </Button>
          <Input
            placeholder="Type a message..."
            className="flex-1 bg-slate-50 border-transparent focus-visible:ring-1 focus-visible:ring-blue-500"
            value={newMessage}
            onChange={(event) => setNewMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSend();
              }
            }}
            disabled={isInitializing || isSending}
          />
          <Button
            size="icon"
            className="bg-blue-600 hover:bg-blue-700 shrink-0"
            onClick={() => void handleSend()}
            disabled={
              isInitializing || isSending || (!newMessage.trim() && pendingFiles.length === 0)
            }
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
