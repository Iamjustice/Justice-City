import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
  MoreHorizontal,
  MessageSquare,
  Eye,
  Pencil,
  Archive,
  Trash2,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChatInterface } from "@/components/chat-interface";
import { useToast } from "@/hooks/use-toast";
import { fetchUserConversations, type ChatConversation } from "@/lib/chat";
import {
  fetchAgentProfile,
  updateAgentProfile,
  type AgentDashboardProfile,
} from "@/lib/agent-profiles";
import {
  createUtilityBill,
  deleteUtilityBill,
  fetchUtilityBills,
  updateUtilityBill,
  type UtilityBill,
  type UtilityBillStatus,
  type UtilityBillType,
} from "@/lib/utility-bills";
import {
  createPropertyExpense,
  deletePropertyExpense,
  fetchPropertyExpenses,
  type PropertyExpense,
  type PropertyExpenseCategory,
} from "@/lib/property-expenses";
import {
  createUserDocument,
  fetchUserDocuments,
  type UserDocumentRecord,
  type UserDocumentType,
} from "@/lib/user-documents";
import {
  deleteAgentListing as deleteAgentListingApi,
  fetchAgentListings,
  updateAgentListing as updateAgentListingApi,
  updateAgentListingPayoutStatus as updateAgentListingPayoutStatusApi,
  updateAgentListingVerificationStepStatus as updateAgentListingVerificationStepStatusApi,
  type AgentListingVerificationStep,
  type AgentListingVerificationStepStatus,
  updateAgentListingStatus as updateAgentListingStatusApi,
  type AgentListingStatus,
  type AgentPayoutStatus,
} from "@/lib/agent-listings";

type VerificationStepStatus = AgentListingVerificationStepStatus;
type VerificationStep = AgentListingVerificationStep;

const TOTAL_COMMISSION_RATE = 0.05;
const AGENT_COMMISSION_SHARE = 0.6;
const COMPANY_COMMISSION_SHARE = 0.4;
const AGENT_COMMISSION_RATE = TOTAL_COMMISSION_RATE * AGENT_COMMISSION_SHARE;
const COMPANY_COMMISSION_RATE = TOTAL_COMMISSION_RATE * COMPANY_COMMISSION_SHARE;

