import { Property } from "@/lib/mock-data";
import { Link } from "wouter";
import { MapPin, Bed, Bath, Expand, ShieldCheck, Heart } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { AgentPublicProfileDialog } from "@/components/agent-public-profile-dialog";
import { useAuth } from "@/lib/auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listFavorites, removeFavorite, saveFavorite } from "@/lib/favorites";
import { queryClient } from "@/lib/queryClient";

export function PropertyCard({ property }: { property: Property }) {
  const [isAgentProfileOpen, setIsAgentProfileOpen] = useState(false);
  const { user, login } = useAuth();
  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  });

  const { data: favorites = [] } = useQuery({
    queryKey: ["/api/favorites"],
    queryFn: listFavorites,
    enabled: Boolean(user),
  });

  const favoriteIds = useMemo(
    () => new Set(favorites.map((item) => item.listingId)),
    [favorites],
  );
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

  const toggleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      login();
      return;
    }
    if (saveMutation.isPending) return;
    saveMutation.mutate();
  };

  return (
    <div className="group relative">
      <AgentPublicProfileDialog
        open={isAgentProfileOpen}
        onOpenChange={setIsAgentProfileOpen}
        agent={property.agent}
      />
      <Link href={`/property/${property.id}`} className="block">
        <div className="bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1">
          {/* Image Container */}
          <div className="relative h-64 overflow-hidden">
            <img 
              src={property.image} 
              alt={property.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
            <div className="absolute top-3 left-3 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-slate-900 shadow-sm">
              {property.type.toUpperCase()}
            </div>
            <div className="absolute top-3 right-3 bg-blue-600/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Verified
            </div>
            
            {/* Price and Save Button Overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-12 flex items-end justify-between">
              <p className="text-white font-bold text-lg font-display">
                {formatter.format(property.price)}
              </p>
              <button 
                data-testid={`button-save-${property.id}`}
                className={cn(
                  "p-2 rounded-full transition-all duration-200 border backdrop-blur-md",
                  saveMutation.isPending && "opacity-60 cursor-not-allowed",
                  isSaved 
                    ? "bg-red-500 border-red-400 text-white" 
                    : "bg-white/20 border-white/30 text-white hover:bg-white hover:text-red-500"
                )}
                onClick={toggleSave}
                disabled={saveMutation.isPending}
              >
                <Heart className={cn("w-4 h-4", isSaved && "fill-current")} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors">
                {property.title}
              </h3>
              <div className="flex items-center gap-1 text-slate-500 text-sm mt-1">
                <MapPin className="w-3.5 h-3.5" />
                <span className="truncate">{property.location}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 py-2 border-t border-slate-100 text-slate-600 text-sm">
              <div className="flex items-center gap-1.5">
                <Bed className="w-4 h-4 text-slate-400" />
                <span className="font-medium">{property.bedrooms}</span>
                <span className="text-xs text-slate-400">Beds</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Bath className="w-4 h-4 text-slate-400" />
                <span className="font-medium">{property.bathrooms}</span>
                <span className="text-xs text-slate-400">Baths</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Expand className="w-4 h-4 text-slate-400" />
                <span className="font-medium">{property.sqft}</span>
                <span className="text-xs text-slate-400">sqft</span>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsAgentProfileOpen(true);
                }}
                className="w-full flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-slate-50 transition-colors text-left"
              >
                <img
                  src={property.agent.image}
                  alt={property.agent.name}
                  className="w-9 h-9 rounded-full object-cover border border-slate-200"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{property.agent.name}</p>
                  <p className="text-xs text-blue-600">Tap to view agent profile</p>
                </div>
                {property.agent.verified && (
                  <ShieldCheck className="w-4 h-4 text-green-600 ml-auto flex-shrink-0" />
                )}
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
