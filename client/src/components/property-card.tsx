import { Property } from "@shared/schema";
import { Link } from "wouter";
import { MapPin, Bed, Bath, Expand, ShieldCheck, Heart } from "lucide-react";

export function PropertyCard({ property }: { property: Property }) {
  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  });

  return (
    <div className="group relative">
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
                {formatter.format(Number(property.price))}
              </p>
              <button 
                data-testid={`button-save-${property.id}`}
                className="bg-white/20 backdrop-blur-md p-2 rounded-full text-white hover:bg-white hover:text-red-500 transition-all duration-200 border border-white/30"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Save logic would go here
                }}
              >
                <Heart className="w-4 h-4" />
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
          </div>
        </div>
      </Link>
    </div>
  );
}
