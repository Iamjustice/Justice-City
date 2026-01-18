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
  ShieldCheck,
  Loader2,
  Heart
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
import { Link } from "wouter";
import { useState } from "react";
import { VerificationModal } from "@/components/verification-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useProperties, useConversations, useServiceRequests } from "@/hooks/use-data";

/**
 * Dashboard Component:
 * The user's personalized hub. Different views are rendered based on the user's role.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [isCreateListingOpen, setIsCreateListingOpen] = useState(false);

  // Fetch all properties to filter for 'My Listings'
  const { data: allProperties, isLoading: propertiesLoading } = useProperties();
  const myListings = allProperties?.filter(p => p.ownerId === user?.id) || [];

  // Fetch conversations for the 'Chats' tab
  const { data: conversations, isLoading: convosLoading } = useConversations(user?.id);

  // Fetch service requests
  const { data: serviceRequests, isLoading: requestsLoading } = useServiceRequests(user?.id);

  const handleCreateListing = () => {
    if (!user?.isVerified) {
      setIsVerificationModalOpen(true);
    } else {
      setIsCreateListingOpen(true);
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
    if (propertiesLoading || convosLoading || requestsLoading) {
      return (
        <div className="flex justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </div>
      );
    }

    switch (user.role) {
      case "admin":
        return <AdminDashboardView requests={serviceRequests} />;
      case "agent":
      case "seller":
        return (
          <ProfessionalDashboardView
            listings={myListings}
            conversations={conversations}
            requests={serviceRequests}
            handleCreateListing={handleCreateListing}
            user={user}
          />
        );
      case "buyer":
      case "renter":
      default:
        return <UserDashboardView user={user} conversations={conversations} requests={serviceRequests} />;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <VerificationModal 
        isOpen={isVerificationModalOpen} 
        onClose={() => setIsVerificationModalOpen(false)}
        triggerAction="create a listing"
      />

      {/* Simplified Create Listing Dialog (Logic would be handled by a dedicated hook/API) */}
      <Dialog open={isCreateListingOpen} onOpenChange={setIsCreateListingOpen}>
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
                <Input id="title" placeholder="e.g. 3 Bedroom Flat" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Listing Type</Label>
                <select className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm">
                  <option>Sale</option>
                  <option>Rent</option>
                </select>
              </div>
            </div>
            {/* ... other form fields ... */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateListingOpen(false)}>Cancel</Button>
            <Button onClick={() => setIsCreateListingOpen(false)} className="bg-blue-600">Submit for Review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderDashboardContent()}
    </div>
  );
}

// Admin View: System-wide management
function AdminDashboardView({ requests }: any) {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-display font-bold text-slate-900">Admin Console</h1>
      <Card>
        <CardHeader>
          <CardTitle>Professional Service Inquiries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client ID</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests?.map((req: any) => (
                <TableRow key={req.id}>
                  <TableCell className="font-mono text-xs">{req.userId}</TableCell>
                  <TableCell>{req.details || "No details provided"}</TableCell>
                  <TableCell><Badge>{req.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">Manage</Button>
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

// Professional View: For Agents and Sellers
function ProfessionalDashboardView({ listings, conversations, requests, handleCreateListing, user }: any) {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">{user.role === 'agent' ? 'Agent' : 'Seller'} Dashboard</h1>
          <p className="text-slate-500">Manage your listings and track performance.</p>
        </div>
        <Button onClick={handleCreateListing} size="lg" className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-5 h-5" />
          Create New Listing
        </Button>
      </div>

      <Tabs defaultValue="listings" className="space-y-6">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="listings" className="gap-2"><Building2 className="w-4 h-4" /> Listings</TabsTrigger>
          <TabsTrigger value="chats" className="gap-2"><MessageSquare className="w-4 h-4" /> Chats</TabsTrigger>
          <TabsTrigger value="requests" className="gap-2"><FileText className="w-4 h-4" /> Service History</TabsTrigger>
        </TabsList>

        <TabsContent value="listings">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-10 text-slate-400">No listings yet.</TableCell></TableRow>
                  ) : listings.map((listing: any) => (
                    <TableRow key={listing.id}>
                      <TableCell className="font-medium">{listing.title}</TableCell>
                      <TableCell><Badge>{listing.status}</Badge></TableCell>
                      <TableCell>₦{Number(listing.price).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chats">
          <Card>
            <CardContent className="p-8 text-center">
              <MessageSquare className="w-12 h-12 text-blue-100 mx-auto mb-4" />
              <p className="text-slate-500 mb-4">You have {conversations?.length || 0} active conversations.</p>
              <Button asChild variant="outline">
                <Link href="/messages">Open Messages</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests">
           <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests?.map((req: any) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.service?.name}</TableCell>
                      <TableCell><Badge variant="outline">{req.status}</Badge></TableCell>
                      <TableCell className="text-slate-500 text-sm">{new Date(req.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

// User View: For Buyers and Renters
function UserDashboardView({ user, conversations, requests }: any) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-slate-900">My Justice City</h1>
        <p className="text-slate-500">Track your saved properties and ongoing inquiries.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Heart className="w-5 h-5 text-red-500" /> Saved Properties</CardTitle></CardHeader>
          <CardContent className="text-center py-8">
            <p className="text-slate-400 text-sm">Browse the marketplace to save properties you like.</p>
            <Button asChild variant="link" className="mt-2 text-blue-600">
              <Link href="/">Explore Listings</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="w-5 h-5 text-blue-600" /> Recent Inquiries</CardTitle></CardHeader>
          <CardContent>
            {conversations?.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-10">No active inquiries.</p>
            ) : (
              <div className="space-y-4">
                {conversations?.slice(0, 3).map((convo: any) => (
                  <div key={convo.id} className="flex justify-between items-center p-3 border rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                    <div>
                      <p className="font-semibold text-slate-900">{convo.property?.title || 'Professional Inquiry'}</p>
                      <p className="text-xs text-slate-500">Updated {new Date(convo.updatedAt).toLocaleDateString()}</p>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="text-blue-600">
                      <Link href="/messages">View Chat</Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
