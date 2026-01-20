import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  SlidersHorizontal, 
  ShieldCheck, 
  ChevronRight, 
  Search as SearchIcon, 
  FileText,
  Loader2
} from "lucide-react";
import { Link } from "wouter";
import { useProperties } from "@/hooks/use-data";
import { PropertyCard } from "@/components/property-card";
import { cn } from "@/lib/utils";
import generatedImage from '@assets/generated_images/modern_trustworthy_city_skyline_for_real_estate_hero_background.png';

/**
 * Home Component:
 * The landing page of Justice City.
 * Features a hero section, search functionality with filters, trust stats,
 * a featured properties grid, and links to professional services.
 */
export default function Home() {
  // State for search and filtering
  const [searchTerm, setSearchTerm] = useState("");
  const [activeType, setActiveType] = useState("Buy"); // Buy or Rent
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(8); // Pagination control
  const [priceFilter, setPriceFilter] = useState("Any");
  const [bedFilter, setBedFilter] = useState("Any");

  // Fetch live properties from Supabase
  const { data: properties, isLoading } = useProperties();

  // Filter properties based on user input
  const filteredProperties = properties?.filter(p => {
    // Basic text search on title and location
    const matchesSearch = p.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         p.location.toLowerCase().includes(searchTerm.toLowerCase());

    // Filter by listing type (Sale vs Rent)
    const matchesType = activeType === "Buy" ? p.type === "Sale" : 
                        activeType === "Rent" ? p.type === "Rent" :
                        activeType === "Sell" ? false : true;
    
    // Filter by price range
    let matchesPrice = true;
    const price = Number(p.price);
    if (priceFilter === "Under ₦10M") matchesPrice = price < 10000000;
    else if (priceFilter === "₦10M - ₦50M") matchesPrice = price >= 10000000 && price <= 50000000;
    else if (priceFilter === "₦50M - ₦200M") matchesPrice = price > 50000000 && price <= 200000000;
    else if (priceFilter === "Above ₦200M") matchesPrice = price > 200000000;

    // Filter by minimum bedroom count
    let matchesBeds = true;
    if (bedFilter !== "Any") {
      const minBeds = parseInt(bedFilter);
      matchesBeds = p.bedrooms >= minBeds;
    }

    return matchesSearch && matchesType && matchesPrice && matchesBeds;
  }) || [];

  return (
    <div className="pb-20 min-h-screen">
      {/* Hero Section: Eye-catching background and core value proposition */}
      <section className="relative min-h-[500px] md:h-[600px] flex items-center justify-center overflow-hidden bg-slate-900 py-20">
        <div className="absolute inset-0">
          <img 
            src={generatedImage}
            alt="City Skyline" 
            className="w-full h-full object-cover opacity-60 mix-blend-overlay"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/40 to-slate-900"></div>
        </div>
        
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 backdrop-blur-md">
            <span className="text-blue-100 font-bold text-xs tracking-widest uppercase">
              The Trust-First Marketplace
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold text-white mb-6 leading-[1.1] tracking-tight">
            Find Your Home. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-500">
              Verify The Truth.
            </span>
          </h1>
          <p className="text-xl text-slate-300 mb-12 max-w-2xl mx-auto leading-relaxed">
            Justice City is the only real estate platform where every user and every property is verified. No fakes. No scams. Just real deals.
          </p>

          {/* Search Bar & Primary Filters */}
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="bg-white p-2 rounded-2xl shadow-2xl shadow-blue-900/40 flex flex-col md:flex-row items-center gap-2">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <Input 
                  placeholder="Search by location, price, or property type..." 
                  className="pl-12 h-14 border-transparent bg-transparent focus-visible:ring-0 text-lg placeholder:text-slate-400"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="lg"
                className={cn(
                  "h-14 px-6 gap-2 text-slate-600 hover:bg-slate-50 transition-all rounded-xl",
                  showFilters && "bg-slate-100 text-blue-600"
                )}
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Filters</span>
              </Button>
            </div>

            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              <div className="flex items-center bg-white/10 backdrop-blur-xl p-1.5 rounded-2xl border border-white/20 w-full md:w-auto shadow-xl">
                {["Buy", "Rent", "Sell"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setActiveType(type)}
                    className="flex-1 md:flex-none px-10 py-3 rounded-xl text-sm font-bold transition-all hover:bg-white/5 text-slate-300 data-[active=true]:bg-blue-600 data-[active=true]:text-white data-[active=true]:shadow-lg active:scale-95"
                    data-active={activeType === type}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <Button size="lg" className="h-[60px] w-full md:w-auto md:px-16 bg-blue-600 hover:bg-blue-500 font-bold text-xl shadow-2xl shadow-blue-600/40 transition-all hover:scale-[1.02] active:scale-[0.98] rounded-2xl">
                Search Properties
              </Button>
            </div>

            {/* Advanced Filters: Conditionally rendered grid */}
            {showFilters && (
              <div className="bg-white p-8 rounded-3xl shadow-2xl border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-8 animate-in zoom-in-95 fade-in duration-300 text-left">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Price Range</label>
                  <select 
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={priceFilter}
                    onChange={(e) => setPriceFilter(e.target.value)}
                  >
                    <option>Any</option>
                    <option>Under ₦10M</option>
                    <option>₦10M - ₦50M</option>
                    <option>₦50M - ₦200M</option>
                    <option>Above ₦200M</option>
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Min Bedrooms</label>
                  <div className="flex gap-2">
                    {["Any", "1+", "2+", "3+", "4+"].map(b => (
                      <button 
                        key={b} 
                        onClick={() => setBedFilter(b)}
                        className={cn(
                          "flex-1 h-12 rounded-xl border text-sm font-bold transition-all",
                          bedFilter === b ? "bg-blue-600 border-blue-600 text-white shadow-lg" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-400 hover:text-blue-600"
                        )}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Property Type</label>
                  <select className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                    <option>All Types</option>
                    <option>Apartment</option>
                    <option>Duplex</option>
                    <option>Land</option>
                    <option>Commercial</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Trust Stats Section: Reinforces platform reliability */}
      <section className="bg-white border-b border-slate-100 overflow-hidden">
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
            {[
              { label: "Verified Listings", value: "2,400+" },
              { label: "Identity Checks", value: "100%" },
              { label: "Fraud Rate", value: "0.0%" },
              { label: "Active Agents", value: "500+" },
            ].map((stat, i) => (
              <div key={i} className="text-center md:text-left border-l-2 border-slate-100 pl-10 first:border-0 md:first:pl-0">
                <p className="text-4xl font-display font-bold text-slate-900 mb-1">{stat.value}</p>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Properties Grid: Main content area */}
      <section className="container mx-auto px-4 py-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-display font-bold text-slate-900">Featured Properties</h2>
            <p className="text-slate-500">Curated listings with verified documentation.</p>
          </div>
          <Button variant="ghost" className="text-blue-600">View All</Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredProperties.slice(0, visibleCount).map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        )}

        {/* 'View More' pagination control */}
        {visibleCount < filteredProperties.length && (
          <div className="mt-12 text-center">
            <Button 
              variant="outline" 
              size="lg" 
              className="px-12 h-12 rounded-full border-blue-200 text-blue-600 hover:bg-blue-50"
              onClick={() => setVisibleCount(prev => prev + 8)}
            >
              View More Properties
            </Button>
          </div>
        )}

        {/* Professional Services Highlights */}
        <div className="mt-20">
          <div className="flex flex-col md:flex-row items-end justify-between mb-12">
            <div>
              <h2 className="text-4xl font-display font-bold text-slate-900 mb-3">Professional Services</h2>
              <p className="text-slate-500 text-lg">Verified experts to assist with your real estate journey.</p>
            </div>
            <Button asChild variant="link" className="text-blue-600 font-bold text-lg p-0 hover:no-underline group">
              <Link href="/services" className="flex items-center gap-2">
                View All Services
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { 
                title: "Land Surveying", 
                desc: "Accurate boundary mapping and topographical surveys by licensed professionals.",
                icon: <SearchIcon className="w-6 h-6" />,
                color: "bg-blue-50 text-blue-600"
              },
              { 
                title: "Property Valuation", 
                desc: "Professional appraisal services to determine the true market value of any asset.",
                icon: <FileText className="w-6 h-6" />,
                color: "bg-green-50 text-green-600"
              },
              { 
                title: "Land Verification", 
                desc: "Complete document review and physical site inspection for absolute peace of mind.",
                icon: <ShieldCheck className="w-6 h-6" />,
                color: "bg-purple-50 text-purple-600"
              }
            ].map((service, i) => (
              <Link key={i} href="/services">
                <div className="group p-8 rounded-3xl border border-slate-100 bg-white hover:border-blue-200 hover:shadow-xl hover:shadow-blue-900/5 transition-all cursor-pointer">
                  <div className={`w-12 h-12 rounded-2xl ${service.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                    {service.icon}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">{service.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-6">{service.desc}</p>
                  <div className="flex items-center text-blue-600 font-semibold text-sm group-hover:gap-2 transition-all">
                    Request Service <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      
      {/* Call to Action Section for Agents */}
      <section className="container mx-auto px-4 mb-8">
        <div className="bg-slate-900 rounded-3xl p-8 md:p-16 text-center md:text-left flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-[100px] opacity-20 translate-x-1/2 -translate-y-1/2"></div>
          
          <div className="relative z-10 max-w-xl">
            <h2 className="text-3xl font-display font-bold text-white mb-4">Are you a Real Estate Agent?</h2>
            <p className="text-slate-300 text-lg mb-8">
              Join the elite circle of verified agents. Build trust instantly with your clients by showing your verified badge.
            </p>
            <Button size="lg" className="bg-white text-slate-900 hover:bg-slate-100 font-semibold h-12 px-8">
              Get Verified Now
            </Button>
          </div>
          
          <div className="relative z-10 bg-white/10 backdrop-blur-lg p-6 rounded-2xl border border-white/10 max-w-xs w-full">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white font-bold">Verification Badge</p>
                <p className="text-slate-400 text-sm">Valid until Dec 2026</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 bg-white/20 rounded-full w-3/4"></div>
              <div className="h-2 bg-white/20 rounded-full w-1/2"></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
