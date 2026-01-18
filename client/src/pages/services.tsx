import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { ClipboardCheck, Compass, FileSearch, ShieldCheck, Clock, ArrowRight, Building2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { VerificationModal } from "@/components/verification-modal";
import { ChatInterface } from "@/components/chat-interface";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useServices, useCreateServiceRequest } from "@/hooks/use-data";
import { Service } from "@shared/schema";

const ICON_MAP: Record<string, any> = {
  ClipboardCheck,
  Compass,
  FileSearch,
  Building2,
};

/**
 * Services Component:
 * Displays a catalog of professional real estate services available to users.
 */
export default function Services() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  const { data: services, isLoading } = useServices();
  const createRequest = useCreateServiceRequest();

  const handleBook = async (service: Service) => {
    if (!user) {
      setLocation("/auth?mode=login");
      return;
    }
    if (!user.isVerified) {
      setIsVerificationModalOpen(true);
      return;
    }

    try {
      await createRequest.mutateAsync({
        userId: user.id,
        serviceId: service.id,
        details: `Request for ${service.name}`,
        status: "Pending",
      });
      setSelectedService(service);
      setIsSuccessDialogOpen(true);
    } catch (error) {
      console.error("Failed to book service", error);
    }
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <VerificationModal 
        isOpen={isVerificationModalOpen} 
        onClose={() => setIsVerificationModalOpen(false)}
        triggerAction="book professional services"
      />

      {/* Success Dialog */}
      <Dialog open={isSuccessDialogOpen} onOpenChange={setIsSuccessDialogOpen}>
        <DialogContent className="sm:max-w-md text-center p-8">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Service Requested!</h2>
          <p className="text-slate-500 mb-6">
            Your request for {selectedService?.name} has been received. Our team will contact you shortly to finalize details.
          </p>
          <Button onClick={() => setLocation("/dashboard")} className="w-full bg-blue-600">
            View in Dashboard
          </Button>
        </DialogContent>
      </Dialog>

      <div className="max-w-3xl mb-12">
        <h1 className="text-4xl font-display font-bold text-slate-900 mb-4">Professional Services</h1>
        <p className="text-lg text-slate-600 leading-relaxed">
          Access high-intent property services from verified professionals. All our surveyors and valuers are vetted by Justice City for maximum trust.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {services?.map((service) => {
            const Icon = ICON_MAP[service.icon];
            return (
              <Card key={service.id} className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-slate-200">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full group-hover:bg-blue-500/10 transition-colors"></div>
                <CardHeader>
                  <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                    {Icon && <Icon className="w-6 h-6" />}
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
                    disabled={createRequest.isPending}
                  >
                    {createRequest.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Book Now"}
                    {!createRequest.isPending && <ArrowRight className="w-4 h-4 ml-2 group-hover/btn:translate-x-1 transition-transform" />}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Quality Guarantee Banner */}
      <div className="mt-16 bg-slate-900 rounded-3xl p-8 md:p-12 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
          <div className="bg-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center shrink-0">
            <ShieldCheck className="w-8 h-8" />
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
