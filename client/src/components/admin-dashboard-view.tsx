import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock,
  ExternalLink,
  FileText,
  Search as SearchIcon,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import {
  addAdminFlaggedListingComment,
  fetchAdminDashboardData,
  updateAdminFlaggedListingStatus,
  updateAdminVerificationStatus,
  type AdminDashboardData,
  type AdminFlaggedListingStatus,
  type AdminVerificationStatus,
} from "@/lib/admin";
import {
  fetchServiceOfferings,
  updateAdminServiceOffering,
  type ServiceOffering,
} from "@/lib/service-offerings";
import {
  fetchAdminHiringApplications,
  updateAdminHiringApplicationStatus,
  type HiringApplication,
  type HiringApplicationStatus,
} from "@/lib/hiring";
import { useToast } from "@/hooks/use-toast";
import { ChatInterface } from "@/components/chat-interface";
import { fetchAdminConversations, type ChatConversation } from "@/lib/chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

type InquiryStatus = "Urgent" | "Pending" | "In Progress" | "Resolved";
type StatView = "users" | "verifications" | "flagged" | "revenue";

type ServiceInquiry = {
  id: string;
  service: string;
  client: string;
  location: string;
  status: InquiryStatus;
  isNew: boolean;
  latestMessage: string;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNaira(value: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value);
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) {
    return <div className="h-10 w-28 rounded-md bg-slate-100" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" className="h-10 w-28">
      <polyline
        fill="none"
        stroke="rgb(22 163 74)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={path}
      />
    </svg>
  );
}

type AdminDashboardViewProps = {
  listingsConsole?: ReactNode;
};

