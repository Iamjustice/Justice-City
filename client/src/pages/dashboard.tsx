import { useAuth } from "@/lib/auth";
import { 
  Plus, 
  FileText, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  MoreHorizontal, 
  Building2,
  MessageSquare,
  Users,
  Search as SearchIcon,
  Filter,
  ShieldCheck,
  Heart,
  Eye,
  Pencil,
  Copy,
  Archive,
  Trash2
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { ChatInterface } from "@/components/chat-interface";
import { useState, useEffect } from "react";
import { VerificationModal } from "@/components/verification-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { MOCK_PROPERTIES } from "@/lib/mock-data";
import { PropertyCard } from "@/components/property-card";
import ModernAdminDashboardView from "@/components/admin-dashboard-view";
import ModernAgentDashboardView from "@/components/agent-dashboard-view";
import { createAgentListing } from "@/lib/agent-listings";

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [gateToastShown, setGateToastShown] = useState(false);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [isCreateListingOpen, setIsCreateListingOpen] = useState(false);
  const [isSubmittingListing, setIsSubmittingListing] = useState(false);
  const [savedProperties, setSavedProperties] = useState<any[]>([]);
  const [createListingForm, setCreateListingForm] = useState({
    title: "",
    type: "Sale",
    price: "",
    location: "",
    description: "",
  });

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/auth?mode=login");
      return;
    }
    if (!user.emailVerified || !user.phoneVerified) {
      const missingContact =
        !user.emailVerified && !user.phoneVerified
          ? "email and phone"
          : !user.emailVerified
            ? "email"
            : "phone";
      if (!gateToastShown) {
        toast({
          title: "Contact verification required",
          description: `Open verification and complete your ${missingContact} OTP to continue.`,
          variant: "destructive",
        });
        setGateToastShown(true);
      }
      setLocation("/verify");
    }
  }, [gateToastShown, isLoading, setLocation, toast, user]);

  if (isLoading || !user || !user.emailVerified || !user.phoneVerified) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-slate-500">
        Preparing your dashboard...
      </div>
    );
  }

  useEffect(() => {
    const loadSaved = () => {
      const savedIds = JSON.parse(localStorage.getItem("saved_properties") || "[]");
      const saved = MOCK_PROPERTIES.filter(p => savedIds.includes(p.id));
      setSavedProperties(saved);
    };

    loadSaved();
    window.addEventListener("storage", loadSaved);
    return () => window.removeEventListener("storage", loadSaved);
  }, []);

  const buildVerificationSteps = (
    status: "Published" | "Pending Review" | "Draft" | "Archived",
  ) => {
    const baseSteps = [
      {
        key: "ownership",
        label: "Ownership Verification",
        description: "Validate ownership records against title registry entries.",
      },
      {
        key: "ownership_authorization",
        label: "Ownership Authorization",
        description: "Confirm owner-issued authorization to list and market the property.",
      },
      {
        key: "survey",
        label: "Survey Verification",
        description: "Review survey plan details and boundary coordinates.",
      },
      {
        key: "right_of_way",
        label: "Right of Way Verification",
        description: "Confirm legal access roads and easement compliance.",
      },
      {
        key: "ministerial_charting",
        label: "Ministerial Charting",
        description: "Check government acquisition status and charting records.",
      },
      {
        key: "legal_verification",
        label: "Legal Verification",
        description: "Validate legal standing and applicable encumbrances.",
      },
      {
        key: "property_document_verification",
        label: "Property Document Verification",
        description: "Audit title documents (C of O, deed, survey, supporting files).",
      },
    ];

    if (status === "Published") {
      return baseSteps.map((step) => ({ ...step, status: "completed" as const }));
    }

    if (status === "Draft") {
      return baseSteps.map((step) => ({ ...step, status: "pending" as const }));
    }

    if (status === "Archived") {
      return baseSteps.map((step, index) => ({
        ...step,
        status: index < 2 ? ("completed" as const) : ("pending" as const),
      }));
    }

    return baseSteps.map((step, index) => ({
      ...step,
      status:
        index === 0
          ? ("completed" as const)
          : index === 1
            ? ("in_progress" as const)
            : ("pending" as const),
    }));
  };

  // Mock listings for the dashboard
  const [listings, setListings] = useState<any[]>([
    {
      id: "prop_1",
      title: "Luxury Apartment in Victoria Island",
      listingType: "Sale",
      location: "Victoria Island, Lagos",
      description: "Premium apartment with waterfront access and concierge services.",
      status: "Published",
      views: 1240,
      inquiries: 18,
      price: "₦150,000,000",
      date: "Jan 12, 2026",
      verificationSteps: buildVerificationSteps("Published"),
    },
    {
      id: "prop_5",
      title: "Unfinished Bungalow in Epe",
      listingType: "Sale",
      location: "Epe, Lagos",
      description: "Unfinished 4-bedroom bungalow in a fast-growing residential corridor.",
      status: "Pending Review",
      views: 0,
      inquiries: 0,
      price: "₦25,000,000",
      date: "Jan 14, 2026",
      verificationSteps: buildVerificationSteps("Pending Review"),
    },
    {
      id: "prop_6",
      title: "3 Bedroom Flat - Yaba",
      listingType: "Rent",
      location: "Yaba, Lagos",
      description: "Newly renovated 3-bedroom flat with dedicated parking.",
      status: "Draft",
      views: 0,
      inquiries: 0,
      price: "₦4,000,000/yr",
      date: "Jan 10, 2026",
      verificationSteps: buildVerificationSteps("Draft"),
    },
  ]);

  // Mock leads/chats for the dashboard
  const leads = [
    {
      id: "lead_1",
      name: "Tunde Ednut",
      property: "Luxury Apartment in VI",
      date: "2 hours ago",
      status: "Unread",
      message: "I am interested in viewing this property tomorrow."
    },
    {
      id: "lead_2",
      name: "Chioma Adeleke",
      property: "Modern Duplex in Lekki",
      date: "5 hours ago",
      status: "Read",
      message: "Is the price negotiable?"
    },
    {
      id: "lead_3",
      name: "Obinna Nwosu",
      property: "Commercial Space Ikeja",
      date: "Yesterday",
      status: "Read",
      message: "What is the total square footage?"
    }
  ];

  const handleCreateListing = () => {
    if (user?.role === "admin") {
      setIsCreateListingOpen(true);
      return;
    }

    if (!user?.isVerified) {
      setIsVerificationModalOpen(true);
    } else {
      setIsCreateListingOpen(true);
    }
  };

  const resetCreateListingForm = () => {
    setCreateListingForm({
      title: "",
      type: "Sale",
      price: "",
      location: "",
      description: "",
    });
  };

  const submitListingForReview = async () => {
    const title = createListingForm.title.trim();
    const location = createListingForm.location.trim();
    const description = createListingForm.description.trim();

    if (!title || !location || !createListingForm.price.trim()) {
      toast({
        title: "Missing listing details",
        description: "Title, price, and location are required before submission.",
        variant: "destructive",
      });
      return;
    }

    const actorId = String(user?.id ?? "").trim();
    if (!actorId) {
      toast({
        title: "Unable to submit listing",
        description: "Missing user context. Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmittingListing(true);
    try {
      const created = await createAgentListing(
        {
          title,
          listingType: createListingForm.type as "Sale" | "Rent",
          location,
          description,
          price: createListingForm.price,
          status: "Pending Review",
        },
        {
          actorId,
          actorRole: user?.role ?? undefined,
          actorName: user?.name ?? undefined,
        },
      );

      const verificationStatus =
        created.status === "Published" || created.status === "Sold" || created.status === "Rented"
          ? "Published"
          : created.status === "Archived"
            ? "Archived"
            : created.status === "Pending Review"
              ? "Pending Review"
              : "Draft";

      setListings((current) => [
        {
          ...created,
          verificationSteps: buildVerificationSteps(verificationStatus),
        },
        ...current.filter((listing) => listing.id !== created.id),
      ]);

      toast({
        title: "Listing submitted",
        description: `${title} has been submitted for verification review.`,
      });

      resetCreateListingForm();
      setIsCreateListingOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit listing.";
      toast({
        title: "Submission failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmittingListing(false);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <h2 className="text-2xl font-bold">Please log in to view your dashboard</h2>
        <Button asChild>
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  // Define Dashboard Views based on Role
  const renderDashboardContent = () => {
    switch (user.role) {
      case "admin":
        return (
          <ModernAdminDashboardView
            listingsConsole={
              <ModernAgentDashboardView
              listings={listings}
              leads={leads}
              handleCreateListing={handleCreateListing}
              onListingsChange={setListings}
              setIsVerificationModalOpen={setIsVerificationModalOpen}
              user={user}
              />
            }
          />
        );
      case "agent":
        return <ModernAgentDashboardView 
                 listings={listings} 
                 leads={leads} 
                 handleCreateListing={handleCreateListing} 
                 onListingsChange={setListings}
                 setIsVerificationModalOpen={setIsVerificationModalOpen}
                 user={user}
               />;
      case "seller":
        return <ModernAgentDashboardView
                 listings={listings}
                 leads={leads}
                 handleCreateListing={handleCreateListing}
                 onListingsChange={setListings}
                 setIsVerificationModalOpen={setIsVerificationModalOpen}
                 user={user}
               />;
      case "owner":
        return <ModernAgentDashboardView
                 listings={listings}
                 leads={leads}
                 handleCreateListing={handleCreateListing}
                 onListingsChange={setListings}
                 setIsVerificationModalOpen={setIsVerificationModalOpen}
                 user={user}
               />;
      case "renter":
        return <BuyerDashboardView user={user} savedProperties={savedProperties} />;
      case "buyer":
      default:
        return <BuyerDashboardView user={user} savedProperties={savedProperties} />;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <VerificationModal 
        isOpen={isVerificationModalOpen} 
        onClose={() => setIsVerificationModalOpen(false)}
        triggerAction="create a listing"
      />

      <Dialog
        open={isCreateListingOpen}
        onOpenChange={(open) => {
          setIsCreateListingOpen(open);
          if (!open) resetCreateListingForm();
        }}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4">
            <DialogTitle>Create New Listing</DialogTitle>
            <DialogDescription>
              Add a new property to the marketplace. Your listing will be reviewed before going live.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Property Title</Label>
                <Input
                  id="title"
                  placeholder="e.g. 3 Bedroom Flat"
                  value={createListingForm.title}
                  onChange={(event) =>
                    setCreateListingForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Listing Type</Label>
                <select
                  id="type"
                  title="Listing Type"
                  aria-label="Listing Type"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                  value={createListingForm.type}
                  onChange={(event) =>
                    setCreateListingForm((current) => ({ ...current, type: event.target.value }))
                  }
                >
                  <option>Sale</option>
                  <option>Rent</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Price (₦)</Label>
                <Input
                  id="price"
                  placeholder="e.g. 50,000,000"
                  value={createListingForm.price}
                  onChange={(event) =>
                    setCreateListingForm((current) => ({ ...current, price: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  placeholder="e.g. Lekki, Lagos"
                  value={createListingForm.location}
                  onChange={(event) =>
                    setCreateListingForm((current) => ({ ...current, location: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea 
                id="description"
                className="w-full h-24 p-3 rounded-lg border border-slate-200 bg-slate-50 text-sm resize-none"
                placeholder="Describe the property's features..."
                value={createListingForm.description}
                onChange={(event) =>
                  setCreateListingForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </div>
            <div className="space-y-4">
              <Label className="text-base font-bold">Required Documentation</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors cursor-pointer group bg-slate-50/50">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2 group-hover:text-blue-500 transition-colors" />
                  <p className="text-sm font-semibold text-slate-900">Upload Property Documents</p>
                  <p className="text-xs text-slate-500 mt-1">C of O, Survey Plan, or Deed</p>
                </div>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors cursor-pointer group bg-slate-50/50">
                  <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2 group-hover:text-blue-500 transition-colors" />
                  <p className="text-sm font-semibold text-slate-900">Ownership Authorization</p>
                  <p className="text-xs text-slate-500 mt-1">Letter of Authorization from Owner</p>
                </div>
              </div>
            </div>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer group">
              <Plus className="w-8 h-8 text-slate-400 mx-auto mb-2 group-hover:text-blue-500 transition-colors" />
              <p className="text-sm font-semibold text-slate-900">Upload Property Images</p>
              <p className="text-xs text-slate-500 mt-1">Add up to 10 high-quality photos</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateListingOpen(false);
                resetCreateListingForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitListingForReview()} className="bg-blue-600" disabled={isSubmittingListing}>
              {isSubmittingListing ? "Submitting..." : "Submit for Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderDashboardContent()}
    </div>
  );
}

type UserChatCard = {
  id: string;
  title: string;
  message: string;
  problemTag: string;
  status: "unread" | "read";
  createdAt: string;
};

function IssueChatCards({ userId, emptyMessage }: { userId: string; emptyMessage: string }) {
  const [cards, setCards] = useState<UserChatCard[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [cardsError, setCardsError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoadingCards(true);
    setCardsError(null);

    fetch(`/api/chat-cards/${encodeURIComponent(userId)}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = (await res.text()) || res.statusText;
          throw new Error(text);
        }
        return res.json();
      })
      .then((data: UserChatCard[]) => {
        if (!mounted) return;
        setCards(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Failed to load notifications.";
        setCardsError(message);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingCards(false);
      });

    return () => {
      mounted = false;
    };
  }, [userId]);

  if (isLoadingCards) {
    return <p className="text-sm text-slate-500">Loading issue notifications...</p>;
  }

  if (cardsError) {
    return <p className="text-sm text-red-600">{cardsError}</p>;
  }

  if (cards.length === 0) {
    return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <div key={card.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{card.problemTag}</Badge>
            <Badge
              className={
                card.status === "unread"
                  ? "bg-amber-100 text-amber-700 border-amber-200"
                  : "bg-green-100 text-green-700 border-green-200"
              }
            >
              {card.status}
            </Badge>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">{card.title}</p>
          <p className="mt-1 text-sm text-slate-600">{card.message}</p>
          <p className="mt-2 text-xs text-slate-500">{new Date(card.createdAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

// Sub-components for different dashboard views
function AdminDashboardView() {
  type InquiryStatus = "Urgent" | "Pending" | "In Progress" | "Resolved";
  type VerificationStatus = "Awaiting Review" | "Approved" | "Rejected";
  type FlaggedListingStatus = "Open" | "Under Review" | "Cleared";
  type StatView = "users" | "verifications" | "flagged";

  type ServiceInquiry = {
    id: string;
    service: string;
    client: string;
    location: string;
    status: InquiryStatus;
    isNew: boolean;
    latestMessage: string;
  };

  type VerificationRequest = {
    id: string;
    user: string;
    type: "Agent" | "Seller";
    documents: string[];
    status: VerificationStatus;
  };

  type FlaggedListing = {
    id: string;
    title: string;
    location: string;
    reason: string;
    status: FlaggedListingStatus;
  };

  type AdminUserRecord = {
    id: string;
    name: string;
    role: "Buyer" | "Seller" | "Agent";
    email: string;
    status: "Active" | "Suspended";
    joinedAt: string;
  };

  const commissionRate = 5.0;
  const totalUsers = 1240;
  const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null);
  const [selectedVerificationId, setSelectedVerificationId] = useState<string | null>(null);
  const [activeStatView, setActiveStatView] = useState<StatView | null>(null);
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

  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>([
    {
      id: "ver_1",
      user: "Adekunle Gold",
      type: "Agent",
      documents: ["Identity", "Utility Bill"],
      status: "Awaiting Review",
    },
    {
      id: "ver_2",
      user: "Simi Kosoko",
      type: "Seller",
      documents: ["Identity", "Utility Bill"],
      status: "Awaiting Review",
    },
    {
      id: "ver_3",
      user: "Burna Boy",
      type: "Seller",
      documents: ["Identity", "Utility Bill"],
      status: "Awaiting Review",
    },
  ]);

  const [flaggedListings, setFlaggedListings] = useState<FlaggedListing[]>([
    {
      id: "flag_1",
      title: "4 Bedroom Duplex",
      location: "Ikoyi, Lagos",
      reason: "Suspicious document mismatch",
      status: "Open",
    },
    {
      id: "flag_2",
      title: "Oceanfront Plot",
      location: "Ajah, Lagos",
      reason: "Multiple duplicate submissions",
      status: "Under Review",
    },
    {
      id: "flag_3",
      title: "Commercial Plaza",
      location: "Port Harcourt",
      reason: "Ownership conflict alert",
      status: "Open",
    },
  ]);

  const adminUsers: AdminUserRecord[] = [
    {
      id: "usr_1",
      name: "David Adeleke",
      role: "Buyer",
      email: "david.adeleke@example.com",
      status: "Active",
      joinedAt: "Jan 03, 2026",
    },
    {
      id: "usr_2",
      name: "Wizkid Balogun",
      role: "Seller",
      email: "wizkid.balogun@example.com",
      status: "Active",
      joinedAt: "Jan 09, 2026",
    },
    {
      id: "usr_3",
      name: "Tiwa Savage",
      role: "Seller",
      email: "tiwa.savage@example.com",
      status: "Active",
      joinedAt: "Jan 12, 2026",
    },
    {
      id: "usr_4",
      name: "Adekunle Gold",
      role: "Agent",
      email: "adekunle.gold@example.com",
      status: "Active",
      joinedAt: "Jan 14, 2026",
    },
    {
      id: "usr_5",
      name: "Simi Kosoko",
      role: "Seller",
      email: "simi.kosoko@example.com",
      status: "Active",
      joinedAt: "Jan 17, 2026",
    },
    {
      id: "usr_6",
      name: "Burna Boy",
      role: "Seller",
      email: "burna.boy@example.com",
      status: "Suspended",
      joinedAt: "Jan 20, 2026",
    },
  ];

  const selectedInquiry = serviceInquiries.find((item) => item.id === selectedInquiryId) ?? null;
  const selectedVerification =
    verificationRequests.find((item) => item.id === selectedVerificationId) ?? null;
  const pendingVerificationRecords = verificationRequests.filter(
    (item) => item.status === "Awaiting Review",
  );
  const openFlaggedListings = flaggedListings.filter((item) => item.status !== "Cleared");
  const newInquiryCount = serviceInquiries.filter((item) => item.isNew).length;
  const pendingVerifications = pendingVerificationRecords.length;
  const activeFlaggedListings = openFlaggedListings.length;

  const adminStats = [
    {
      label: "Total Users",
      value: totalUsers.toLocaleString(),
      icon: Users,
      color: "text-blue-600",
      view: "users" as const,
    },
    {
      label: "Pending Verifications",
      value: String(pendingVerifications),
      icon: Clock,
      color: "text-amber-600",
      view: "verifications" as const,
    },
    {
      label: "Flagged Listings",
      value: String(activeFlaggedListings),
      icon: AlertCircle,
      color: "text-red-600",
      view: "flagged" as const,
    },
    { label: "Revenue (Jan)", value: "N4.2M", icon: FileText, color: "text-green-600" },
  ];

  const updateInquiryStatus = (id: string, status: InquiryStatus) => {
    setServiceInquiries((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  };

  const openInquiryChat = (id: string) => {
    setServiceInquiries((current) =>
      current.map((item) => (item.id === id ? { ...item, isNew: false } : item)),
    );
    setSelectedInquiryId(id);
  };

  const reviewVerification = (id: string, status: VerificationStatus) => {
    setVerificationRequests((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  };

  const applyVerificationDecision = (status: VerificationStatus) => {
    if (!selectedVerification) return;
    reviewVerification(selectedVerification.id, status);
    setSelectedVerificationId(null);
  };

  const updateFlaggedListingStatus = (id: string, status: FlaggedListingStatus) => {
    setFlaggedListings((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  };

  const openStatRecords = (view: StatView | undefined) => {
    if (!view) return;
    setActiveStatView(view);
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
                  name: selectedInquiry.client,
                  image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(selectedInquiry.client)}`,
                  verified: true,
                }}
                propertyTitle={`${selectedInquiry.service} - ${selectedInquiry.location}`}
                initialMessage={selectedInquiry.latestMessage}
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
        <DialogContent className="sm:max-w-xl">
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedVerification.documents.map((doc) => (
                    <Badge key={doc} variant="outline">
                      {doc}
                    </Badge>
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
            <Button variant="outline" onClick={() => applyVerificationDecision("Awaiting Review")}>
              Mark Awaiting Review
            </Button>
            <Button
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => applyVerificationDecision("Rejected")}
            >
              Reject
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={() => applyVerificationDecision("Approved")}
            >
              Approve
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
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {activeStatView === "users"
                ? "Total Users Records"
                : activeStatView === "verifications"
                  ? "Pending Verification Records"
                  : "Flagged Listings Records"}
            </DialogTitle>
            <DialogDescription>
              {activeStatView === "users"
                ? `Showing account records. Total users on platform: ${totalUsers.toLocaleString()}.`
                : activeStatView === "verifications"
                  ? `Showing ${pendingVerifications} verification requests awaiting review.`
                  : `Showing ${activeFlaggedListings} flagged listing records requiring admin attention.`}
            </DialogDescription>
          </DialogHeader>

          {activeStatView === "users" && (
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
                  {adminUsers.map((userRecord) => (
                    <TableRow key={userRecord.id}>
                      <TableCell className="font-medium">{userRecord.name}</TableCell>
                      <TableCell>{userRecord.role}</TableCell>
                      <TableCell className="text-slate-500">{userRecord.email}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            userRecord.status === "Active"
                              ? "bg-green-100 text-green-700 border-green-200"
                              : "bg-red-100 text-red-700 border-red-200"
                          }
                        >
                          {userRecord.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{userRecord.joinedAt}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {activeStatView === "verifications" && (
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
                  {pendingVerificationRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                        No pending verification records.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingVerificationRecords.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.user}</TableCell>
                        <TableCell>{item.type}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {item.documents.map((doc) => (
                              <Badge key={`${item.id}-${doc}`} variant="outline">
                                {doc}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-100 text-amber-700 border-amber-200">
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
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {activeStatView === "flagged" && (
            <ScrollArea className="h-[420px] pr-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Listing</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openFlaggedListings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                        No active flagged listings.
                      </TableCell>
                    </TableRow>
                  ) : (
                    openFlaggedListings.map((listing) => (
                      <TableRow key={listing.id}>
                        <TableCell className="font-medium">{listing.title}</TableCell>
                        <TableCell className="text-slate-500">{listing.location}</TableCell>
                        <TableCell>{listing.reason}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              listing.status === "Under Review"
                                ? "bg-blue-100 text-blue-700 border-blue-200"
                                : "bg-red-100 text-red-700 border-red-200"
                            }
                          >
                            {listing.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {listing.status === "Open" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateFlaggedListingStatus(listing.id, "Under Review")}
                            >
                              Start Review
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-green-200 text-green-700 hover:bg-green-50"
                              onClick={() => updateFlaggedListingStatus(listing.id, "Cleared")}
                            >
                              Clear Listing
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
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
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Platform Commission</span>
            <p className="text-xl font-bold text-blue-900">{commissionRate.toFixed(1)}%</p>
          </div>
          <Badge className="bg-red-100 text-red-700 border-red-200">System Live</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {adminStats.map((stat) => (
          <Card
            key={stat.label}
            className={stat.view ? "cursor-pointer transition-all hover:shadow-md hover:border-slate-300" : ""}
            onClick={stat.view ? () => openStatRecords(stat.view) : undefined}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <p className="text-2xl font-bold mt-2">{stat.value}</p>
              {stat.view && <p className="text-xs text-slate-400 mt-1">Tap to view records</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Professional Service Inquiries</CardTitle>
            <CardDescription>Manage incoming requests for land surveying, valuation, and verification.</CardDescription>
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
              {serviceInquiries.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="font-semibold">{req.service}</TableCell>
                  <TableCell>{req.client}</TableCell>
                  <TableCell className="text-slate-500">{req.location}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        req.status === "Urgent"
                          ? "bg-red-50 text-red-700 border-red-100"
                          : req.status === "Resolved"
                            ? "bg-green-50 text-green-700 border-green-100"
                            : req.status === "In Progress"
                              ? "bg-blue-50 text-blue-700 border-blue-100"
                              : "bg-slate-50 text-slate-700 border-slate-100"
                      }
                    >
                      {req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-blue-600 hover:text-blue-700"
                        onClick={() => openInquiryChat(req.id)}
                      >
                        Open Chat
                      </Button>
                      {req.status !== "Resolved" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateInquiryStatus(req.id, "Resolved")}
                        >
                          Resolve
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateInquiryStatus(req.id, "In Progress")}
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

      <Card>
        <CardHeader>
          <CardTitle>Recent Identity Verification Requests</CardTitle>
          <CardDescription>Manual review required for high-value accounts.</CardDescription>
        </CardHeader>
        <CardContent>
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
              {verificationRequests.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.user}</TableCell>
                  <TableCell>{item.type}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {item.documents.map((doc) => (
                        <Badge key={`${item.id}-${doc}`} variant="outline">
                          {doc}
                        </Badge>
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
                      onClick={() => setSelectedVerificationId(item.id)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flagged Listings Queue</CardTitle>
          <CardDescription>Track and resolve suspicious property reports.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Listing</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
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
                  <TableCell className="text-right">
                    {listing.status === "Open" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateFlaggedListingStatus(listing.id, "Under Review")}
                      >
                        Start Review
                      </Button>
                    ) : listing.status === "Under Review" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-green-200 text-green-700 hover:bg-green-50"
                        onClick={() => updateFlaggedListingStatus(listing.id, "Cleared")}
                      >
                        Clear Listing
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateFlaggedListingStatus(listing.id, "Open")}
                      >
                        Reopen
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function LegacyAdminDashboardView() {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Admin Console</h1>
          <p className="text-slate-500">System-wide overview and verification management.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-blue-50 border border-blue-100 px-4 py-2 rounded-lg">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Platform Commission</span>
            <p className="text-xl font-bold text-blue-900">5.0%</p>
          </div>
          <Badge className="bg-red-100 text-red-700 border-red-200">System Live</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: "1,240", icon: Users, color: "text-blue-600" },
          { label: "Pending Verifications", value: "42", icon: Clock, color: "text-amber-600" },
          { label: "Flagged Listings", value: "3", icon: AlertCircle, color: "text-red-600" },
          { label: "Revenue (Jan)", value: "₦4.2M", icon: FileText, color: "text-green-600" },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <stat.icon className={`w-4 h-4 \${stat.color}`} />
              </div>
              <p className="text-2xl font-bold mt-2">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Professional Service Inquiries</CardTitle>
            <CardDescription>Manage incoming requests for land surveying, valuation, and verification.</CardDescription>
          </div>
          <Badge variant="outline" className="text-blue-600 border-blue-200">New Inquiries</Badge>
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
              {[
                { service: "Land Surveying", client: "David Adeleke", loc: "Lekki Phase 1", status: "Urgent" },
                { service: "Property Valuation", client: "Wizkid Balogun", loc: "Banana Island", status: "Pending" },
                { service: "Land Verification", client: "Tiwa Savage", loc: "Epe, Lagos", status: "In Progress" },
              ].map((req, i) => (
                <TableRow key={i}>
                  <TableCell className="font-semibold">{req.service}</TableCell>
                  <TableCell>{req.client}</TableCell>
                  <TableCell className="text-slate-500">{req.loc}</TableCell>
                  <TableCell>
                    <Badge className={
                      req.status === "Urgent" ? "bg-red-50 text-red-700 border-red-100" :
                      req.status === "In Progress" ? "bg-blue-50 text-blue-700 border-blue-100" :
                      "bg-slate-50 text-slate-700 border-slate-100"
                    }>
                      {req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-700">Open Chat</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Identity Verification Requests</CardTitle>
          <CardDescription>Manual review required for high-value accounts.</CardDescription>
        </CardHeader>
        <CardContent>
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
              {["Adekunle Gold", "Simi Kosoko", "Burna Boy"].map((name, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>{i === 0 ? "Agent" : "Seller"}</TableCell>
                  <TableCell><Badge variant="outline">Identity, Utility Bill</Badge></TableCell>
                  <TableCell><Badge className="bg-amber-100 text-amber-700">Awaiting Review</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline">Review</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentDashboardView({ listings, leads, handleCreateListing, setIsVerificationModalOpen, user }: any) {
  const [selectedLead, setSelectedLead] = useState<any>(null);

  const commissionData = [
    { label: "Total Sales Value", value: "₦420,000,000", icon: Building2, color: "text-blue-600" },
    { label: "Commission Earned (5%)", value: "₦21,000,000", icon: CheckCircle2, color: "text-green-600" },
    { label: "Pending Payouts", value: "₦4,500,000", icon: Clock, color: "text-amber-600" },
  ];

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Agent Dashboard</h1>
          <p className="text-slate-500">Manage your listings and track performance.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2 bg-green-50 border border-green-100 px-4 py-2 rounded-lg mr-2">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            <div>
              <p className="text-[10px] font-bold text-green-600 uppercase leading-none">Standard Policy</p>
              <p className="text-sm font-bold text-green-900">5% Commission</p>
            </div>
          </div>
          <Button onClick={handleCreateListing} size="lg" className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-5 h-5" />
            Create New Listing
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {commissionData.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
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
          <TabsTrigger value="verifications" className="gap-2">
            <Clock className="w-4 h-4" /> Pending Verifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="listings">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Recent Listings</h3>
              <p className="text-xs text-slate-500">All payouts calculated at <span className="font-bold text-blue-600">5% commission</span> rate.</p>
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
                {listings.map((listing: any) => (
                  <TableRow key={listing.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 rounded-lg shrink-0"></div>
                        <div>
                          <p className="text-slate-900 font-semibold">{listing.title}</p>
                          <p className="text-xs text-slate-500">ID: {listing.id.toUpperCase()}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                          listing.status === "Published" ? "default" : 
                          listing.status === "Pending Review" ? "secondary" : "outline"
                        }
                        className={
                          listing.status === "Published" ? "bg-green-100 text-green-700 hover:bg-green-100 shadow-none border-green-200" :
                          listing.status === "Pending Review" ? "bg-amber-50 text-amber-700 hover:bg-amber-50 shadow-none border-amber-200" :
                          "text-slate-500"
                        }
                      >
                        {listing.status === "Published" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                        {listing.status === "Pending Review" && <Clock className="w-3 h-3 mr-1" />}
                        {listing.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{listing.price}</TableCell>
                    <TableCell>
                      <div className="text-xs text-slate-500">
                        <span className="font-medium text-slate-900">{listing.views}</span> views • 
                        <span className="font-medium text-slate-900 ml-1">{listing.inquiries}</span> leads
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">{listing.date}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="w-4 h-4 text-slate-400" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
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
                  {leads.map((lead: any) => (
                    <div 
                      key={lead.id} 
                      onClick={() => setSelectedLead(lead)}
                      className={`p-4 border-b border-slate-100 cursor-pointer transition-colors ${
                        selectedLead?.id === lead.id ? "bg-blue-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <p className="font-semibold text-slate-900">{lead.name}</p>
                        <span className="text-[10px] text-slate-400 uppercase font-bold">{lead.date}</span>
                      </div>
                      <p className="text-xs text-blue-600 font-medium mb-1 truncate">{lead.property}</p>
                      <p className="text-sm text-slate-500 truncate">{lead.message}</p>
                    </div>
                  ))}
                </ScrollArea>
              </CardContent>
            </Card>
            <Card className="md:col-span-2 overflow-hidden">
              {selectedLead ? (
                <div className="h-[520px]">
                  <ChatInterface 
                    recipient={{ 
                      name: selectedLead.name, 
                      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedLead.name}`,
                      verified: true 
                    }} 
                    propertyTitle={selectedLead.property}
                  />
                </div>
              ) : (
                <div className="h-[520px] flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                    <MessageSquare className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Select a conversation</h3>
                  <p className="text-slate-500 max-w-xs mx-auto mt-2">
                    Click on a lead from the left to start chatting about your properties.
                  </p>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="verifications">
          <Card>
            <CardHeader>
              <CardTitle>Pending Property Verifications</CardTitle>
              <CardDescription>Track the status of your listed properties currently being verified by our professionals.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex items-center gap-4 p-4 border border-slate-100 rounded-xl bg-slate-50/50">
                  <div className="w-16 h-16 bg-slate-200 rounded-lg shrink-0"></div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900">Unfinished Bungalow in Epe</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">Pending Review</Badge>
                      <span className="text-xs text-slate-400">Submitted 2 days ago</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">View Progress</Button>
                </div>
                <div className="text-center py-12">
                  <p className="text-slate-400 italic">No other properties currently in verification.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!user?.isVerified && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <h4 className="font-bold text-amber-800">Your account is not verified</h4>
            <p className="text-sm text-amber-700 mt-1">
              Unverified agents cannot publish listings. <button onClick={() => setIsVerificationModalOpen(true)} className="underline font-semibold hover:text-amber-900">Verify Identity now</button> to unlock full access.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function SellerDashboardView({ listings, handleCreateListing, user }: any) {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Seller Hub</h1>
          <p className="text-slate-500">Manage your private property sales.</p>
        </div>
        <Button onClick={handleCreateListing} className="bg-blue-600">
          <Plus className="w-4 h-4 mr-2" /> List Property
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">My Properties</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {listings.slice(0, 2).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-semibold text-sm">{l.title}</p>
                    <p className="text-xs text-slate-500">{l.price}</p>
                  </div>
                  <Badge variant="outline">{l.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Market Interest</CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] flex items-center justify-center text-slate-400 italic">
            Visualizing interest in your properties...
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Issue Notifications</CardTitle>
          <CardDescription>
            Compliance issue cards are delivered in your in-app conversations and summarized here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IssueChatCards
            userId={String(user?.id ?? "")}
            emptyMessage="No issue notifications right now."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BuyerDashboardView({ user, savedProperties }: any) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">My Justice City</h1>
          <p className="text-slate-500">Saved properties and ongoing inquiries.</p>
        </div>
        {!user.isVerified && (
          <Button asChild className="bg-blue-600 hover:bg-blue-700">
            <Link href="/verify">Get Verified Now</Link>
          </Button>
        )}
      </div>

      <Tabs defaultValue="saved" className="space-y-6">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="saved" className="gap-2">
            <Heart className="w-4 h-4" /> Saved Properties
          </TabsTrigger>
          <TabsTrigger value="tours" className="gap-2">
            <Clock className="w-4 h-4" /> My Tours
          </TabsTrigger>
          <TabsTrigger value="inquiries" className="gap-2">
            <MessageSquare className="w-4 h-4" /> My Inquiries
          </TabsTrigger>
        </TabsList>

        <TabsContent value="saved">
          {savedProperties && savedProperties.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {savedProperties.map((property: any) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="h-[300px] flex flex-col items-center justify-center text-center">
                <Heart className="w-12 h-12 text-slate-200 mb-4" />
                <h3 className="text-lg font-bold text-slate-900">No saved properties yet</h3>
                <p className="text-slate-500 max-w-xs mx-auto mt-2 mb-6">
                  Save properties you're interested in to keep track of them here.
                </p>
                <Button asChild variant="outline">
                  <Link href="/">Browse Properties</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tours">
          <Card>
            <CardContent className="h-[300px] flex flex-col items-center justify-center text-center">
              <Clock className="w-12 h-12 text-slate-200 mb-4" />
              <h3 className="text-lg font-bold text-slate-900">No scheduled tours</h3>
              <p className="text-slate-500 max-w-xs mx-auto mt-2">
                You haven't booked any property tours yet.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inquiries">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">In-App Issue Cards</CardTitle>
              <CardDescription>
                Review compliance issue cards sent inside your in-app chat conversations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IssueChatCards
                userId={String(user?.id ?? "")}
                emptyMessage="No active issue cards. Start a chat with an agent to see your inquiries here."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
