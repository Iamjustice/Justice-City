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
  Heart,
  Upload,
  Image as ImageIcon,
  X
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
import { useState, useRef } from "react";
import { VerificationModal } from "@/components/verification-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useProperties, useConversations, useServiceRequests, useUploadFile } from "@/hooks/use-data";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Dashboard Component:
 * The user's personalized hub. Different views are rendered based on the user's role.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [isCreateListingOpen, setIsCreateListingOpen] = useState(false);

  // Listing creation state
  const [isSubmittingListing, setIsSubmittingListing] = useState(false);
  const [listingForm, setListingForm] = useState({
    title: "",
    type: "Sale",
    price: "",
    location: "",
    bedrooms: "0",
    bathrooms: "0",
    sqft: "0",
    description: "",
  });
  const [propertyImage, setPropertyImage] = useState<File | null>(null);
  const [propertyDocs, setPropertyDocs] = useState<File[]>([]);

  const uploadFile = useUploadFile();

  // Fetch all properties to filter for 'My Listings'
  const { data: allProperties, isLoading: propertiesLoading, refetch: refetchProperties } = useProperties();
  const myListings = allProperties?.filter(p => p.ownerId === user?.id) || [];

  const { data: conversations, isLoading: convosLoading } = useConversations(user?.id);
  const { data: serviceRequests, isLoading: requestsLoading } = useServiceRequests(user?.id);

  const handleCreateListing = () => {
    if (!user?.isVerified) {
      setIsVerificationModalOpen(true);
    } else {
      setIsCreateListingOpen(true);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'docs') => {
    if (e.target.files) {
      if (type === 'image') setPropertyImage(e.target.files[0]);
      else setPropertyDocs(Array.from(e.target.files));
    }
  };

  const handleSubmitListing = async () => {
    if (!propertyImage || !user) {
      toast({ title: "Image required", description: "Please upload a primary property image.", variant: "destructive" });
      return;
    }

    setIsSubmittingListing(true);
    try {
      // 1. Upload primary image
      const imagePath = `properties/${user.id}/${Date.now()}_${propertyImage.name}`;
      const imageUrl = await uploadFile.mutateAsync({ file: propertyImage, bucket: 'property-images', path: imagePath });

      // 2. Create property record
      // Note: This ideally would be a transaction or handled by a backend service
      const res = await apiRequest("POST", "/api/properties", {
        ...listingForm,
        price: listingForm.price,
        bedrooms: parseInt(listingForm.bedrooms),
        bathrooms: parseInt(listingForm.bathrooms),
        sqft: parseInt(listingForm.sqft),
        image: imageUrl,
        ownerId: user.id,
        agent: {
          id: user.id,
          name: user.name,
          verified: user.isVerified,
          image: user.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=agent"
        }
      });
      const newProperty = await res.json();

      // 3. Upload documents (C of O, etc.)
      for (const doc of propertyDocs) {
        const docPath = `documents/${newProperty.id}/${Date.now()}_${doc.name}`;
        const docUrl = await uploadFile.mutateAsync({ file: doc, bucket: 'property-documents', path: docPath });

        await apiRequest("POST", "/api/property-documents", {
          propertyId: newProperty.id,
          name: doc.name,
          fileUrl: docUrl,
          documentType: "OTHER", // Defaulting to other for simple form
        });
      }

      toast({ title: "Listing created", description: "Your property has been submitted for review." });
      setIsCreateListingOpen(false);
      refetchProperties();
    } catch (error) {
      console.error(error);
      toast({ title: "Submission failed", variant: "destructive" });
    } finally {
      setIsSubmittingListing(false);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <h2 className="text-2xl font-bold">Please log in to view your dashboard</h2>
        <Button asChild><Link href="/">Go Home</Link></Button>
      </div>
    );
  }

  const renderDashboardContent = () => {
    if (propertiesLoading || convosLoading || requestsLoading) {
      return <div className="flex justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-blue-600" /></div>;
    }

    switch (user.role) {
      case "admin": return <AdminDashboardView requests={serviceRequests} />;
      case "agent":
      case "seller": return <ProfessionalDashboardView listings={myListings} conversations={conversations} requests={serviceRequests} handleCreateListing={handleCreateListing} user={user} />;
      default: return <UserDashboardView user={user} conversations={conversations} requests={serviceRequests} />;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <VerificationModal isOpen={isVerificationModalOpen} onClose={() => setIsVerificationModalOpen(false)} triggerAction="create a listing" />

      {/* Enhanced Create Listing Dialog */}
      <Dialog open={isCreateListingOpen} onOpenChange={setIsCreateListingOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="text-2xl font-display font-bold">Create New Listing</DialogTitle>
            <DialogDescription>Add a new property and its verification documents.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Property Title</Label>
                <Input value={listingForm.title} onChange={e => setListingForm({...listingForm, title: e.target.value})} placeholder="e.g. 3 Bedroom Flat" />
              </div>
              <div className="space-y-2">
                <Label>Listing Type</Label>
                <select className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm" value={listingForm.type} onChange={e => setListingForm({...listingForm, type: e.target.value})}>
                  <option value="Sale">Sale</option>
                  <option value="Rent">Rent</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Price (₦)</Label>
                <Input type="number" value={listingForm.price} onChange={e => setListingForm({...listingForm, price: e.target.value})} placeholder="50,000,000" />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={listingForm.location} onChange={e => setListingForm({...listingForm, location: e.target.value})} placeholder="Lekki, Lagos" />
              </div>
              <div className="space-y-2">
                <Label>Bedrooms</Label>
                <Input type="number" value={listingForm.bedrooms} onChange={e => setListingForm({...listingForm, bedrooms: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <textarea className="w-full h-24 p-3 rounded-lg border border-slate-200 text-sm" value={listingForm.description} onChange={e => setListingForm({...listingForm, description: e.target.value})} placeholder="Describe features..." />
            </div>

            {/* Media Upload */}
            <div className="space-y-4">
              <Label className="text-base font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Property Media & Verification</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Image Upload */}
                <div className="space-y-2">
                   <Label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Main Photo</Label>
                   <div className="relative aspect-video border-2 border-dashed rounded-xl flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors group cursor-pointer">
                      {propertyImage ? (
                        <>
                          <img src={URL.createObjectURL(propertyImage)} className="w-full h-full object-cover rounded-lg" />
                          <button onClick={() => setPropertyImage(null)} className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-full"><X className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <ImageIcon className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2" />
                          <p className="text-xs font-medium">Click to upload photo</p>
                          <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => handleFileChange(e, 'image')} />
                        </>
                      )}
                   </div>
                </div>

                {/* Documents Upload */}
                <div className="space-y-2">
                  <Label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Title Documents (C of O, Survey)</Label>
                  <div className="border-2 border-dashed rounded-xl p-4 bg-slate-50 flex flex-col items-center justify-center group relative cursor-pointer min-h-[100px]">
                    <FileText className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2" />
                    <p className="text-xs font-medium">{propertyDocs.length > 0 ? `${propertyDocs.length} files selected` : 'Upload Verification Docs'}</p>
                    <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => handleFileChange(e, 'docs')} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t pt-6">
            <Button variant="outline" onClick={() => setIsCreateListingOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitListing} className="bg-blue-600 px-8" disabled={isSubmittingListing}>
              {isSubmittingListing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Submit Property
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderDashboardContent()}
    </div>
  );
}

// Sub-components (simplified for brevity, keeping same logic)
function AdminDashboardView({ requests }: any) {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-display font-bold text-slate-900">Admin Console</h1>
      <Card>
        <CardHeader><CardTitle>Verification Queue</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>User ID</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {requests?.map((req: any) => (
                <TableRow key={req.id}>
                  <TableCell className="font-mono text-xs">{req.userId}</TableCell>
                  <TableCell>Service Request</TableCell>
                  <TableCell><Badge>{req.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfessionalDashboardView({ listings, conversations, requests, handleCreateListing, user }: any) {
  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">{user.role === 'agent' ? 'Agent' : 'Seller'} Dashboard</h1>
          <p className="text-slate-500">Manage your active listings.</p>
        </div>
        <Button onClick={handleCreateListing} className="bg-blue-600 gap-2"><Plus className="w-5 h-5" /> New Listing</Button>
      </div>
      <Tabs defaultValue="listings">
        <TabsList><TabsTrigger value="listings">Listings</TabsTrigger><TabsTrigger value="chats">Chats</TabsTrigger></TabsList>
        <TabsContent value="listings">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Property</TableHead><TableHead>Verification</TableHead><TableHead>Price</TableHead></TableRow></TableHeader>
              <TableBody>
                {listings.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.title}</TableCell>
                    <TableCell><Badge className={l.isTitleVerified ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}>{l.isTitleVerified ? 'Verified Title' : 'Pending'}</Badge></TableCell>
                    <TableCell>₦{Number(l.price).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="chats">
           <Card><CardContent className="p-8 text-center"><p>You have {conversations?.length || 0} active chats.</p><Button asChild variant="outline" className="mt-4"><Link href="/messages">Open Message Center</Link></Button></CardContent></Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function UserDashboardView({ user, conversations }: any) {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-display font-bold">My Justice City</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Heart className="w-5 h-5 text-red-500" /> Saved Properties</CardTitle></CardHeader><CardContent className="text-center py-10"><p className="text-slate-400">No saved properties.</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-blue-600" /> Recent Chats</CardTitle></CardHeader><CardContent>
          {conversations?.length > 0 ? <Button asChild className="w-full"><Link href="/messages">View Messages</Link></Button> : <p className="text-center text-slate-400">No chats yet.</p>}
        </CardContent></Card>
      </div>
    </div>
  );
}