export default function AdminDashboardView({ listingsConsole }: AdminDashboardViewProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null);
  const [selectedVerificationId, setSelectedVerificationId] = useState<string | null>(null);
  const [selectedListingIdForComment, setSelectedListingIdForComment] = useState<string | null>(null);
  const [activeStatView, setActiveStatView] = useState<StatView | null>(null);

  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | "Buyer" | "Seller" | "Agent">("all");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "Active" | "Suspended">("all");

  const [verificationSearch, setVerificationSearch] = useState("");
  const [verificationStatusFilter, setVerificationStatusFilter] = useState<
    "all" | "Awaiting Review" | "Approved" | "Rejected"
  >("all");

  const [flaggedSearch, setFlaggedSearch] = useState("");
  const [flaggedStatusFilter, setFlaggedStatusFilter] = useState<
    "all" | "Open" | "Under Review" | "Cleared"
  >("all");

  const [revenueSearch, setRevenueSearch] = useState("");
  const [selectedRevenueMonth, setSelectedRevenueMonth] = useState("all");
  const [commentTag, setCommentTag] = useState("Resubmission Required");
  const [commentBody, setCommentBody] = useState("");

  const [serviceInquiries, setServiceInquiries] = useState<ServiceInquiry[]>([
    {
      id: "inq_1",
      service: "Land Surveying",
      client: "David Adeleke",
      location: "Lekki Phase 1",
      status: "Urgent",
      isNew: true,
      latestMessage: "I need this survey completed urgently before title transfer.",
    },
    {
      id: "inq_2",
      service: "Property Valuation",
      client: "Wizkid Balogun",
      location: "Banana Island",
      status: "Pending",
      isNew: true,
      latestMessage: "Please share valuation timeline and required documents.",
    },
    {
      id: "inq_3",
      service: "Land Verification",
      client: "Tiwa Savage",
      location: "Epe, Lagos",
      status: "In Progress",
      isNew: false,
      latestMessage: "Team is currently validating registry records for this parcel.",
    },
  ]);
  const [moderationConversations, setModerationConversations] = useState<ChatConversation[]>([]);
  const [selectedModerationConversationId, setSelectedModerationConversationId] = useState<
    string | null
  >(null);
  const [isLoadingModerationConversations, setIsLoadingModerationConversations] = useState(false);
  const [moderationConversationsError, setModerationConversationsError] = useState<string | null>(
    null,
  );

  const { data, isLoading, isFetching } = useQuery<AdminDashboardData>({
    queryKey: ["/api/admin/dashboard"],
    queryFn: fetchAdminDashboardData,
  });
  const {
    data: serviceOfferings = [],
    isLoading: isLoadingServiceOfferings,
    isFetching: isFetchingServiceOfferings,
  } = useQuery<ServiceOffering[]>({
    queryKey: ["/api/service-offerings"],
    queryFn: fetchServiceOfferings,
  });
  const {
    data: hiringApplications = [],
    isLoading: isLoadingHiringApplications,
    isFetching: isFetchingHiringApplications,
  } = useQuery<HiringApplication[]>({
    queryKey: ["/api/admin/hiring-applications", user?.role ?? ""],
    queryFn: () =>
      fetchAdminHiringApplications({
        actorRole: user?.role ?? undefined,
      }),
  });
  const [serviceEdits, setServiceEdits] = useState<Record<string, { price: string; turnaround: string }>>({});

  useEffect(() => {
    if (!Array.isArray(serviceOfferings) || serviceOfferings.length === 0) return;
    setServiceEdits((current) => {
      const next = { ...current };
      serviceOfferings.forEach((service) => {
        next[service.code] = {
          price: current[service.code]?.price ?? service.price,
          turnaround: current[service.code]?.turnaround ?? service.turnaround,
        };
      });
      return next;
    });
  }, [serviceOfferings]);

  const updateVerificationMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AdminVerificationStatus }) =>
      updateAdminVerificationStatus(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "Verification updated" });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update verification";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
  });

  const updateFlaggedListingMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AdminFlaggedListingStatus }) =>
      updateAdminFlaggedListingStatus(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "Flagged listing updated" });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update listing status";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
  });

  const createCommentMutation = useMutation({
    mutationFn: ({
      listingId,
      comment,
      problemTag,
      createdBy,
      createdById,
    }: {
      listingId: string;
      comment: string;
      problemTag: string;
      createdBy: string;
      createdById?: string;
    }) => addAdminFlaggedListingComment(listingId, { comment, problemTag, createdBy, createdById }),
    onSuccess: () => {
      setCommentBody("");
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({
        title: "Comment sent to user chat",
        description: "A problem-tagged issue card has been sent inside the user's in-app chat conversation.",
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to send comment";
      toast({ title: "Comment failed", description: message, variant: "destructive" });
    },
  });
  const updateServiceOfferingMutation = useMutation({
    mutationFn: ({
      code,
      price,
      turnaround,
    }: {
      code: string;
      price: string;
      turnaround: string;
    }) =>
      updateAdminServiceOffering(code, {
        price,
        turnaround,
        actorRole: user?.role ?? undefined,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ServiceOffering[]>(["/api/service-offerings"], (current) => {
        if (!Array.isArray(current) || current.length === 0) {
          return [updated];
        }

        const next = current.map((item) => (item.code === updated.code ? updated : item));
        return next.some((item) => item.code === updated.code) ? next : [...next, updated];
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/service-offerings"],
        refetchType: "all",
      });
      toast({
        title: "Service settings updated",
        description: "Professional service pricing and delivery timeline have been updated.",
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update service settings";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
  });
  const updateHiringApplicationMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: HiringApplicationStatus;
    }) =>
      updateAdminHiringApplicationStatus(id, {
        status,
        reviewerId: user?.id ?? undefined,
        reviewerName: user?.name ?? undefined,
        actorRole: user?.role ?? undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/hiring-applications"] });
      toast({
        title: "Application updated",
        description: "Hiring application status has been updated.",
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update hiring application";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
  });

  const selectedInquiry = serviceInquiries.find((item) => item.id === selectedInquiryId) ?? null;
  const users = data?.users ?? [];
  const verifications = data?.verifications ?? [];
  const flaggedListings = data?.flaggedListings ?? [];
  const revenueRecords = data?.revenue.records ?? [];
  const revenueTrend = data?.revenue.trend ?? [];

  const selectedVerification = verifications.find((item) => item.id === selectedVerificationId) ?? null;
  const selectedListingForComment =
    flaggedListings.find((item) => item.id === selectedListingIdForComment) ?? null;
  const selectedModerationConversation =
    moderationConversations.find((item) => item.id === selectedModerationConversationId) ?? null;

  useEffect(() => {
    let mounted = true;
    const userId = String(user?.id ?? "").trim();
    if (!userId) return undefined;

    setIsLoadingModerationConversations(true);
    setModerationConversationsError(null);
    void fetchAdminConversations(userId, {
      viewerRole: user?.role ?? undefined,
      viewerName: user?.name ?? undefined,
    })
      .then((rows) => {
        if (!mounted) return;
        setModerationConversations(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load conversations.";
        setModerationConversationsError(message);
        setModerationConversations([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingModerationConversations(false);
      });

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const filteredUsers = useMemo(() => {
    return users.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(userSearch.toLowerCase()) ||
        item.email.toLowerCase().includes(userSearch.toLowerCase());
      const matchesRole = userRoleFilter === "all" || item.role === userRoleFilter;
      const matchesStatus = userStatusFilter === "all" || item.status === userStatusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [userRoleFilter, userSearch, userStatusFilter, users]);

  const filteredVerifications = useMemo(() => {
    return verifications.filter((item) => {
      const matchesSearch =
        item.user.toLowerCase().includes(verificationSearch.toLowerCase()) ||
        item.userId.toLowerCase().includes(verificationSearch.toLowerCase());
      const matchesStatus = verificationStatusFilter === "all" || item.status === verificationStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [verificationSearch, verificationStatusFilter, verifications]);

  const filteredFlaggedListings = useMemo(() => {
    return flaggedListings.filter((item) => {
      const query = flaggedSearch.toLowerCase();
      const matchesSearch =
        item.title.toLowerCase().includes(query) ||
        item.location.toLowerCase().includes(query) ||
        item.reason.toLowerCase().includes(query);
      const matchesStatus = flaggedStatusFilter === "all" || item.status === flaggedStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [flaggedListings, flaggedSearch, flaggedStatusFilter]);

  const revenueMonths = useMemo(() => {
    const values = Array.from(new Set(revenueRecords.map((item) => item.month))).filter(Boolean);
    return values.sort();
  }, [revenueRecords]);

  useEffect(() => {
    if (selectedRevenueMonth === "all") return;
    if (!revenueMonths.includes(selectedRevenueMonth)) {
      setSelectedRevenueMonth("all");
    }
  }, [revenueMonths, selectedRevenueMonth]);

  const filteredRevenueRecords = useMemo(() => {
    return revenueRecords.filter((item) => {
      const matchesSearch = item.source.toLowerCase().includes(revenueSearch.toLowerCase());
      const matchesMonth = selectedRevenueMonth === "all" || item.month === selectedRevenueMonth;
      return matchesSearch && matchesMonth;
    });
  }, [revenueRecords, revenueSearch, selectedRevenueMonth]);

  const filteredRevenueTrend = useMemo(() => {
    if (selectedRevenueMonth === "all") return revenueTrend;

    const points = new Map<string, number>();
    for (const row of filteredRevenueRecords) {
      const label = new Date(row.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      points.set(label, (points.get(label) ?? 0) + row.netRevenue);
    }

    return Array.from(points.entries()).map(([label, amount]) => ({ label, amount }));
  }, [filteredRevenueRecords, revenueTrend, selectedRevenueMonth]);

  const updateInquiryStatus = (id: string, status: InquiryStatus) => {
    setServiceInquiries((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
  };

  const openInquiryChat = (id: string) => {
    setServiceInquiries((current) =>
      current.map((item) => (item.id === id ? { ...item, isNew: false } : item)),
    );
    setSelectedInquiryId(id);
  };

  const saveServiceOffering = (code: string) => {
    const edit = serviceEdits[code];
    if (!edit) return;

    const price = String(edit.price ?? "").trim();
    const turnaround = String(edit.turnaround ?? "").trim();
    if (!price || !turnaround) {
      toast({
        title: "Missing values",
        description: "Both price and delivery timeline are required.",
        variant: "destructive",
      });
      return;
    }

    updateServiceOfferingMutation.mutate({
      code,
      price,
      turnaround,
    });
  };

  const applyVerificationDecision = (status: AdminVerificationStatus) => {
    if (!selectedVerification) return;
    updateVerificationMutation.mutate(
      { id: selectedVerification.id, status },
      {
        onSuccess: () => {
          setSelectedVerificationId(null);
        },
      },
    );
  };

  const applyFlaggedListingStatus = (id: string, status: AdminFlaggedListingStatus) => {
    updateFlaggedListingMutation.mutate({ id, status });
  };

  const submitFlaggedListingComment = () => {
    if (!selectedListingForComment) return;
    const comment = commentBody.trim();
    if (!comment) {
      toast({ title: "Comment required", description: "Enter a comment before sending." });
      return;
    }

    createCommentMutation.mutate({
      listingId: selectedListingForComment.id,
      comment,
      problemTag: commentTag,
      createdBy: user?.name ?? "Admin",
      createdById: user?.id ?? undefined,
    });
  };

  const pendingVerifications = verifications.filter((item) => item.status === "Awaiting Review").length;
  const activeFlaggedListings = flaggedListings.filter((item) => item.status !== "Cleared").length;
  const newInquiryCount = serviceInquiries.filter((item) => item.isNew).length;

  const overview = data?.overview ?? {
    commissionRate: 5.0,
    totalUsers: users.length,
    pendingVerifications,
    flaggedListings: activeFlaggedListings,
    revenueJanLabel: "NGN 0",
  };

  const statCards = [
    {
      label: "Total Users",
      value: overview.totalUsers.toLocaleString(),
      icon: Users,
      color: "text-blue-600",
      view: "users" as const,
    },
    {
      label: "Pending Verifications",
      value: String(overview.pendingVerifications),
      icon: Clock,
      color: "text-amber-600",
      view: "verifications" as const,
    },
    {
      label: "Flagged Listings",
      value: String(overview.flaggedListings),
      icon: AlertCircle,
      color: "text-red-600",
      view: "flagged" as const,
    },
    {
      label: "Revenue (Jan)",
      value: overview.revenueJanLabel,
      icon: FileText,
      color: "text-green-600",
      view: "revenue" as const,
    },
  ];

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
    <div className="space-y-8">
      <Dialog
        open={Boolean(selectedInquiry)}
        onOpenChange={(open) => {
          if (!open) setSelectedInquiryId(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
          {selectedInquiry && (
            <div className="h-[620px]">
              <ChatInterface
                recipient={{
                  id: selectedInquiry.id,
                  name: selectedInquiry.client,
                  image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(selectedInquiry.client)}`,
                  verified: true,
                }}
                propertyTitle={`${selectedInquiry.service} - ${selectedInquiry.location}`}
                initialMessage={selectedInquiry.latestMessage}
                requesterId={user?.id}
                requesterName={user?.name}
                requesterRole={user?.role ?? undefined}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedModerationConversation)}
        onOpenChange={(open) => {
          if (!open) setSelectedModerationConversationId(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
          {selectedModerationConversation && (
            <div className="h-[620px]">
              <ChatInterface
                recipient={{
                  id: getConversationCounterparty(selectedModerationConversation).id,
                  name: getConversationCounterparty(selectedModerationConversation).name,
                  image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
                    getConversationCounterparty(selectedModerationConversation).name,
                  )}`,
                  verified: true,
                }}
                propertyTitle={selectedModerationConversation.subject || "Moderation Chat"}
                conversationId={selectedModerationConversation.id}
                requesterId={user?.id}
                requesterName={user?.name}
                requesterRole={user?.role ?? undefined}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedVerification)}
        onOpenChange={(open) => {
          if (!open) setSelectedVerificationId(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Verification Request</DialogTitle>
            <DialogDescription>
              Validate identity documents and decide this account status.
            </DialogDescription>
          </DialogHeader>
          {selectedVerification && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">User</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{selectedVerification.user}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Account Type</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{selectedVerification.type}</p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Documents</p>
                <div className="mt-2 grid gap-2">
                  {selectedVerification.documents.map((doc) => (
                    <div
                      key={`${selectedVerification.id}-${doc.name}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
                    >
                      <span className="text-sm text-slate-900">{doc.name}</span>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        View Document
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Current Status</p>
                <Badge
                  className={
                    selectedVerification.status === "Approved"
                      ? "mt-2 bg-green-100 text-green-700 border-green-200"
                      : selectedVerification.status === "Rejected"
                        ? "mt-2 bg-red-100 text-red-700 border-red-200"
                        : "mt-2 bg-amber-100 text-amber-700 border-amber-200"
                  }
                >
                  {selectedVerification.status}
                </Badge>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              disabled={updateVerificationMutation.isPending}
              onClick={() => applyVerificationDecision("Awaiting Review")}
            >
              Mark Awaiting Review
            </Button>
            <Button
              variant="outline"
              disabled={updateVerificationMutation.isPending}
              className="border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => applyVerificationDecision("Rejected")}
            >
              Reject
            </Button>
            <Button
              disabled={updateVerificationMutation.isPending}
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={() => applyVerificationDecision("Approved")}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedListingForComment)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedListingIdForComment(null);
            setCommentBody("");
            setCommentTag("Resubmission Required");
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Flagged Listing Comment</DialogTitle>
            <DialogDescription>
              Send a problem-tagged update to the affected user. This is delivered as an issue card inside the in-app chat conversation.
            </DialogDescription>
          </DialogHeader>
          {selectedListingForComment && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">{selectedListingForComment.title}</p>
                <p className="text-xs text-slate-500 mt-1">{selectedListingForComment.location}</p>
                <p className="text-xs text-slate-600 mt-2">
                  User: <span className="font-medium">{selectedListingForComment.affectedUserName}</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="problem-tag">Problem Tag</Label>
                <select
                  id="problem-tag"
                  value={commentTag}
                  onChange={(event) => setCommentTag(event.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option>Resubmission Required</option>
                  <option>Document Mismatch</option>
                  <option>Duplicate Submission</option>
                  <option>Ownership Conflict</option>
                  <option>Manual Clarification</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comment-body">Admin Comment</Label>
                <Textarea
                  id="comment-body"
                  placeholder="Explain the issue and tell the user what to resubmit."
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  className="min-h-[120px]"
                />
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This comment will be sent to the affected user in the in-app chat conversation as an issue card tagged{" "}
                <span className="font-semibold">{commentTag}</span>.
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-900">Recent Comments</p>
                <div className="max-h-40 space-y-2 overflow-auto rounded-md border border-slate-200 p-2">
                  {selectedListingForComment.comments.length === 0 ? (
                    <p className="text-xs text-slate-500">No comments yet.</p>
                  ) : (
                    selectedListingForComment.comments.map((item) => (
                      <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{item.problemTag}</Badge>
                          <Badge className="bg-blue-100 text-blue-700 border-blue-200">Sent to Chat</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-800">{item.comment}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.createdBy} • {formatDate(item.createdAt)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedListingIdForComment(null);
                setCommentBody("");
              }}
            >
              Close
            </Button>
            <Button
              disabled={createCommentMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
              onClick={submitFlaggedListingComment}
            >
              Send to In-App Chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activeStatView)}
        onOpenChange={(open) => {
          if (!open) setActiveStatView(null);
        }}
      >
        <DialogContent className="sm:max-w-5xl max-h-[88vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {activeStatView === "users"
                ? "Total Users Records"
                : activeStatView === "verifications"
                  ? "Pending Verification Records"
                  : activeStatView === "flagged"
                    ? "Flagged Listings Records"
                    : "Revenue Records"}
            </DialogTitle>
            <DialogDescription>
              {activeStatView === "users"
                ? `Showing ${filteredUsers.length} user records.`
                : activeStatView === "verifications"
                  ? `Showing ${filteredVerifications.length} verification records.`
                  : activeStatView === "flagged"
                    ? `Showing ${filteredFlaggedListings.length} flagged listing records.`
                    : `Showing ${filteredRevenueRecords.length} revenue entries.`}
            </DialogDescription>
          </DialogHeader>

          {activeStatView === "users" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative md:col-span-2">
                  <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search by name or email..."
                    className="pl-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={userRoleFilter}
                    onChange={(event) =>
                      setUserRoleFilter(event.target.value as "all" | "Buyer" | "Seller" | "Agent")
                    }
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="all">All Roles</option>
                    <option value="Buyer">Buyer</option>
                    <option value="Seller">Seller</option>
                    <option value="Agent">Agent</option>
                  </select>
                  <select
                    value={userStatusFilter}
                    onChange={(event) =>
                      setUserStatusFilter(event.target.value as "all" | "Active" | "Suspended")
                    }
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="all">All Status</option>
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <ScrollArea className="h-[420px] pr-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.role}</TableCell>
                        <TableCell className="text-slate-500">{item.email}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              item.status === "Active"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-red-100 text-red-700 border-red-200"
                            }
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(item.joinedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}

          {activeStatView === "verifications" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative md:col-span-2">
                  <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={verificationSearch}
                    onChange={(event) => setVerificationSearch(event.target.value)}
                    placeholder="Search by user or user ID..."
                    className="pl-9"
                  />
                </div>
                <select
                  value={verificationStatusFilter}
                  onChange={(event) =>
                    setVerificationStatusFilter(
                      event.target.value as "all" | "Awaiting Review" | "Approved" | "Rejected",
                    )
                  }
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="Awaiting Review">Awaiting Review</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>

              <ScrollArea className="h-[420px] pr-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Documents</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredVerifications.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.user}</TableCell>
                        <TableCell>{item.type}</TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            {item.documents.map((doc) => (
                              <a
                                key={`${item.id}-${doc.name}`}
                                href={doc.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                              >
                                {doc.name}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              item.status === "Approved"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : item.status === "Rejected"
                                  ? "bg-red-100 text-red-700 border-red-200"
                                  : "bg-amber-100 text-amber-700 border-amber-200"
                            }
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveStatView(null);
                              setSelectedVerificationId(item.id);
                            }}
                          >
                            Review
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}

          {activeStatView === "flagged" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative md:col-span-2">
                  <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={flaggedSearch}
                    onChange={(event) => setFlaggedSearch(event.target.value)}
                    placeholder="Search by listing, location, or reason..."
                    className="pl-9"
                  />
                </div>
                <select
                  value={flaggedStatusFilter}
                  onChange={(event) =>
                    setFlaggedStatusFilter(
                      event.target.value as "all" | "Open" | "Under Review" | "Cleared",
                    )
                  }
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="Open">Open</option>
                  <option value="Under Review">Under Review</option>
                  <option value="Cleared">Cleared</option>
                </select>
              </div>

              <ScrollArea className="h-[420px] pr-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Listing</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Comments</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFlaggedListings.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell className="text-slate-500">{item.location}</TableCell>
                        <TableCell>{item.reason}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              item.status === "Cleared"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : item.status === "Under Review"
                                  ? "bg-blue-100 text-blue-700 border-blue-200"
                                  : "bg-red-100 text-red-700 border-red-200"
                            }
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.comments.length}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedListingIdForComment(item.id)}
                            >
                              Comment
                            </Button>
                            {item.status === "Open" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => applyFlaggedListingStatus(item.id, "Under Review")}
                              >
                                Start Review
                              </Button>
                            ) : item.status === "Under Review" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-green-200 text-green-700 hover:bg-green-50"
                                onClick={() => applyFlaggedListingStatus(item.id, "Cleared")}
                              >
                                Clear Listing
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => applyFlaggedListingStatus(item.id, "Open")}
                              >
                                Reopen
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}

          {activeStatView === "revenue" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative md:col-span-2">
                  <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={revenueSearch}
                    onChange={(event) => setRevenueSearch(event.target.value)}
                    placeholder="Search revenue source..."
                    className="pl-9"
                  />
                </div>
                <select
                  value={selectedRevenueMonth}
                  onChange={(event) => setSelectedRevenueMonth(event.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All Months</option>
                  {revenueMonths.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <ChartContainer
                  className="h-[240px] w-full"
                  config={{
                    amount: {
                      label: "Net Revenue",
                      color: "rgb(22 163 74)",
                    },
                  }}
                >
                  <AreaChart data={filteredRevenueTrend}>
                    <defs>
                      <linearGradient id="fillAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-amount)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--color-amount)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis
                      tickFormatter={(value) =>
                        new Intl.NumberFormat("en-NG", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(Number(value))
                      }
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke="var(--color-amount)"
                      fill="url(#fillAmount)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>

              <ScrollArea className="h-[240px] pr-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Net Revenue</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRevenueRecords.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell>{item.source}</TableCell>
                        <TableCell>{formatNaira(item.grossAmount)}</TableCell>
                        <TableCell>{formatNaira(item.netRevenue)}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              item.status === "Received"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-amber-100 text-amber-700 border-amber-200"
                            }
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Admin Console</h1>
          <p className="text-slate-500">System-wide overview and verification management.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-blue-50 border border-blue-100 px-4 py-2 rounded-lg">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">
              Platform Commission
            </span>
            <p className="text-xl font-bold text-blue-900">{overview.commissionRate.toFixed(1)}%</p>
          </div>
          <Badge className="bg-red-100 text-red-700 border-red-200">System Live</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card
            key={stat.label}
            className={cn("cursor-pointer transition-all hover:shadow-md hover:border-slate-300")}
            onClick={() => setActiveStatView(stat.view)}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <p className="text-2xl font-bold">{stat.value}</p>
                {stat.view === "revenue" && (
                  <Sparkline points={revenueTrend.map((point) => point.amount).slice(-8)} />
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">Tap to view records</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {listingsConsole}

      <div className="flex flex-col gap-8">
      <Card className="order-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Professional Services Pricing & Delivery</CardTitle>
            <CardDescription>
              Update the public-facing service fees and turnaround timelines shown to users.
            </CardDescription>
          </div>
          {isFetchingServiceOfferings && <Badge variant="outline">Refreshing...</Badge>}
        </CardHeader>
        <CardContent>
          {isLoadingServiceOfferings ? (
            <p className="text-sm text-slate-500">Loading service settings...</p>
          ) : serviceOfferings.length === 0 ? (
            <p className="text-sm text-slate-500">No professional service settings found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceOfferings.map((service) => {
                  const edit = serviceEdits[service.code] ?? {
                    price: service.price,
                    turnaround: service.turnaround,
                  };

                  return (
                    <TableRow key={service.code}>
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <p>{service.name}</p>
                          <p className="text-xs text-slate-500">{service.code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={edit.price}
                          onChange={(event) =>
                            setServiceEdits((current) => ({
                              ...current,
                              [service.code]: {
                                price: event.target.value,
                                turnaround: current[service.code]?.turnaround ?? service.turnaround,
                              },
                            }))
                          }
                          placeholder="NGN 50,000"
                          className="max-w-[180px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={edit.turnaround}
                          onChange={(event) =>
                            setServiceEdits((current) => ({
                              ...current,
                              [service.code]: {
                                price: current[service.code]?.price ?? service.price,
                                turnaround: event.target.value,
                              },
                            }))
                          }
                          placeholder="48 Hours"
                          className="max-w-[180px]"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => saveServiceOffering(service.code)}
                          disabled={updateServiceOfferingMutation.isPending}
                        >
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="order-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Professional Hiring Applications</CardTitle>
            <CardDescription>
              Review incoming professional applications and move them through screening workflow.
            </CardDescription>
          </div>
          <Badge variant="outline">
            {hiringApplications.filter((item) => item.status === "submitted").length} New
          </Badge>
          {isFetchingHiringApplications && <Badge variant="outline">Refreshing...</Badge>}
        </CardHeader>
        <CardContent>
          {isLoadingHiringApplications ? (
            <p className="text-sm text-slate-500">Loading hiring applications...</p>
          ) : hiringApplications.length === 0 ? (
            <p className="text-sm text-slate-500">No hiring applications submitted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Service Track</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hiringApplications.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{application.fullName}</p>
                        <p className="text-xs text-slate-500">{application.email}</p>
                        {Array.isArray(application.documents) && application.documents.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {application.documents.slice(0, 2).map((document, index) => (
                              <a
                                key={`${application.id}-${document.storagePath}-${index}`}
                                href={document.previewUrl || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className={cn(
                                  "inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5",
                                  document.previewUrl
                                    ? "border-blue-200 text-blue-700 hover:bg-blue-50"
                                    : "border-slate-200 text-slate-500 pointer-events-none",
                                )}
                              >
                                <FileText className="h-3 w-3" />
                                <span className="max-w-[110px] truncate">{document.fileName}</span>
                                {document.previewUrl && <ExternalLink className="h-3 w-3" />}
                              </a>
                            ))}
                            {application.documents.length > 2 && (
                              <span className="text-[11px] text-slate-500 self-center">
                                +{application.documents.length - 2} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">
                      {application.serviceTrack.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>{application.yearsExperience} yrs</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          application.status === "approved"
                            ? "bg-green-100 text-green-700 border-green-200"
                            : application.status === "rejected"
                              ? "bg-red-100 text-red-700 border-red-200"
                              : application.status === "under_review"
                                ? "bg-blue-100 text-blue-700 border-blue-200"
                                : "bg-amber-100 text-amber-700 border-amber-200"
                        }
                      >
                        {application.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateHiringApplicationMutation.isPending}
                          onClick={() =>
                            updateHiringApplicationMutation.mutate({
                              id: application.id,
                              status: "under_review",
                            })
                          }
                        >
                          Review
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-200 text-green-700 hover:bg-green-50"
                          disabled={updateHiringApplicationMutation.isPending}
                          onClick={() =>
                            updateHiringApplicationMutation.mutate({
                              id: application.id,
                              status: "approved",
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          disabled={updateHiringApplicationMutation.isPending}
                          onClick={() =>
                            updateHiringApplicationMutation.mutate({
                              id: application.id,
                              status: "rejected",
                            })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="order-1">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Professional Service Inquiries</CardTitle>
            <CardDescription>
              Manage incoming requests for land surveying, valuation, and verification.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-blue-600 border-blue-200">
            {newInquiryCount} New Inquiries
          </Badge>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Property/Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceInquiries.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-semibold">{item.service}</TableCell>
                  <TableCell>{item.client}</TableCell>
                  <TableCell className="text-slate-500">{item.location}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        item.status === "Urgent"
                          ? "bg-red-50 text-red-700 border-red-100"
                          : item.status === "Resolved"
                            ? "bg-green-50 text-green-700 border-green-100"
                            : item.status === "In Progress"
                              ? "bg-blue-50 text-blue-700 border-blue-100"
                              : "bg-slate-50 text-slate-700 border-slate-100"
                      }
                    >
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-blue-600 hover:text-blue-700"
                        onClick={() => openInquiryChat(item.id)}
                      >
                        Open Chat
                      </Button>
                      {item.status !== "Resolved" ? (
                        <Button size="sm" variant="outline" onClick={() => updateInquiryStatus(item.id, "Resolved")}>
                          Resolve
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateInquiryStatus(item.id, "In Progress")}
                        >
                          Reopen
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="order-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Conversation Moderation</CardTitle>
            <CardDescription>
              Admin can review all platform conversations for dispute resolution and trust.
            </CardDescription>
          </div>
          <Badge variant="outline">{moderationConversations.length} Conversations</Badge>
        </CardHeader>
        <CardContent>
          {isLoadingModerationConversations ? (
            <p className="text-sm text-slate-500">Loading conversation history...</p>
          ) : moderationConversationsError ? (
            <p className="text-sm text-red-600">{moderationConversationsError}</p>
          ) : moderationConversations.length === 0 ? (
            <p className="text-sm text-slate-500">No conversations yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Latest Message</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moderationConversations.slice(0, 20).map((conversation) => {
                  const counterparty = getConversationCounterparty(conversation);
                  return (
                    <TableRow key={conversation.id}>
                      <TableCell className="font-medium">{counterparty.name}</TableCell>
                      <TableCell>{conversation.subject || "Direct Conversation"}</TableCell>
                      <TableCell className="max-w-[280px] truncate">
                        {conversation.lastMessage || "No messages yet"}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {new Date(
                          conversation.lastMessageAt || conversation.updatedAt,
                        ).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedModerationConversationId(conversation.id)}
                        >
                          Open Chat
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="order-5">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Identity Verification Requests</CardTitle>
            <CardDescription>Manual review required for high-value accounts.</CardDescription>
          </div>
          {isFetching && <Badge variant="outline">Refreshing...</Badge>}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading verification records...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verifications.slice(0, 8).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.user}</TableCell>
                    <TableCell>{item.type}</TableCell>
                    <TableCell>
                      <div className="grid gap-1">
                        {item.documents.map((doc) => (
                          <a
                            key={`${item.id}-${doc.name}-table`}
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                          >
                            {doc.name}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          item.status === "Approved"
                            ? "bg-green-100 text-green-700 border-green-200"
                            : item.status === "Rejected"
                              ? "bg-red-100 text-red-700 border-red-200"
                              : "bg-amber-100 text-amber-700 border-amber-200"
                        }
                      >
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelectedVerificationId(item.id)}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="order-3">
        <CardHeader>
          <CardTitle>Flagged Listings Queue</CardTitle>
          <CardDescription>Track and resolve suspicious property reports.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading flagged listings...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Comments</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flaggedListings.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell className="font-medium">{listing.title}</TableCell>
                    <TableCell className="text-slate-500">{listing.location}</TableCell>
                    <TableCell>{listing.reason}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          listing.status === "Cleared"
                            ? "bg-green-100 text-green-700 border-green-200"
                            : listing.status === "Under Review"
                              ? "bg-blue-100 text-blue-700 border-blue-200"
                              : "bg-red-100 text-red-700 border-red-200"
                        }
                      >
                        {listing.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-blue-600 hover:text-blue-700"
                        onClick={() => setSelectedListingIdForComment(listing.id)}
                      >
                        {listing.comments.length} Comment{listing.comments.length === 1 ? "" : "s"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedListingIdForComment(listing.id)}
                        >
                          Comment
                        </Button>
                        {listing.status === "Open" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyFlaggedListingStatus(listing.id, "Under Review")}
                          >
                            Start Review
                          </Button>
                        ) : listing.status === "Under Review" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-green-200 text-green-700 hover:bg-green-50"
                            onClick={() => applyFlaggedListingStatus(listing.id, "Cleared")}
                          >
                            Clear Listing
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyFlaggedListingStatus(listing.id, "Open")}
                          >
                            Reopen
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
