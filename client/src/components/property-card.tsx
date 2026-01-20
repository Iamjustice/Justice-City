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
        <div className="bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-blue-900/5 transition-all duration-500 hover:-translate-y-2">
          {/* Image Container */}
          <div className="relative h-72 overflow-hidden">
            <img 
              src={property.image} 
              alt={property.title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            />

            {/* Status Badge */}
            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md px-4 py-1.5 rounded-xl text-[10px] font-black tracking-widest text-slate-900 shadow-xl border border-white/20 uppercase">
              {property.type}
            </div>

            {/* Verified Badge */}
            <div className="absolute top-4 right-4 bg-blue-600 px-4 py-1.5 rounded-xl text-[10px] font-black tracking-widest text-white shadow-xl flex items-center gap-1.5 uppercase border border-blue-500/50">
              <ShieldCheck className="w-3.5 h-3.5 fill-white/20" />
              Verified
            </div>
            
            {/* Price and Save Button Overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent p-6 pt-20 flex items-end justify-between">
              <div>
                <p className="text-blue-400 text-[10px] font-black tracking-[0.2em] uppercase mb-1">Price</p>
                <p className="text-white font-bold text-2xl font-display tracking-tight">
                  {formatter.format(Number(property.price))}
                </p>
              </div>
              <button 
                data-testid={`button-save-${property.id}`}
                className="bg-white/10 backdrop-blur-xl p-3 rounded-2xl text-white hover:bg-white hover:text-red-500 transition-all duration-300 border border-white/20 group/heart"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <Heart className="w-5 h-5 group-hover/heart:fill-current" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors leading-tight">
                {property.title}
              </h3>
              <div className="flex items-center gap-1.5 text-slate-500 text-sm mt-2 font-medium">
                <MapPin className="w-4 h-4 text-blue-500" />
                <span className="truncate">{property.location}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-50 text-slate-600">
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5">
                  <Bed className="w-4 h-4 text-slate-400" />
                  <span className="font-bold text-slate-900">{property.bedrooms}</span>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Beds</span>
              </div>
              <div className="flex flex-col items-center gap-1 border-x border-slate-50 px-6">
                <div className="flex items-center gap-1.5">
                  <Bath className="w-4 h-4 text-slate-400" />
                  <span className="font-bold text-slate-900">{property.bathrooms}</span>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Baths</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5">
                  <Expand className="w-4 h-4 text-slate-400" />
                  <span className="font-bold text-slate-900">{property.sqft}</span>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">sqft</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