function parseNairaAmount(value: string): number {
  const parsed = Number((value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNaira(amount: number): string {
  return `N${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Math.max(amount, 0))}`;
}

function normalizePrice(price: string): string {
  const hasYearSuffix = (price ?? "").toLowerCase().includes("/yr");
  const amount = parseNairaAmount(price);
  return hasYearSuffix ? `${formatNaira(amount)}/yr` : formatNaira(amount);
}

function toStatusLabel(status: VerificationStepStatus): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In Progress";
  if (status === "blocked") return "Blocked";
  return "Pending";
}

function statusBadgeClass(status: VerificationStepStatus): string {
  if (status === "completed") return "bg-green-100 text-green-700 border-green-200";
  if (status === "in_progress") return "bg-blue-100 text-blue-700 border-blue-200";
  if (status === "blocked") return "bg-red-100 text-red-700 border-red-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function listingBadgeClass(status: string): string {
  if (status === "Published") return "bg-green-100 text-green-700 border-green-200";
  if (status === "Pending Review") return "bg-amber-100 text-amber-700 border-amber-200";
  if (status === "Sold") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "Rented") return "bg-indigo-100 text-indigo-700 border-indigo-200";
  if (status === "Archived") return "bg-slate-200 text-slate-700 border-slate-300";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function utilityBillBadgeClass(status: UtilityBillStatus): string {
  if (status === "Paid") return "bg-green-100 text-green-700 border-green-200";
  if (status === "Overdue") return "bg-red-100 text-red-700 border-red-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

function deriveUtilityBillStatus(bill: UtilityBill): UtilityBillStatus {
  if (bill.status !== "Pending") return bill.status;
  const dueAt = bill.dueDate ? new Date(bill.dueDate).getTime() : Number.NaN;
  if (Number.isFinite(dueAt) && dueAt < Date.now()) return "Overdue";
  return "Pending";
}

function ensureVerificationSteps(listing: any): VerificationStep[] {
  const existing = Array.isArray(listing?.verificationSteps) ? listing.verificationSteps : [];
  if (existing.length > 0) {
    return existing.map((step: any) => ({
      key: String(step.key),
      label: String(step.label),
      description: String(step.description),
      status: (step.status as VerificationStepStatus) ?? "pending",
    }));
  }
  return [];
}

function progressValue(steps: VerificationStep[]): number {
  if (steps.length === 0) return 0;
  const total = steps.reduce((sum, step) => {
    if (step.status === "completed") return sum + 1;
    if (step.status === "in_progress") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((total / steps.length) * 100);
}

function formatRelativeSubmitted(dateLabel: string): string {
  const parsed = new Date(dateLabel);
  if (Number.isNaN(parsed.getTime())) return "Submitted recently";
  const now = Date.now();
  const diffDays = Math.max(Math.round((now - parsed.getTime()) / (1000 * 60 * 60 * 24)), 0);
  if (diffDays === 0) return "Submitted today";
  if (diffDays === 1) return "Submitted yesterday";
  return `Submitted ${diffDays} days ago`;
}

function isClosedDealStatus(status: string): boolean {
  return status === "Sold" || status === "Rented";
}

function isUuidListingId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function calculateCommissionBreakdownFromPrice(price: string) {
  const dealAmount = parseNairaAmount(price);
  const totalCommission = dealAmount * TOTAL_COMMISSION_RATE;
  const agentCommission = totalCommission * AGENT_COMMISSION_SHARE;
  const companyCommission = totalCommission * COMPANY_COMMISSION_SHARE;

  return {
    dealAmount,
    totalCommission,
    agentCommission,
    companyCommission,
  };
}

export default function ModernAgentDashboardView({
  listings,
  leads,
  handleCreateListing,
  onListingsChange,
  setIsVerificationModalOpen,
  user,
}: any) {
  const { toast } = useToast();
  const role = String(user?.role ?? "").toLowerCase();
  const isAdmin = role === "admin";
  const canEditVerificationProgress = isAdmin;
  const canViewBills = role === "owner" || role === "admin";
  const canManageBills = role === "owner" || role === "admin";
  const canViewExpenses = role === "owner" || role === "admin";
  const canManageExpenses = role === "owner" || role === "admin";
  const dashboardTitle =
    role === "admin"
      ? "Admin Listings Console"
      : role === "seller"
        ? "Seller Listings Console"
        : role === "owner"
          ? "Owner Listings Console"
          : "Agent Dashboard";
  const dashboardDescription = isAdmin
    ? "Create, edit, and manage listings across all platform roles."
    : "Manage your listings and track performance.";
  const policyLabel = isAdmin ? "Platform Policy" : "Standard Policy";
  const viewerId = String(user?.id ?? "").trim();
  const canViewDocuments = Boolean(viewerId);
  const canManageDocuments = role === "admin" || role === "agent" || role === "seller" || role === "owner";
  const canModifyListing = (listing: any): boolean => {
    const listingOwnerId = String(listing?.agentId ?? "").trim();
    if (isAdmin) return true;
    if (!listingOwnerId) return false;
    return listingOwnerId === viewerId;
  };
  const canTransitionListingStatus = (
    listing: any,
    nextStatus: AgentListingStatus,
  ): { allowed: true } | { allowed: false; reason: string } => {
    if (isAdmin) return { allowed: true };

    const currentStatus = String(listing?.status ?? "Draft");
    if (nextStatus === "Published" && currentStatus !== "Published") {
      return { allowed: false, reason: "Listings can only be published after admin approval." };
    }

    if (
      (nextStatus === "Sold" || nextStatus === "Rented") &&
      currentStatus !== "Published" &&
      currentStatus !== "Sold" &&
      currentStatus !== "Rented"
    ) {
      return { allowed: false, reason: "Only published listings can be marked sold or rented." };
    }

    return { allowed: true };
  };
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [selectedServerConversation, setSelectedServerConversation] =
    useState<ChatConversation | null>(null);
  const [serverConversations, setServerConversations] = useState<ChatConversation[]>([]);
  const [isLoadingServerConversations, setIsLoadingServerConversations] = useState(false);
  const [serverConversationsError, setServerConversationsError] = useState<string | null>(null);
  const [isLoadingListingsFromDb, setIsLoadingListingsFromDb] = useState(false);
  const [listingSyncError, setListingSyncError] = useState<string | null>(null);
  const [listingActionInFlightId, setListingActionInFlightId] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [editingListing, setEditingListing] = useState<any>(null);
  const [verificationListing, setVerificationListing] = useState<any>(null);
  const [editingForm, setEditingForm] = useState({
    title: "",
    listingType: "Sale",
    location: "",
    price: "",
    status: "Draft",
    description: "",
  });
  const [agentProfile, setAgentProfile] = useState<AgentDashboardProfile | null>(null);
  const [isLoadingAgentProfile, setIsLoadingAgentProfile] = useState(false);
  const [agentProfileError, setAgentProfileError] = useState<string | null>(null);
  const [isEditingAgentProfile, setIsEditingAgentProfile] = useState(false);
  const [isSavingAgentProfile, setIsSavingAgentProfile] = useState(false);
  const [agentProfileForm, setAgentProfileForm] = useState({
    displayName: "",
    bio: "",
  });
  const [utilityBills, setUtilityBills] = useState<UtilityBill[]>([]);
  const [isLoadingUtilityBills, setIsLoadingUtilityBills] = useState(false);
  const [utilityBillsError, setUtilityBillsError] = useState<string | null>(null);
  const [utilityBillActionId, setUtilityBillActionId] = useState<string | null>(null);
  const [isCreatingUtilityBill, setIsCreatingUtilityBill] = useState(false);
  const [utilityBillForm, setUtilityBillForm] = useState<{
    billType: UtilityBillType;
    amount: string;
    dueDate: string;
    notes: string;
  }>({
    billType: "Electricity",
    amount: "",
    dueDate: "",
    notes: "",
  });
  const [propertyExpenses, setPropertyExpenses] = useState<PropertyExpense[]>([]);
  const [isLoadingPropertyExpenses, setIsLoadingPropertyExpenses] = useState(false);
  const [propertyExpensesError, setPropertyExpensesError] = useState<string | null>(null);
  const [propertyExpenseActionId, setPropertyExpenseActionId] = useState<string | null>(null);
  const [isCreatingPropertyExpense, setIsCreatingPropertyExpense] = useState(false);
  const [expenseViewRange, setExpenseViewRange] = useState<"month" | "year">("month");
  const [propertyExpenseForm, setPropertyExpenseForm] = useState<{
    category: PropertyExpenseCategory;
    amount: string;
    expenseDate: string;
    notes: string;
  }>({
    category: "Maintenance",
    amount: "",
    expenseDate: "",
    notes: "",
  });
  const [userDocuments, setUserDocuments] = useState<UserDocumentRecord[]>([]);
  const [isLoadingUserDocuments, setIsLoadingUserDocuments] = useState(false);
  const [userDocumentsError, setUserDocumentsError] = useState<string | null>(null);
  const [isCreatingUserDocument, setIsCreatingUserDocument] = useState(false);
  const [userDocumentForm, setUserDocumentForm] = useState<{
    documentType: UserDocumentType;
    bucketId: string;
    storagePath: string;
    displayName: string;
    listingId: string;
    conversationId: string;
  }>({
    documentType: "Attachment",
    bucketId: "service-records",
    storagePath: "",
    displayName: "",
    listingId: "",
    conversationId: "",
  });

  useEffect(() => {
    let mounted = true;
    const userId = String(user?.id ?? "").trim();
    if (!userId) return undefined;

    setIsLoadingServerConversations(true);
    setServerConversationsError(null);
    void fetchUserConversations(userId, {
      viewerRole: user?.role ?? undefined,
      viewerName: user?.name ?? undefined,
    })
      .then((rows) => {
        if (!mounted) return;
        setServerConversations(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load chats.";
        setServerConversationsError(message);
        setServerConversations([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingServerConversations(false);
      });

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;
    const actorId = String(user?.id ?? "").trim();
    if (!actorId || typeof onListingsChange !== "function") return undefined;

    setIsLoadingListingsFromDb(true);
    setListingSyncError(null);

    void fetchAgentListings({
      actorId,
      actorRole: user?.role ?? undefined,
      actorName: user?.name ?? undefined,
    })
      .then((rows) => {
        if (!mounted) return;
        onListingsChange(() => (Array.isArray(rows) ? rows : []));
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load listings.";
        setListingSyncError(message);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingListingsFromDb(false);
      });

    return () => {
      mounted = false;
    };
  }, [onListingsChange, user?.id, user?.name, user?.role]);

  useEffect(() => {
    let mounted = true;
    if (!viewerId) {
      setAgentProfile(null);
      setAgentProfileError(null);
      setIsLoadingAgentProfile(false);
      return undefined;
    }

    setIsLoadingAgentProfile(true);
    setAgentProfileError(null);

    void fetchAgentProfile(viewerId)
      .then((profile) => {
        if (!mounted) return;
        setAgentProfile(profile);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load profile metrics.";
        setAgentProfileError(message);
        setAgentProfile(null);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingAgentProfile(false);
      });

    return () => {
      mounted = false;
    };
  }, [viewerId]);

  useEffect(() => {
    setAgentProfileForm({
      displayName: String(agentProfile?.displayName ?? user?.name ?? "").trim(),
      bio: String(agentProfile?.bio ?? "").trim(),
    });
  }, [agentProfile, user?.name]);

  useEffect(() => {
    let mounted = true;
    if (!canViewBills || !viewerId) {
      setUtilityBills([]);
      setUtilityBillsError(null);
      setIsLoadingUtilityBills(false);
      return undefined;
    }

    setIsLoadingUtilityBills(true);
    setUtilityBillsError(null);
    void fetchUtilityBills()
      .then((rows) => {
        if (!mounted) return;
        setUtilityBills(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load utility bills.";
        setUtilityBillsError(message);
        setUtilityBills([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingUtilityBills(false);
      });

    return () => {
      mounted = false;
    };
  }, [canViewBills, viewerId]);

  useEffect(() => {
    let mounted = true;
    if (!canViewExpenses || !viewerId) {
      setPropertyExpenses([]);
      setPropertyExpensesError(null);
      setIsLoadingPropertyExpenses(false);
      return undefined;
    }

    setIsLoadingPropertyExpenses(true);
    setPropertyExpensesError(null);
    void fetchPropertyExpenses()
      .then((rows) => {
        if (!mounted) return;
        setPropertyExpenses(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load property expenses.";
        setPropertyExpensesError(message);
        setPropertyExpenses([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingPropertyExpenses(false);
      });

    return () => {
      mounted = false;
    };
  }, [canViewExpenses, viewerId]);

  useEffect(() => {
    let mounted = true;
    if (!canViewDocuments || !viewerId) {
      setUserDocuments([]);
      setUserDocumentsError(null);
      setIsLoadingUserDocuments(false);
      return undefined;
    }

    setIsLoadingUserDocuments(true);
    setUserDocumentsError(null);
    void fetchUserDocuments({ userId: viewerId })
      .then((rows) => {
        if (!mounted) return;
        setUserDocuments(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load documents.";
        setUserDocumentsError(message);
        setUserDocuments([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingUserDocuments(false);
      });

    return () => {
      mounted = false;
    };
  }, [canViewDocuments, viewerId]);

  useEffect(() => {
    if (selectedListing) {
      const next = listings.find((item: any) => item.id === selectedListing.id);
      setSelectedListing(next ?? null);
    }

    if (verificationListing) {
      const next = listings.find((item: any) => item.id === verificationListing.id);
      setVerificationListing(next ?? null);
    }
  }, [listings, selectedListing, verificationListing]);

  const mutateListings = (updater: (current: any[]) => any[]) => {
    if (typeof onListingsChange === "function") {
      onListingsChange((current: any[]) => updater(current));
    }
  };

  const upsertListingInState = (updatedListing: any) => {
    mutateListings((current) => {
      const index = current.findIndex((item: any) => item.id === updatedListing.id);
      if (index === -1) return [updatedListing, ...current];
      return current.map((item: any) => (item.id === updatedListing.id ? updatedListing : item));
    });
  };

  const profileDisplayName =
    String(agentProfile?.displayName ?? user?.name ?? "").trim() || "Unnamed profile";
  const profileBio = String(agentProfile?.bio ?? "").trim();
  const profileSalesRating =
    typeof agentProfile?.salesRating === "number" && Number.isFinite(agentProfile.salesRating)
      ? agentProfile.salesRating
      : 0;
  const profileReviewCount =
    typeof agentProfile?.reviewCount === "number" ? Math.max(0, agentProfile.reviewCount) : 0;
  const profileRecentDealsCount =
    typeof agentProfile?.recentDealsCount === "number"
      ? Math.max(0, agentProfile.recentDealsCount)
      : 0;
  const profileClosedDealsCount =
    typeof agentProfile?.closedDealsCount === "number"
      ? Math.max(0, agentProfile.closedDealsCount)
      : 0;

  const saveAgentProfile = async () => {
    if (!viewerId) return;
    setIsSavingAgentProfile(true);
    try {
      const updated = await updateAgentProfile(viewerId, {
        displayName: agentProfileForm.displayName,
        bio: agentProfileForm.bio,
      });
      setAgentProfile(updated);
      setIsEditingAgentProfile(false);
      toast({
        title: "Profile updated",
        description: "Dashboard profile metrics are now synced.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update profile.";
      toast({
        title: "Profile update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSavingAgentProfile(false);
    }
  };

  const refreshUtilityBills = async () => {
    if (!canViewBills || !viewerId) return;
    setIsLoadingUtilityBills(true);
    setUtilityBillsError(null);
    try {
      const rows = await fetchUtilityBills();
      setUtilityBills(Array.isArray(rows) ? rows : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load utility bills.";
      setUtilityBillsError(message);
    } finally {
      setIsLoadingUtilityBills(false);
    }
  };

  const createNewUtilityBill = async () => {
    const amount = Number(utilityBillForm.amount.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid bill amount before saving.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingUtilityBill(true);
    try {
      const created = await createUtilityBill({
        billType: utilityBillForm.billType,
        amount,
        dueDate: utilityBillForm.dueDate || undefined,
        notes: utilityBillForm.notes || undefined,
      });
      setUtilityBills((current) => [created, ...current]);
      setUtilityBillForm({
        billType: "Electricity",
        amount: "",
        dueDate: "",
        notes: "",
      });
      toast({
        title: "Utility bill created",
        description: "The bill is now visible on your dashboard.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create utility bill.";
      toast({
        title: "Create failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsCreatingUtilityBill(false);
    }
  };

  const setUtilityBillStatus = async (bill: UtilityBill, status: UtilityBillStatus) => {
    setUtilityBillActionId(bill.id);
    try {
      const updated = await updateUtilityBill(bill.id, { status });
      setUtilityBills((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast({
        title: "Bill updated",
        description: `Status changed to ${status}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update bill status.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setUtilityBillActionId(null);
    }
  };

  const removeUtilityBill = async (bill: UtilityBill) => {
    setUtilityBillActionId(bill.id);
    try {
      await deleteUtilityBill(bill.id);
      setUtilityBills((current) => current.filter((item) => item.id !== bill.id));
      toast({
        title: "Bill deleted",
        description: "Utility bill removed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete utility bill.";
      toast({
        title: "Delete failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setUtilityBillActionId(null);
    }
  };

  const utilityBillsForView = useMemo(
    () =>
      utilityBills.map((bill) => ({
        ...bill,
        status: deriveUtilityBillStatus(bill),
      })),
    [utilityBills],
  );

  const refreshPropertyExpenses = async () => {
    if (!canViewExpenses || !viewerId) return;
    setIsLoadingPropertyExpenses(true);
    setPropertyExpensesError(null);
    try {
      const rows = await fetchPropertyExpenses();
      setPropertyExpenses(Array.isArray(rows) ? rows : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load property expenses.";
      setPropertyExpensesError(message);
    } finally {
      setIsLoadingPropertyExpenses(false);
    }
  };

  const createNewPropertyExpense = async () => {
    const amount = Number(propertyExpenseForm.amount.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid expense amount before saving.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingPropertyExpense(true);
    try {
      const created = await createPropertyExpense({
        category: propertyExpenseForm.category,
        amount,
        expenseDate: propertyExpenseForm.expenseDate || undefined,
        notes: propertyExpenseForm.notes || undefined,
      });
      setPropertyExpenses((current) => [created, ...current]);
      setPropertyExpenseForm({
        category: "Maintenance",
        amount: "",
        expenseDate: "",
        notes: "",
      });
      toast({
        title: "Expense recorded",
        description: "Property expense has been added.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create property expense.";
      toast({
        title: "Create failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsCreatingPropertyExpense(false);
    }
  };

  const removePropertyExpense = async (expense: PropertyExpense) => {
    setPropertyExpenseActionId(expense.id);
    try {
      await deletePropertyExpense(expense.id);
      setPropertyExpenses((current) => current.filter((item) => item.id !== expense.id));
      toast({
        title: "Expense deleted",
        description: "Expense entry removed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete property expense.";
      toast({
        title: "Delete failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPropertyExpenseActionId(null);
    }
  };

  const propertyExpensesInRange = useMemo(() => {
    const now = new Date();
    return propertyExpenses.filter((expense) => {
      const timestamp = expense.expenseDate ? new Date(expense.expenseDate).getTime() : Number.NaN;
      if (!Number.isFinite(timestamp)) return expenseViewRange === "year";
      const date = new Date(timestamp);
      if (expenseViewRange === "month") {
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      }
      return date.getFullYear() === now.getFullYear();
    });
  }, [expenseViewRange, propertyExpenses]);

  const propertyExpenseTotals = useMemo(() => {
    const total = propertyExpensesInRange.reduce((sum, expense) => sum + expense.amount, 0);
    const byCategory = propertyExpensesInRange.reduce<Record<string, number>>((acc, expense) => {
      const key = expense.category;
      acc[key] = (acc[key] ?? 0) + expense.amount;
      return acc;
    }, {});
    return { total, byCategory };
  }, [propertyExpensesInRange]);

  const refreshUserDocuments = async () => {
    if (!canViewDocuments || !viewerId) return;
    setIsLoadingUserDocuments(true);
    setUserDocumentsError(null);
    try {
      const rows = await fetchUserDocuments({ userId: viewerId });
      setUserDocuments(Array.isArray(rows) ? rows : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load documents.";
      setUserDocumentsError(message);
    } finally {
      setIsLoadingUserDocuments(false);
    }
  };

  const createNewUserDocument = async () => {
    const storagePath = userDocumentForm.storagePath.trim();
    if (!storagePath) {
      toast({
        title: "Storage path required",
        description: "Add a document URL or storage path before saving.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingUserDocument(true);
    try {
      const created = await createUserDocument({
        documentType: userDocumentForm.documentType,
        bucketId: userDocumentForm.bucketId.trim() || "service-records",
        storagePath,
        displayName: userDocumentForm.displayName.trim() || undefined,
        listingId: userDocumentForm.listingId.trim() || undefined,
        conversationId: userDocumentForm.conversationId.trim() || undefined,
      });
      setUserDocuments((current) => [created, ...current]);
      setUserDocumentForm({
        documentType: "Attachment",
        bucketId: "service-records",
        storagePath: "",
        displayName: "",
        listingId: "",
        conversationId: "",
      });
      toast({
        title: "Document added",
        description: "Document record is now in your timeline.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create document record.";
      toast({
        title: "Create failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsCreatingUserDocument(false);
    }
  };

  const openUserDocument = (document: UserDocumentRecord) => {
    const path = String(document.storagePath ?? "").trim();
    if (!path) return;
    if (/^https?:\/\//i.test(path)) {
      window.open(path, "_blank", "noopener,noreferrer");
      return;
    }
    toast({
      title: "Storage path",
      description: path,
    });
  };

  const closedDeals = useMemo(
    () => listings.filter((listing: any) => isClosedDealStatus(String(listing.status ?? ""))),
    [listings],
  );

  const closedDealsValue = useMemo(
    () =>
      closedDeals.reduce((sum: number, listing: any) => {
        if (typeof listing.dealAmount === "number") return sum + listing.dealAmount;
        return sum + parseNairaAmount(String(listing.price ?? ""));
      }, 0),
    [closedDeals],
  );

  const agentCommissionEarned = useMemo(
    () =>
      closedDeals.reduce((sum: number, listing: any) => {
        if (typeof listing.agentCommission === "number") return sum + listing.agentCommission;
        return sum + parseNairaAmount(String(listing.price ?? "")) * AGENT_COMMISSION_RATE;
      }, 0),
    [closedDeals],
  );

  const companyCommissionGenerated = useMemo(
    () =>
      closedDeals.reduce((sum: number, listing: any) => {
        if (typeof listing.companyCommission === "number") return sum + listing.companyCommission;
        return sum + parseNairaAmount(String(listing.price ?? "")) * COMPANY_COMMISSION_RATE;
      }, 0),
    [closedDeals],
  );

  const pendingPayouts = useMemo(
    () =>
      closedDeals.reduce((sum: number, listing: any) => {
        const commission =
          typeof listing.agentCommission === "number"
            ? listing.agentCommission
            : parseNairaAmount(String(listing.price ?? "")) * AGENT_COMMISSION_RATE;
        return listing.agentPayoutStatus === "Paid" ? sum : sum + commission;
      }, 0),
    [closedDeals],
  );

  const commissionData = [
    {
      label: "Closed Deals Value",
      value: formatNaira(closedDealsValue),
      icon: Building2,
      color: "text-blue-600",
    },
    {
      label: `Agent Commission (${(AGENT_COMMISSION_RATE * 100).toFixed(1)}%)`,
      value: formatNaira(agentCommissionEarned),
      icon: CheckCircle2,
      color: "text-green-600",
    },
    ...(isAdmin
      ? [
          {
            label: `Company Commission (${(COMPANY_COMMISSION_RATE * 100).toFixed(1)}%)`,
            value: formatNaira(companyCommissionGenerated),
            icon: ShieldCheck,
            color: "text-indigo-600",
          },
        ]
      : []),
    {
      label: "Pending Agent Payouts",
      value: formatNaira(pendingPayouts),
      icon: Clock,
      color: "text-amber-600",
    },
  ];

  const pendingVerificationListings = listings.filter((listing: any) => {
    if (listing.status === "Pending Review") return true;
    const steps = ensureVerificationSteps(listing);
    return steps.some((step) => step.status === "in_progress");
  });

  const openEditDialog = (listing: any) => {
    if (!canModifyListing(listing)) {
      toast({
        title: "Read-only listing",
        description: "You can only edit listings you own.",
        variant: "destructive",
      });
      return;
    }
    setEditingListing(listing);
    setEditingForm({
      title: String(listing.title ?? ""),
      listingType: String(listing.listingType ?? "Sale"),
      location: String(listing.location ?? ""),
      price: normalizePrice(String(listing.price ?? "")),
      status: String(listing.status ?? "Draft"),
      description: String(listing.description ?? ""),
    });
  };

  const saveEditedListing = async () => {
    if (!editingListing) return;
    if (!canModifyListing(editingListing)) {
      toast({
        title: "Permission denied",
        description: "You can only edit listings you own.",
        variant: "destructive",
      });
      return;
    }

    const title = editingForm.title.trim();
    const location = editingForm.location.trim();
    if (!title || !location) {
      toast({
        title: "Missing details",
        description: "Title and location are required.",
        variant: "destructive",
      });
      return;
    }

    const requestedStatus = editingForm.status as AgentListingStatus;
    const statusTransition = canTransitionListingStatus(editingListing, requestedStatus);
    if (!statusTransition.allowed) {
      toast({
        title: "Admin approval required",
        description: statusTransition.reason,
        variant: "destructive",
      });
      return;
    }

    const editingListingId = String(editingListing.id ?? "").trim();
    if (!isUuidListingId(editingListingId)) {
      const localUpdated = {
        ...editingListing,
        title,
        listingType: editingForm.listingType as "Sale" | "Rent",
        location,
        description: editingForm.description.trim() || "No description provided yet.",
        status: requestedStatus,
        price: normalizePrice(editingForm.price),
      };
      upsertListingInState(localUpdated);
      toast({
        title: "Listing updated",
        description: `${title} has been updated successfully.`,
      });
      setEditingListing(null);
      return;
    }

    const actorId = String(user?.id ?? "").trim();
    if (!actorId) {
      toast({
        title: "Unable to update listing",
        description: "Missing user context. Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setListingActionInFlightId(String(editingListing.id));
    try {
      const updated = await updateAgentListingApi(
        String(editingListing.id),
        {
          title,
          listingType: editingForm.listingType as "Sale" | "Rent",
          location,
          description: editingForm.description.trim() || "No description provided yet.",
          status: requestedStatus,
          price: editingForm.price,
        },
        {
          actorId,
          actorRole: user?.role ?? undefined,
          actorName: user?.name ?? undefined,
        },
      );

      const merged = {
        ...editingListing,
        ...updated,
      };
      upsertListingInState(merged);

      toast({
        title: "Listing updated",
        description: `${title} has been updated successfully.`,
      });
      setEditingListing(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update listing.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setListingActionInFlightId(null);
    }
  };

  const setListingStatus = async (listing: any, status: AgentListingStatus) => {
    if (!canModifyListing(listing)) {
      toast({
        title: "Permission denied",
        description: "You can only update listings you own.",
        variant: "destructive",
      });
      return;
    }
    const statusTransition = canTransitionListingStatus(listing, status);
    if (!statusTransition.allowed) {
      toast({
        title: "Admin approval required",
        description: statusTransition.reason,
        variant: "destructive",
      });
      return;
    }
    const listingId = String(listing?.id ?? "").trim();
    if (!isUuidListingId(listingId)) {
      const merged: any = {
        ...listing,
        status,
      };

      if (isClosedDealStatus(status)) {
        const breakdown = calculateCommissionBreakdownFromPrice(String(merged.price ?? ""));
        merged.dealAmount = breakdown.dealAmount;
        merged.totalCommission = breakdown.totalCommission;
        merged.agentCommission = breakdown.agentCommission;
        merged.companyCommission = breakdown.companyCommission;
        merged.agentPayoutStatus = merged.agentPayoutStatus ?? "Pending";
      } else {
        delete merged.dealAmount;
        delete merged.totalCommission;
        delete merged.agentCommission;
        delete merged.companyCommission;
        delete merged.agentPayoutStatus;
      }

      upsertListingInState(merged);
      toast({
        title: "Listing status updated",
        description: `${merged.title} is now ${status}.`,
      });
      return;
    }
    const actorId = String(user?.id ?? "").trim();
    if (!actorId) {
      toast({
        title: "Unable to update listing",
        description: "Missing user context. Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setListingActionInFlightId(String(listing.id));
    try {
      const updated = await updateAgentListingStatusApi(String(listing.id), status, {
        actorId,
        actorRole: user?.role ?? undefined,
        actorName: user?.name ?? undefined,
      });

      const merged = {
        ...listing,
        ...updated,
      };
      upsertListingInState(merged);

      if (isClosedDealStatus(status)) {
        const breakdown = calculateCommissionBreakdownFromPrice(String(merged.price ?? ""));
        const agentCommission =
          typeof merged.agentCommission === "number" ? merged.agentCommission : breakdown.agentCommission;

        toast({
          title: "Closed deal recorded",
          description: isAdmin
            ? `${merged.title}: Agent ${formatNaira(agentCommission)}, Company ${formatNaira(
                typeof merged.companyCommission === "number"
                  ? merged.companyCommission
                  : breakdown.companyCommission,
              )}.`
            : `${merged.title}: Agent ${formatNaira(agentCommission)}.`,
        });
        return;
      }

      toast({
        title: "Listing status updated",
        description: `${merged.title} is now ${status}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update listing status.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setListingActionInFlightId(null);
    }
  };

  const markAgentPayoutStatus = async (listing: any, payoutStatus: AgentPayoutStatus) => {
    if (!canModifyListing(listing)) {
      toast({
        title: "Permission denied",
        description: "You can only update payout for listings you own.",
        variant: "destructive",
      });
      return;
    }
    if (!isAdmin) {
      toast({
        title: "Admin action only",
        description: "Only admins can mark agent payouts as paid.",
        variant: "destructive",
      });
      return;
    }
    const listingId = String(listing?.id ?? "").trim();
    if (!isUuidListingId(listingId)) {
      const merged = { ...listing, agentPayoutStatus: payoutStatus };
      upsertListingInState(merged);
      toast({
        title: "Agent payout updated",
        description: `${merged.title}: payout marked ${payoutStatus}.`,
      });
      return;
    }
    const actorId = String(user?.id ?? "").trim();
    if (!actorId) {
      toast({
        title: "Unable to update payout",
        description: "Missing user context. Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setListingActionInFlightId(String(listing.id));
    try {
      const updated = await updateAgentListingPayoutStatusApi(String(listing.id), payoutStatus, {
        actorId,
        actorRole: user?.role ?? undefined,
        actorName: user?.name ?? undefined,
      });

      const merged = { ...listing, ...updated, agentPayoutStatus: payoutStatus };
      upsertListingInState(merged);

      toast({
        title: "Agent payout updated",
        description: `${merged.title}: payout marked ${payoutStatus}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update payout status.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setListingActionInFlightId(null);
    }
  };

  const deleteListing = async (listing: any) => {
    if (!canModifyListing(listing)) {
      toast({
        title: "Permission denied",
        description: "You can only delete listings you own.",
        variant: "destructive",
      });
      return;
    }
    const listingId = String(listing?.id ?? "").trim();
    if (!isUuidListingId(listingId)) {
      mutateListings((current) => current.filter((item) => item.id !== listing.id));
      setSelectedListing((current: any) => (current?.id === listing.id ? null : current));
      setVerificationListing((current: any) => (current?.id === listing.id ? null : current));
      toast({
        title: "Listing removed",
        description: `${listing.title} has been deleted from your dashboard.`,
      });
      return;
    }
    const actorId = String(user?.id ?? "").trim();
    if (!actorId) {
      toast({
        title: "Unable to delete listing",
        description: "Missing user context. Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setListingActionInFlightId(String(listing.id));
    try {
      await deleteAgentListingApi(String(listing.id), {
        actorId,
        actorRole: user?.role ?? undefined,
        actorName: user?.name ?? undefined,
      });

      mutateListings((current) => current.filter((item) => item.id !== listing.id));
      setSelectedListing((current: any) => (current?.id === listing.id ? null : current));
      setVerificationListing((current: any) => (current?.id === listing.id ? null : current));

      toast({
        title: "Listing removed",
        description: `${listing.title} has been deleted from your dashboard.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete listing.";
      toast({
        title: "Delete failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setListingActionInFlightId(null);
    }
  };

  const updateVerificationStepStatus = async (
    listing: any,
    stepKey: string,
    status: VerificationStepStatus,
  ) => {
    if (!canEditVerificationProgress) {
      toast({
        title: "Admin action only",
        description: "Only admins can update property verification check progress.",
        variant: "destructive",
      });
      return;
    }
    const listingId = String(listing?.id ?? "").trim();
    const actorId = String(user?.id ?? "").trim();
    if (!isUuidListingId(listingId) || !actorId) {
      toast({
        title: "DB-backed checks only",
        description: "Verification checks can only be updated for persisted listings.",
        variant: "destructive",
      });
      return;
    }

    setListingActionInFlightId(String(listing.id));
    try {
      const updated = await updateAgentListingVerificationStepStatusApi(listingId, stepKey, status, {
        actorId,
        actorRole: user?.role ?? undefined,
        actorName: user?.name ?? undefined,
      });
      upsertListingInState({ ...listing, ...updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update verification check.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setListingActionInFlightId(null);
    }
  };

  const completeAllVerificationChecks = async (listing: any) => {
    if (!canEditVerificationProgress) return;
    const listingId = String(listing?.id ?? "").trim();
    const actorId = String(user?.id ?? "").trim();
    const currentSteps = ensureVerificationSteps(listing);
    if (currentSteps.length === 0) {
      toast({
        title: "No checks to complete",
        description: "No verification checks are initialized for this listing yet.",
        variant: "destructive",
      });
      return;
    }

    if (!isUuidListingId(listingId) || !actorId) {
      toast({
        title: "DB-backed checks only",
        description: "Verification checks are only available for persisted listings.",
        variant: "destructive",
      });
      return;
    }

    setListingActionInFlightId(String(listing.id));
    try {
      let latest = listing;
      for (const step of currentSteps) {
        if (step.status === "completed") continue;
        latest = await updateAgentListingVerificationStepStatusApi(listingId, step.key, "completed", {
          actorId,
          actorRole: user?.role ?? undefined,
          actorName: user?.name ?? undefined,
        });
      }
      upsertListingInState({ ...listing, ...latest });
      toast({
        title: "Checks completed",
        description: "All verification checks were marked completed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete verification checks.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setListingActionInFlightId(null);
    }
  };

  const selectedVerificationSteps = verificationListing ? ensureVerificationSteps(verificationListing) : [];
  const selectedVerificationProgress = progressValue(selectedVerificationSteps);
  const selectedCompletedChecks = selectedVerificationSteps.filter(
    (step) => step.status === "completed",
  ).length;
  const canPublishFromVerification =
    isAdmin &&
    Boolean(verificationListing) &&
    selectedVerificationSteps.length > 0 &&
    selectedCompletedChecks === selectedVerificationSteps.length &&
    verificationListing.status !== "Published";
  const editStatusOptions: AgentListingStatus[] = useMemo(() => {
    if (isAdmin) {
      return ["Draft", "Pending Review", "Published", "Sold", "Rented", "Archived"];
    }

    const currentStatus = String(editingListing?.status ?? editingForm.status ?? "Draft");
    const options: AgentListingStatus[] = ["Draft", "Pending Review", "Archived"];

    if (currentStatus === "Published") {
      options.push("Published");
    }
    if (currentStatus === "Published" || isClosedDealStatus(currentStatus)) {
      options.push("Sold", "Rented");
    }

    return Array.from(new Set(options));
  }, [editingForm.status, editingListing, isAdmin]);

  const getConversationCounterparty = (conversation: ChatConversation) => {
    const selfId = String(user?.id ?? "");
    return (
      conversation.participants.find((participant) => participant.id !== selfId) ||
      conversation.participants[0] || {
        id: "",
        name: "Conversation Participant",
      }
    );
  };

  return (
    <>
      <Dialog open={Boolean(selectedListing)} onOpenChange={(open) => !open && setSelectedListing(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selectedListing && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedListing.title}</DialogTitle>
                <DialogDescription>Listing details and current performance snapshot.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Listing ID</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {String(selectedListing.id).toUpperCase()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                    <Badge className={`mt-2 ${listingBadgeClass(String(selectedListing.status))}`}>
                      {selectedListing.status}
                    </Badge>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Listing Type</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedListing.listingType ?? "Sale"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Price</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {normalizePrice(String(selectedListing.price ?? ""))}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Location</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {selectedListing.location ?? "Location pending"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Description</p>
                  <p className="mt-1 text-sm text-slate-700">
                    {selectedListing.description ?? "No description provided yet."}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Views</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{selectedListing.views ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Leads</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{selectedListing.inquiries ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Date Added</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{selectedListing.date}</p>
                  </div>
                </div>
                {isClosedDealStatus(String(selectedListing.status ?? "")) && (
                  <div className={`grid grid-cols-1 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-2"} gap-3`}>
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-green-700">Deal Amount</p>
                      <p className="mt-1 text-sm font-semibold text-green-900">
                        {formatNaira(
                          typeof selectedListing.dealAmount === "number"
                            ? selectedListing.dealAmount
                            : parseNairaAmount(String(selectedListing.price ?? "")),
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-blue-700">Agent Commission</p>
                      <p className="mt-1 text-sm font-semibold text-blue-900">
                        {formatNaira(
                          typeof selectedListing.agentCommission === "number"
                            ? selectedListing.agentCommission
                            : parseNairaAmount(String(selectedListing.price ?? "")) * AGENT_COMMISSION_RATE,
                        )}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                        <p className="text-xs uppercase tracking-wide text-indigo-700">Company Commission</p>
                        <p className="mt-1 text-sm font-semibold text-indigo-900">
                          {formatNaira(
                            typeof selectedListing.companyCommission === "number"
                              ? selectedListing.companyCommission
                              : parseNairaAmount(String(selectedListing.price ?? "")) * COMPANY_COMMISSION_RATE,
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedListing(null)}>
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setVerificationListing(selectedListing);
                    setSelectedListing(null);
                  }}
                >
                  View Verification Progress
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingListing)} onOpenChange={(open) => !open && setEditingListing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Listing</DialogTitle>
            <DialogDescription>Update listing details and publication status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Property Title</Label>
                <Input
                  id="edit-title"
                  value={editingForm.title}
                  onChange={(event) =>
                    setEditingForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-type">Listing Type</Label>
                <select
                  id="edit-type"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                  value={editingForm.listingType}
                  onChange={(event) =>
                    setEditingForm((current) => ({ ...current, listingType: event.target.value }))
                  }
                >
                  <option>Sale</option>
                  <option>Rent</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-price">Price</Label>
                <Input
                  id="edit-price"
                  value={editingForm.price}
                  onChange={(event) =>
                    setEditingForm((current) => ({ ...current, price: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status</Label>
                <select
                  id="edit-status"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                  value={editingForm.status}
                  onChange={(event) =>
                    setEditingForm((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  {editStatusOptions.map((statusOption) => (
                    <option key={statusOption}>{statusOption}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-location">Location</Label>
              <Input
                id="edit-location"
                value={editingForm.location}
                onChange={(event) =>
                  setEditingForm((current) => ({ ...current, location: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <textarea
                id="edit-description"
                className="w-full h-24 p-3 rounded-lg border border-slate-200 bg-slate-50 text-sm resize-none"
                value={editingForm.description}
                onChange={(event) =>
                  setEditingForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingListing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEditedListing()}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(verificationListing)}
        onOpenChange={(open) => !open && setVerificationListing(null)}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          {verificationListing && (
            <>
              <DialogHeader>
                <DialogTitle>Pending Property Verification Progress</DialogTitle>
                <DialogDescription>
                  {verificationListing.title} - {selectedCompletedChecks}/{selectedVerificationSteps.length} checks
                  completed.
                </DialogDescription>
                {!canEditVerificationProgress && (
                  <p className="text-xs font-medium text-amber-700">
                    Read-only for this role. Only admins can complete verification checks or publish listings.
                  </p>
                )}
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-800">Overall Verification Progress</p>
                    <p className="text-sm font-bold text-slate-900">{selectedVerificationProgress}%</p>
                  </div>
                  <Progress value={selectedVerificationProgress} />
                </div>

                <div className="space-y-3">
                  {selectedVerificationSteps.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
                      Verification checks are not initialized yet for this listing.
                    </div>
                  )}
                  {selectedVerificationSteps.map((step) => (
                    <div key={step.key} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{step.label}</p>
                          <p className="text-sm text-slate-500">{step.description}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={statusBadgeClass(step.status)}>{toStatusLabel(step.status)}</Badge>
                          {canEditVerificationProgress && (
                            <select
                              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                              value={step.status}
                              disabled={listingActionInFlightId === String(verificationListing.id)}
                              onChange={(event) =>
                                void updateVerificationStepStatus(
                                  verificationListing,
                                  step.key,
                                  event.target.value as VerificationStepStatus,
                                )
                              }
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In Progress</option>
                              <option value="completed">Completed</option>
                              <option value="blocked">Blocked</option>
                            </select>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setVerificationListing(null)}>
                  Close
                </Button>
                {canEditVerificationProgress && (
                  <Button
                    variant="outline"
                    disabled={listingActionInFlightId === String(verificationListing.id)}
                    onClick={() => void completeAllVerificationChecks(verificationListing)}
                  >
                    Complete All Checks
                  </Button>
                )}
                {canPublishFromVerification && (
                  <Button onClick={() => void setListingStatus(verificationListing, "Published")}>
                    Publish Listing
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">{dashboardTitle}</h1>
          <p className="text-slate-500">{dashboardDescription}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2 bg-green-50 border border-green-100 px-4 py-2 rounded-lg mr-2">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            <div>
              <p className="text-[10px] font-bold text-green-600 uppercase leading-none">{policyLabel}</p>
              <p className="text-sm font-bold text-green-900">5% Commission</p>
            </div>
          </div>
          <Button onClick={handleCreateListing} size="lg" className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-5 h-5" />
            Create New Listing
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">Profile Metrics</p>
            {isEditingAgentProfile ? (
              <div className="mt-3 space-y-3 max-w-2xl">
                <Input
                  value={agentProfileForm.displayName}
                  onChange={(event) =>
                    setAgentProfileForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Display name"
                />
                <textarea
                  value={agentProfileForm.bio}
                  onChange={(event) =>
                    setAgentProfileForm((current) => ({ ...current, bio: event.target.value }))
                  }
                  className="w-full min-h-[92px] rounded-md border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Short bio"
                />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-xl font-semibold text-slate-900">{profileDisplayName}</p>
                <p className="text-sm text-slate-600">
                  {profileBio || "No bio added yet. Add a short profile summary."}
                </p>
              </div>
            )}
            {isLoadingAgentProfile && (
              <p className="mt-2 text-xs text-slate-500">Loading profile metrics...</p>
            )}
            {agentProfileError && (
              <p className="mt-2 text-xs text-amber-600">Profile sync issue: {agentProfileError}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Sales Rating</p>
              <p className="text-lg font-semibold text-slate-900">{profileSalesRating.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Reviews</p>
              <p className="text-lg font-semibold text-slate-900">{profileReviewCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Recent Deals</p>
              <p className="text-lg font-semibold text-slate-900">{profileRecentDealsCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Closed Deals</p>
              <p className="text-lg font-semibold text-slate-900">{profileClosedDealsCount}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {isEditingAgentProfile ? (
            <>
              <Button
                variant="outline"
                disabled={isSavingAgentProfile}
                onClick={() => {
                  setIsEditingAgentProfile(false);
                  setAgentProfileForm({
                    displayName: String(agentProfile?.displayName ?? user?.name ?? "").trim(),
                    bio: String(agentProfile?.bio ?? "").trim(),
                  });
                }}
              >
                Cancel
              </Button>
              <Button disabled={isSavingAgentProfile} onClick={() => void saveAgentProfile()}>
                {isSavingAgentProfile ? "Saving..." : "Save Profile"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setIsEditingAgentProfile(true)}>
              Edit Profile Summary
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        {commissionData.map((stat) => (
          <div
            key={stat.label}
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <stat.icon className="w-12 h-12" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-500 font-medium text-sm">{stat.label}</h3>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="listings" className="space-y-6">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="listings" className="gap-2">
            <Building2 className="w-4 h-4" /> Listings
          </TabsTrigger>
          <TabsTrigger value="chats" className="gap-2">
            <MessageSquare className="w-4 h-4" /> Chats
          </TabsTrigger>
          {canViewBills && (
            <TabsTrigger value="bills" className="gap-2">
              <FileText className="w-4 h-4" /> Bills
            </TabsTrigger>
          )}
          {canViewExpenses && (
            <TabsTrigger value="expenses" className="gap-2">
              <FileText className="w-4 h-4" /> Expenses
            </TabsTrigger>
          )}
          {canViewDocuments && (
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="w-4 h-4" /> Documents
            </TabsTrigger>
          )}
          <TabsTrigger value="verifications" className="gap-2">
            <Clock className="w-4 h-4" /> Pending Verifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="listings">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Recent Listings</h3>
              <p className="text-xs text-slate-500 text-right">
                All payouts calculated at <span className="font-bold text-blue-600">5% commission</span> rate.
                {listingActionInFlightId && (
                  <span className="block text-[10px] text-blue-600 mt-1">Syncing listing update...</span>
                )}
                {listingSyncError && (
                  <span className="block text-[10px] text-amber-600 mt-1">
                    Listing sync issue: {listingSyncError}
                  </span>
                )}
              </p>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                  <TableHead className="w-[400px]">Property</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead>Date Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingListingsFromDb && listings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                      Loading listings...
                    </TableCell>
                  </TableRow>
                ) : listings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                      No listings yet. Create your first listing.
                    </TableCell>
                  </TableRow>
                ) : (
                  listings.map((listing: any) => {
                    const isUpdatingListing = listingActionInFlightId === String(listing.id);
                    const canManageListing = canModifyListing(listing);
                    return (
                    <TableRow key={listing.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex-shrink-0" />
                          <div>
                            <p className="text-slate-900 font-semibold">{listing.title}</p>
                            <p className="text-xs text-slate-500">ID: {String(listing.id).toUpperCase()}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={listingBadgeClass(String(listing.status))}>
                          {listing.status === "Published" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                          {listing.status === "Pending Review" && <Clock className="w-3 h-3 mr-1" />}
                          {(listing.status === "Sold" || listing.status === "Rented") && (
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                          )}
                          {listing.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{normalizePrice(String(listing.price ?? ""))}</TableCell>
                      <TableCell>
                        <div className="text-xs text-slate-500">
                          <span className="font-medium text-slate-900">{listing.views ?? 0}</span> views •
                          <span className="font-medium text-slate-900 ml-1">{listing.inquiries ?? 0}</span> leads
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-500 text-sm">{listing.date}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="w-4 h-4 text-slate-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => setSelectedListing(listing)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View Listing
                            </DropdownMenuItem>
                            {canManageListing && (
                              <DropdownMenuItem onClick={() => openEditDialog(listing)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit Listing
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setVerificationListing(listing)}>
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              View Verification Progress
                            </DropdownMenuItem>
                            {canManageListing && <DropdownMenuSeparator />}
                            {canManageListing && isAdmin && (listing.status !== "Published" ? (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() => void setListingStatus(listing, "Published")}
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Publish Listing
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() => void setListingStatus(listing, "Draft")}
                              >
                                <Clock className="mr-2 h-4 w-4" />
                                Move to Draft
                              </DropdownMenuItem>
                            ))}
                            {canManageListing &&
                              !isAdmin &&
                              (listing.status === "Draft" || listing.status === "Archived") && (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() => void setListingStatus(listing, "Pending Review")}
                              >
                                <Clock className="mr-2 h-4 w-4" />
                                Submit for Review
                              </DropdownMenuItem>
                            )}
                            {canManageListing && listing.status === "Published" && (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() =>
                                  void setListingStatus(
                                    listing,
                                    String(listing.listingType).toLowerCase() === "rent" ? "Rented" : "Sold",
                                  )
                                }
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Mark Closed Deal
                              </DropdownMenuItem>
                            )}
                            {canManageListing && isAdmin && isClosedDealStatus(String(listing.status ?? "")) && (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() => void setListingStatus(listing, "Published")}
                              >
                                <Clock className="mr-2 h-4 w-4" />
                                Reopen Listing
                              </DropdownMenuItem>
                            )}
                            {canManageListing && isAdmin && isClosedDealStatus(String(listing.status ?? "")) &&
                              listing.agentPayoutStatus !== "Paid" && (
                                <DropdownMenuItem
                                  disabled={isUpdatingListing}
                                  onClick={() => void markAgentPayoutStatus(listing, "Paid")}
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                  Mark Agent Payout Paid
                                </DropdownMenuItem>
                              )}
                            {canManageListing && listing.status === "Archived" ? (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() => void setListingStatus(listing, "Draft")}
                              >
                                <Clock className="mr-2 h-4 w-4" />
                                Unarchive Listing
                              </DropdownMenuItem>
                            ) : canManageListing ? (
                              <DropdownMenuItem
                                disabled={isUpdatingListing}
                                onClick={() => void setListingStatus(listing, "Archived")}
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                Archive Listing
                              </DropdownMenuItem>
                            ) : null}
                            {canManageListing && <DropdownMenuSeparator />}
                            {canManageListing && (
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600"
                                onClick={() => void deleteListing(listing)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Listing
                              </DropdownMenuItem>
                            )}
                            {!canManageListing && (
                              <DropdownMenuItem disabled>
                                Read-only listing
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="chats">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle className="text-lg">Recent Conversations</CardTitle>
                <CardDescription>Chat with potential buyers</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  {isLoadingServerConversations ? (
                    <div className="p-4 text-sm text-slate-500">Loading conversations...</div>
                  ) : serverConversations.length > 0 ? (
                    serverConversations.map((conversation) => {
                      const counterparty = getConversationCounterparty(conversation);
                      return (
                        <div
                          key={conversation.id}
                          onClick={() => {
                            setSelectedServerConversation(conversation);
                            setSelectedLead(null);
                          }}
                          className={`p-4 border-b border-slate-100 cursor-pointer transition-colors ${
                            selectedServerConversation?.id === conversation.id
                              ? "bg-blue-50"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1 gap-2">
                            <p className="font-semibold text-slate-900 truncate">
                              {counterparty.name}
                            </p>
                            <span className="text-[10px] text-slate-400 uppercase font-bold whitespace-nowrap">
                              {new Date(
                                conversation.lastMessageAt || conversation.updatedAt,
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                          <p className="text-xs text-blue-600 font-medium mb-1 truncate">
                            {conversation.subject || "Direct conversation"}
                          </p>
                          <p className="text-sm text-slate-500 truncate">
                            {conversation.lastMessage || "No messages yet"}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    leads.map((lead: any) => (
                      <div
                        key={lead.id}
                        onClick={() => {
                          setSelectedLead(lead);
                          setSelectedServerConversation(null);
                        }}
                        className={`p-4 border-b border-slate-100 cursor-pointer transition-colors ${
                          selectedLead?.id === lead.id ? "bg-blue-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-semibold text-slate-900">{lead.name}</p>
                          <span className="text-[10px] text-slate-400 uppercase font-bold">
                            {lead.date}
                          </span>
                        </div>
                        <p className="text-xs text-blue-600 font-medium mb-1 truncate">
                          {lead.property}
                        </p>
                        <p className="text-sm text-slate-500 truncate">{lead.message}</p>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
            <Card className="md:col-span-2 overflow-hidden">
              {selectedServerConversation ? (
                <div className="h-[520px]">
                  <ChatInterface
                    recipient={{
                      id: getConversationCounterparty(selectedServerConversation).id,
                      name: getConversationCounterparty(selectedServerConversation).name,
                      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
                        getConversationCounterparty(selectedServerConversation).name,
                      )}`,
                      verified: true,
                    }}
                    propertyTitle={selectedServerConversation.subject || "Direct conversation"}
                    conversationId={selectedServerConversation.id}
                    requesterId={user?.id}
                    requesterName={user?.name}
                    requesterRole={user?.role ?? undefined}
                  />
                </div>
              ) : selectedLead ? (
                <div className="h-[520px]">
                  <ChatInterface
                    recipient={{
                      id: selectedLead.id,
                      name: selectedLead.name,
                      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedLead.name}`,
                      verified: true,
                    }}
                    propertyTitle={selectedLead.property}
                    requesterId={user?.id}
                    requesterName={user?.name}
                    requesterRole={user?.role ?? undefined}
                  />
                </div>
              ) : (
                <div className="h-[520px] flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                    <MessageSquare className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Select a conversation</h3>
                  <p className="text-slate-500 max-w-xs mx-auto mt-2">
                    {serverConversationsError
                      ? "Unable to load persisted conversations right now."
                      : "Select a conversation from the left to view shared history."}
                  </p>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="bills">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Utility Bills</CardTitle>
                <CardDescription>
                  Track payment status for owner/renter utility obligations.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => void refreshUtilityBills()}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {canManageBills && (
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
                  <select
                    title="Bill type"
                    aria-label="Bill type"
                    className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={utilityBillForm.billType}
                    onChange={(event) =>
                      setUtilityBillForm((current) => ({
                        ...current,
                        billType: event.target.value as UtilityBillType,
                      }))
                    }
                  >
                    <option value="Electricity">Electricity</option>
                    <option value="Water">Water</option>
                    <option value="Waste Management">Waste Management</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Other">Other</option>
                  </select>
                  <Input
                    placeholder="Amount (NGN)"
                    value={utilityBillForm.amount}
                    onChange={(event) =>
                      setUtilityBillForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                  <Input
                    type="date"
                    value={utilityBillForm.dueDate}
                    onChange={(event) =>
                      setUtilityBillForm((current) => ({ ...current, dueDate: event.target.value }))
                    }
                  />
                  <div className="flex gap-2">
                    <Input
                      className="flex-1"
                      placeholder="Notes"
                      value={utilityBillForm.notes}
                      onChange={(event) =>
                        setUtilityBillForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                    <Button disabled={isCreatingUtilityBill} onClick={() => void createNewUtilityBill()}>
                      {isCreatingUtilityBill ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>
              )}

              {utilityBillsError && <p className="text-sm text-amber-600">{utilityBillsError}</p>}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingUtilityBills && utilityBillsForView.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                        Loading utility bills...
                      </TableCell>
                    </TableRow>
                  ) : utilityBillsForView.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                        No utility bills found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    utilityBillsForView.map((bill) => {
                      const isActionBusy = utilityBillActionId === bill.id;
                      const dueDateLabel = bill.dueDate
                        ? new Date(bill.dueDate).toLocaleDateString("en-US")
                        : "Not set";
                      return (
                        <TableRow key={bill.id}>
                          <TableCell>{bill.billType}</TableCell>
                          <TableCell>{formatNaira(bill.amount)}</TableCell>
                          <TableCell>{dueDateLabel}</TableCell>
                          <TableCell>
                            <Badge className={utilityBillBadgeClass(bill.status)}>{bill.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {bill.status !== "Paid" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isActionBusy}
                                  onClick={() => void setUtilityBillStatus(bill, "Paid")}
                                >
                                  Mark Paid
                                </Button>
                              )}
                              {canManageBills && bill.status === "Pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isActionBusy}
                                  onClick={() => void setUtilityBillStatus(bill, "Overdue")}
                                >
                                  Mark Overdue
                                </Button>
                              )}
                              {canManageBills && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isActionBusy}
                                  onClick={() => void removeUtilityBill(bill)}
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Property Expenses</CardTitle>
                <CardDescription>
                  Track monthly and annual owner costs across maintenance, utilities, and taxes.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <select
                  title="Expense range"
                  aria-label="Expense range"
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={expenseViewRange}
                  onChange={(event) =>
                    setExpenseViewRange(event.target.value === "year" ? "year" : "month")
                  }
                >
                  <option value="month">This Month</option>
                  <option value="year">This Year</option>
                </select>
                <Button variant="outline" onClick={() => void refreshPropertyExpenses()}>
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {expenseViewRange === "month" ? "Monthly Total" : "Annual Total"}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {formatNaira(propertyExpenseTotals.total)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Top Categories</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-700">
                    {Object.entries(propertyExpenseTotals.byCategory).length === 0 ? (
                      <p>No expense categories yet.</p>
                    ) : (
                      Object.entries(propertyExpenseTotals.byCategory)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([category, amount]) => (
                          <div key={category} className="flex items-center justify-between gap-2">
                            <span>{category}</span>
                            <span className="font-semibold text-slate-900">{formatNaira(amount)}</span>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              </div>

              {canManageExpenses && (
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
                  <select
                    title="Expense category"
                    aria-label="Expense category"
                    className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={propertyExpenseForm.category}
                    onChange={(event) =>
                      setPropertyExpenseForm((current) => ({
                        ...current,
                        category: event.target.value as PropertyExpenseCategory,
                      }))
                    }
                  >
                    <option value="Maintenance">Maintenance</option>
                    <option value="Repairs">Repairs</option>
                    <option value="Taxes">Taxes</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Security">Security</option>
                    <option value="Other">Other</option>
                  </select>
                  <Input
                    placeholder="Amount (NGN)"
                    value={propertyExpenseForm.amount}
                    onChange={(event) =>
                      setPropertyExpenseForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                  <Input
                    type="date"
                    value={propertyExpenseForm.expenseDate}
                    onChange={(event) =>
                      setPropertyExpenseForm((current) => ({
                        ...current,
                        expenseDate: event.target.value,
                      }))
                    }
                  />
                  <div className="flex gap-2">
                    <Input
                      className="flex-1"
                      placeholder="Notes"
                      value={propertyExpenseForm.notes}
                      onChange={(event) =>
                        setPropertyExpenseForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                    <Button
                      disabled={isCreatingPropertyExpense}
                      onClick={() => void createNewPropertyExpense()}
                    >
                      {isCreatingPropertyExpense ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>
              )}

              {propertyExpensesError && (
                <p className="text-sm text-amber-600">Expense sync issue: {propertyExpensesError}</p>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Expense Date</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingPropertyExpenses && propertyExpensesInRange.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                        Loading expenses...
                      </TableCell>
                    </TableRow>
                  ) : propertyExpensesInRange.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                        No expenses in this range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    propertyExpensesInRange.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell>{expense.category}</TableCell>
                        <TableCell>{formatNaira(expense.amount)}</TableCell>
                        <TableCell>
                          {expense.expenseDate
                            ? new Date(expense.expenseDate).toLocaleDateString("en-US")
                            : "Not set"}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate">
                          {expense.notes || "No notes"}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManageExpenses ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={propertyExpenseActionId === expense.id}
                              onClick={() => void removePropertyExpense(expense)}
                            >
                              Delete
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-500">Read-only</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Document Timeline</CardTitle>
                <CardDescription>
                  View and manage user-linked document records by listing and conversation.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => void refreshUserDocuments()}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {canManageDocuments && (
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                  <select
                    title="Document type"
                    aria-label="Document type"
                    className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={userDocumentForm.documentType}
                    onChange={(event) =>
                      setUserDocumentForm((current) => ({
                        ...current,
                        documentType: event.target.value as UserDocumentType,
                      }))
                    }
                  >
                    <option value="Attachment">Attachment</option>
                    <option value="Contract">Contract</option>
                    <option value="Title">Title</option>
                    <option value="Invoice">Invoice</option>
                    <option value="Receipt">Receipt</option>
                    <option value="Other">Other</option>
                  </select>
                  <Input
                    placeholder="Bucket ID"
                    value={userDocumentForm.bucketId}
                    onChange={(event) =>
                      setUserDocumentForm((current) => ({ ...current, bucketId: event.target.value }))
                    }
                  />
                  <Input
                    placeholder="Display name"
                    value={userDocumentForm.displayName}
                    onChange={(event) =>
                      setUserDocumentForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                  />
                  <Input
                    placeholder="Listing ID (optional)"
                    value={userDocumentForm.listingId}
                    onChange={(event) =>
                      setUserDocumentForm((current) => ({ ...current, listingId: event.target.value }))
                    }
                  />
                  <Input
                    placeholder="Conversation ID (optional)"
                    value={userDocumentForm.conversationId}
                    onChange={(event) =>
                      setUserDocumentForm((current) => ({
                        ...current,
                        conversationId: event.target.value,
                      }))
                    }
                  />
                  <div className="flex gap-2">
                    <Input
                      className="flex-1"
                      placeholder="Storage URL or path"
                      value={userDocumentForm.storagePath}
                      onChange={(event) =>
                        setUserDocumentForm((current) => ({
                          ...current,
                          storagePath: event.target.value,
                        }))
                      }
                    />
                    <Button disabled={isCreatingUserDocument} onClick={() => void createNewUserDocument()}>
                      {isCreatingUserDocument ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>
              )}

              {userDocumentsError && <p className="text-sm text-amber-600">{userDocumentsError}</p>}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Linkage</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingUserDocuments && userDocuments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                        Loading documents...
                      </TableCell>
                    </TableRow>
                  ) : userDocuments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                        No document records yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    userDocuments.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {document.displayName || document.documentType}
                            </p>
                            <p className="text-xs text-slate-500">{document.bucketId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          <div>Listing: {document.listingId || "-"}</div>
                          <div>Conversation: {document.conversationId || "-"}</div>
                        </TableCell>
                        <TableCell>
                          {document.createdAt
                            ? new Date(document.createdAt).toLocaleString("en-US")
                            : "Unknown"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openUserDocument(document)}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verifications">
          <Card>
            <CardHeader>
              <CardTitle>Pending Property Verifications</CardTitle>
              <CardDescription>
                Track the status of your listed properties currently being verified by our professionals.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {pendingVerificationListings.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-slate-400 italic">No properties currently in verification.</p>
                  </div>
                ) : (
                  pendingVerificationListings.map((listing: any) => {
                    const steps = ensureVerificationSteps(listing);
                    const value = progressValue(steps);
                    return (
                      <div
                        key={listing.id}
                        className="p-4 border border-slate-100 rounded-xl bg-slate-50/50 space-y-3"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                          <div className="w-16 h-16 bg-slate-200 rounded-lg flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-bold text-slate-900">{listing.title}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={listingBadgeClass(String(listing.status))}>{listing.status}</Badge>
                              <span className="text-xs text-slate-400">
                                {formatRelativeSubmitted(String(listing.date ?? ""))}
                              </span>
                            </div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => setVerificationListing(listing)}>
                            View Progress
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>Verification progress</span>
                            <span>{value}%</span>
                          </div>
                          <Progress value={value} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!isAdmin && !user?.isVerified && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <h4 className="font-bold text-amber-800">Your account is not verified</h4>
            <p className="text-sm text-amber-700 mt-1">
              Unverified accounts cannot publish listings.{" "}
              <button
                onClick={() => setIsVerificationModalOpen(true)}
                className="underline font-semibold hover:text-amber-900"
              >
                Verify Identity now
              </button>{" "}
              to unlock full access.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
