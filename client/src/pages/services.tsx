import { useMemo, useState } from "react";
import { PROFESSIONAL_SERVICES } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { ClipboardCheck, Compass, FileSearch, ShieldCheck, Clock, ArrowRight, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { VerificationModal } from "@/components/verification-modal";
import { ChatInterface } from "@/components/chat-interface";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import BrandLogo from "@/components/brand-logo";
import { fetchServiceOfferings, type ServiceOffering } from "@/lib/service-offerings";
import { useQuery } from "@tanstack/react-query";

const ICON_MAP: Record<string, any> = {
  ClipboardCheck,
  Compass,
  FileSearch,
  Building2,
};

const SERVICE_CODE_BY_NAME: Record<string, string> = {
  "Property Valuation": "real_estate_valuation",
  "Land Surveying": "land_surveying",
  "Land Info Verification": "land_verification",
  "Snagging Services": "snagging",
};

type ServiceView = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  price: string;
  turnaround: string;
};

const FALLBACK_SERVICES: ServiceView[] = PROFESSIONAL_SERVICES.map((service) => ({
  id: service.id,
  code: SERVICE_CODE_BY_NAME[service.name] ?? "general_service",
  name: service.name,
  description: service.description,
  icon: service.icon,
  price: service.price,
  turnaround: service.turnaround,
}));

export default function Services() {
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceView | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const serviceOfferingsQuery = useQuery({
    queryKey: ["/api/service-offerings"],
    queryFn: fetchServiceOfferings,
  });

  const services = useMemo(() => {
    const rows = Array.isArray(serviceOfferingsQuery.data) ? serviceOfferingsQuery.data : [];
    if (rows.length === 0) return FALLBACK_SERVICES;
    return rows.map((item: ServiceOffering) => ({
      id: item.code,
      code: item.code,
      name: item.name,
      description: item.description,
      icon: item.icon,
      price: item.price,
      turnaround: item.turnaround,
    }));
  }, [serviceOfferingsQuery.data]);

  const isLoadingServices = serviceOfferingsQuery.isLoading;

  const handleBook = (service: ServiceView) => {
    if (!user) {
      login();
      return;
    }
    if (!user.isVerified) {
      setIsVerificationModalOpen(true);
      return;
    }
    setSelectedService(service);
    setIsChatOpen(true);
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <VerificationModal 
        isOpen={isVerificationModalOpen} 
        onClose={() => setIsVerificationModalOpen(false)}
        triggerAction="book professional services"
      />

      <Dialog open={isChatOpen} onOpenChange={setIsChatOpen}>
        <DialogContent className="sm:max-w-md p-0 border-none bg-transparent shadow-none">
          {selectedService && (
            <ChatInterface 
              recipient={{
                id: "justice-city-support",
                name: "Justice City Support",
                image: "https://api.dicebear.com/7.x/bottts/svg?seed=Support",
                verified: true,
                role: "support",
              }}
              propertyTitle={selectedService.name}
              requesterId={user?.id}
              requesterName={user?.name}
              requesterRole={user?.role ?? undefined}
              conversationScope="service"
              serviceCode={selectedService.code}
              initialMessage={
                selectedService.code === "land_surveying"
                  ? "Hello! I saw you are interested in our professional services. Do you mind giving detail description of the type of survey service you want?"
                  : selectedService.code === "real_estate_valuation"
                  ? "Hello! I saw you are interested in our professional services. Could you provide the address and type of property you'd like us to value?"
                  : selectedService.code === "land_verification"
                  ? "Hello! I saw you are interested in our professional services. Please provide the details of the land or title number you'd like us to verify."
                  : selectedService.code === "snagging"
                  ? "Hello! I saw you are interested in our professional services. When is your move-in date and what's the location of the new building?"
                  : `Hello! I saw you were interested in our ${selectedService.name}. How can we help you today?`
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="max-w-3xl mb-12">
        <h1 className="text-4xl font-display font-bold text-slate-900 mb-4">Professional Services</h1>
        <p className="text-lg text-slate-600 leading-relaxed">
          Access high-intent property services from verified professionals. All our surveyors and valuers are vetted by Justice City for maximum trust.
        </p>
        {isLoadingServices && (
          <p className="text-sm text-slate-500 mt-3">Loading current service pricing and delivery timelines...</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {services.map((service) => {
          const Icon = ICON_MAP[service.icon];
          if (!Icon) return null;
          return (
            <Card key={service.id} className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-slate-200">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full group-hover:bg-blue-500/10 transition-colors"></div>
              <CardHeader>
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                  <Icon className="w-6 h-6" />
                </div>
                <CardTitle className="text-xl">{service.name}</CardTitle>
                <CardDescription className="text-slate-500 min-h-[48px]">
                  {service.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Clock className="w-4 h-4 text-blue-500" />
                  <span>Delivery: <strong>{service.turnaround}</strong></span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <ShieldCheck className="w-4 h-4 text-green-500" />
                  <span>Vetted Professionals Only</span>
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between border-t border-slate-100 pt-6">
                <div>
                  <p className="text-xs text-slate-400 uppercase font-semibold">Starts from</p>
                  <p className="text-xl font-display font-bold text-slate-900">{service.price}</p>
                </div>
                <Button 
                  onClick={() => handleBook(service)}
                  className="bg-blue-600 hover:bg-blue-700 group/btn"
                >
                  Book Now
                  <ArrowRight className="w-4 h-4 ml-2 group-hover/btn:translate-x-1 transition-transform" />
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Trust Banner */}
      <div className="mt-16 bg-slate-900 rounded-3xl p-8 md:p-12 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <BrandLogo className="h-10 w-auto max-w-[220px] brightness-0 invert" />
          </div>
          <div>
            <h2 className="text-2xl font-display font-bold mb-2">The Justice City Quality Guarantee</h2>
            <p className="text-slate-400 max-w-xl">
              Every service report is audited by our internal team before delivery. If a surveyor isn't verified, they aren't on our platform. Period.
            </p>
          </div>
          <div className="md:ml-auto">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10 h-12 px-8">
              Learn about Vetting
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
