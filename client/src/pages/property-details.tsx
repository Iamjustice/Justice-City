import { useRoute, useLocation } from "wouter";
import { MOCK_PROPERTIES } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { VerificationModal } from "@/components/verification-modal";
import { ChatInterface } from "@/components/chat-interface";
import { useMemo, useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listFavorites, removeFavorite, saveFavorite } from "@/lib/favorites";
import { queryClient } from "@/lib/queryClient";
import { 
  MapPin, 
  Bed, 
  Bath, 
  Expand, 
  ShieldCheck, 
  Lock, 
  MessageSquare,
  Phone,
  Calendar,
  FileText,
  Check,
  X,
  Heart,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import NotFound from "./not-found";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AgentPublicProfileDialog } from "@/components/agent-public-profile-dialog";

export default function PropertyDetails() {
  const [match, params] = useRoute("/property/:id");
  const [, setLocation] = useLocation();
  const { user, login } = useAuth();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAgentProfileOpen, setIsAgentProfileOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const touchStart = useRef<number | null>(null);
  const touchEnd = useRef<number | null>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      nextImage();
    } else if (isRightSwipe) {
      prevImage();
    }
  };

  const property = MOCK_PROPERTIES.find(p => p.id === params?.id);
  const { data: favorites = [] } = useQuery({
    queryKey: ["/api/favorites"],
    queryFn: listFavorites,
    enabled: Boolean(user),
  });
  const favoriteIds = useMemo(
    () => new Set(favorites.map((item) => item.listingId)),
    [favorites],
  );

  if (!property) return <NotFound />;
  const isSaved = favoriteIds.has(property.id);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isSaved) {
        await removeFavorite(property.id);
        return;
      }
      await saveFavorite(property.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  // Mock extra images
  const images = [
    property.image,
    "https://images.unsplash.com/photo-1600566752355-35792bedcfea?q=80&w=2070&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?q=80&w=1974&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1600585154526-990dcea4db0d?q=80&w=2070&auto=format&fit=crop"
  ];

  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  });

  const nextImage = () => setCurrentImageIndex((prev) => (prev + 1) % images.length);
  const prevImage = () => setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);

  const handleAction = (action: string) => {
    if (!user) {
      login();
      return;
    }

    if (action === "save") {
      if (saveMutation.isPending) return;
      saveMutation.mutate();
      return;
    }

    if (!user.isVerified) {
      setIsVerificationModalOpen(true);
      return;
    }
    
    if (action === "chat") {
      setIsChatOpen(true);
    } else if (action === "call") {
      setLocation("/request-callback");
    } else if (action === "tour") {
      setLocation("/schedule-tour");
    }
  };

  return (
    <div className="min-h-screen bg-white pb-20 relative">
      <VerificationModal 
        isOpen={isVerificationModalOpen} 
        onClose={() => setIsVerificationModalOpen(false)}
        triggerAction="contact the seller"
      />

      {/* Floating Save Button - Mobile - Removed per request */}
      <div className="hidden">
        <Button 
          onClick={() => handleAction("save")}
          className={`w-14 h-14 rounded-full shadow-2xl transition-all ${
            isSaved ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:text-red-500"
          } border border-slate-200`}
          disabled={saveMutation.isPending}
        >
          <Heart className={`w-6 h-6 ${isSaved ? "fill-current" : ""}`} />
        </Button>
      </div>

      {/* Chat Dialog */}
      <Dialog open={isChatOpen} onOpenChange={setIsChatOpen}>
        <DialogContent className="sm:max-w-md p-0 border-none bg-transparent shadow-none">
          <div className="relative">
            <ChatInterface 
              recipient={property.agent} 
              propertyTitle={property.title}
              listingId={property.id}
              requesterId={user?.id}
              requesterName={user?.name}
              requesterRole={user?.role ?? undefined}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AgentPublicProfileDialog
        open={isAgentProfileOpen}
        onOpenChange={setIsAgentProfileOpen}
        agent={property.agent}
      />

      {/* Image Gallery Header */}
      <div 
        className="h-[400px] md:h-[600px] relative bg-slate-900 group"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img 
          src={images[currentImageIndex]} 
          alt={property.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40"></div>
        
        {/* Gallery Controls */}
        <button 
          onClick={prevImage}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/20 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/40"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button 
          onClick={nextImage}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/20 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/40"
        >
          <ChevronRight className="w-6 h-6" />
        </button>

        {/* Image Counter */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md text-white text-xs font-medium">
          {currentImageIndex + 1} / {images.length}
        </div>

        {/* Top Badges */}
        <div className="absolute top-6 left-6 flex gap-2">
          <span className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg uppercase tracking-wider">
            {property.type}
          </span>
        </div>
        <div className="absolute top-6 right-6 flex gap-2">
          <span className="bg-green-600 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg flex items-center gap-1.5 backdrop-blur-sm">
            <ShieldCheck className="w-4 h-4" />
            Verified Title
          </span>
        </div>

        {/* Bottom Right Container */}
        <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
          <div className="bg-black/40 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10 shadow-2xl">
            <p className="text-white text-3xl font-bold font-display leading-none">
              {formatter.format(property.price)}
            </p>
          </div>
          <Button 
            onClick={() => handleAction("save")}
            className={`h-12 px-6 rounded-xl shadow-2xl transition-all gap-2 font-bold ${
              isSaved 
                ? "bg-red-500 hover:bg-red-600 text-white" 
                : "bg-white hover:bg-slate-50 text-slate-900"
            }`}
            disabled={saveMutation.isPending}
          >
            <Heart className={`w-5 h-5 ${isSaved ? "fill-current" : ""}`} />
            {isSaved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Left Column: Details */}
        <div className="lg:col-span-2 space-y-10">
          {/* Header section moved here */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-display font-bold text-slate-900 tracking-tight">
              {property.title}
            </h1>
            <div className="flex items-center text-slate-500 gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              <span className="text-lg font-medium">{property.location}</span>
            </div>
          </div>

          {/* Key Features */}
          <div className="bg-slate-50 border border-slate-100 rounded-3xl p-8 shadow-sm flex justify-between items-center">
            <div className="flex-1 text-center">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Bedrooms</p>
              <div className="flex items-center justify-center gap-3">
                <Bed className="w-6 h-6 text-blue-600" />
                <span className="text-3xl font-bold text-slate-900">{property.bedrooms}</span>
              </div>
            </div>
            <div className="w-px h-12 bg-slate-200"></div>
            <div className="flex-1 text-center">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Bathrooms</p>
              <div className="flex items-center justify-center gap-3">
                <Bath className="w-6 h-6 text-blue-600" />
                <span className="text-3xl font-bold text-slate-900">{property.bathrooms}</span>
              </div>
            </div>
            <div className="w-px h-12 bg-slate-200"></div>
            <div className="flex-1 text-center">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Square Ft</p>
              <div className="flex items-center justify-center gap-3">
                <Expand className="w-6 h-6 text-blue-600" />
                <span className="text-3xl font-bold text-slate-900">{property.sqft}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="prose prose-slate max-w-none">
            <h2 className="text-2xl font-display font-bold text-slate-900 mb-6">About this property</h2>
            <p className="text-slate-600 leading-relaxed text-xl font-light">
              {property.description}
            </p>
            <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
              {["24/7 Power", "Gated Security", "Treated Water", "Parking Space"].map((feature, i) => (
                <div key={i} className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 text-slate-700 font-medium border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Verified Documents Preview */}
          <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-2xl">
            <h3 className="font-bold text-xl text-white mb-6 flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-green-400" />
              Verified Documentation
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-4 p-5 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm opacity-80">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-white">Certificate of Occupancy</p>
                  <p className="text-xs text-slate-400">Verified by Justice City Admin</p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-5 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm opacity-80">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-white">Governor's Consent</p>
                  <p className="text-xs text-slate-400">Verified by Justice City Admin</p>
                </div>
              </div>
            </div>
            {(!user || !user.isVerified) && (
              <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm rounded-2xl flex gap-3 items-center">
                <Lock className="w-5 h-5 shrink-0" />
                <p>Full document access is restricted to verified users only.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Agent & Action Card */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-8">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl p-8">
              <button
                type="button"
                onClick={() => setIsAgentProfileOpen(true)}
                className="w-full text-left rounded-2xl p-2 -m-2 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-5 mb-8">
                <div className="relative">
                  <img 
                    src={property.agent.image} 
                    alt={property.agent.name}
                    className="w-20 h-20 rounded-2xl object-cover ring-4 ring-slate-50"
                  />
                  {property.agent.verified && (
                    <div className="absolute -bottom-2 -right-2 bg-blue-600 text-white p-1.5 rounded-lg shadow-lg border-2 border-white">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-xl">{property.agent.name}</h3>
                  <p className="text-slate-500 font-medium">Verified Agent</p>
                  <p className="text-xs text-blue-600 mt-1">Tap to view public profile</p>
                </div>
              </div>
              </button>

              {/* Gated Action Buttons */}
              <div className="space-y-4">
                <Button 
                  className="w-full h-14 text-lg gap-3 rounded-2xl font-bold bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-600/20" 
                  size="lg"
                  onClick={() => handleAction("chat")}
                >
                  <MessageSquare className="w-5 h-5" />
                  Chat with Agent
                </Button>
                
                <Button 
                  variant="outline" 
                  className="w-full h-14 text-lg gap-3 rounded-2xl font-bold border-slate-200 hover:bg-slate-50" 
                  size="lg"
                  onClick={() => handleAction("call")}
                >
                  <Phone className="w-5 h-5" />
                  Request Callback
                </Button>
                
                <Button 
                  variant="secondary" 
                  className="w-full h-14 text-lg gap-3 rounded-2xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-900" 
                  size="lg"
                  onClick={() => handleAction("tour")}
                >
                  <Calendar className="w-5 h-5" />
                  Schedule Tour
                </Button>
              </div>

              {/* Safety Warning */}
              <div className="mt-8 pt-8 border-t border-slate-100">
                <div className="flex items-center gap-2 justify-center mb-2">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  <p className="text-xs font-bold text-slate-900 uppercase tracking-widest">Justice Protect</p>
                </div>
                <p className="text-xs text-slate-400 text-center leading-relaxed">
                  Your identity is protected. Contact details are only shared once mutual verification is complete.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
