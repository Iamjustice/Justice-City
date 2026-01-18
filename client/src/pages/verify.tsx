import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Upload, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * VerificationPage Component:
 * Guided flow for users to verify their identity.
 * Handles document upload simulation and updates user status.
 */
export default function VerificationPage() {
  const { user, verifyIdentity } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleNext = () => setStep(step + 1);

  const handleSubmit = async () => {
    setIsVerifying(true);
    await verifyIdentity(); // Call the auth method which updates DB
    setIsVerifying(false);
    setIsDone(true);
  };

  if (!user) return <div className="p-20 text-center">Please log in to verify identity.</div>;

  if (isDone || user.isVerified) {
    return (
      <div className="container mx-auto px-4 py-20 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6">
          <ShieldCheck className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-4">Identity Verified!</h1>
        <p className="text-slate-500 max-w-md mb-8">
          Congratulations! Your identity has been successfully verified. You now have full access to all Justice City features.
        </p>
        <Button onClick={() => setLocation("/dashboard")} className="bg-blue-600 h-12 px-8">
          Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-display font-bold text-slate-900 mb-2">Identity Verification</h1>
        <p className="text-slate-500">Secure your account and build trust in the marketplace.</p>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mt-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 w-12 rounded-full transition-all duration-500",
                step >= s ? "bg-blue-600" : "bg-slate-200"
              )}
            />
          ))}
        </div>
      </div>

      <Card className="shadow-2xl border-none">
        <CardContent className="pt-8">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold">Step 1: ID Selection</h3>
                <p className="text-sm text-slate-500 mt-1">Select the document type you want to provide.</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {["National ID Card (NIN)", "International Passport", "Driver's License"].map((type) => (
                  <button
                    key={type}
                    onClick={handleNext}
                    className="p-4 border border-slate-200 rounded-xl text-left hover:border-blue-600 hover:bg-blue-50/50 transition-all flex justify-between items-center group"
                  >
                    <span className="font-semibold text-slate-700">{type}</span>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold">Step 2: Upload Document</h3>
                <p className="text-sm text-slate-500 mt-1">Please provide a clear photo of your document.</p>
              </div>
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer group bg-slate-50/50">
                <Upload className="w-10 h-10 text-slate-400 mx-auto mb-4 group-hover:text-blue-600" />
                <p className="font-bold text-slate-700">Drop files here or click to upload</p>
                <p className="text-xs text-slate-400 mt-1">Supports JPG, PNG, PDF up to 10MB</p>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
                <Button onClick={handleNext} className="flex-1 bg-blue-600">Next Step</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold">Step 3: Final Submission</h3>
                <p className="text-sm text-slate-500 mt-1">Confirm and submit your verification request.</p>
              </div>
              <div className="bg-slate-50 p-6 rounded-2xl space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Document Type</span>
                  <span className="font-bold">National ID (NIN)</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Full Name</span>
                  <span className="font-bold">{user.name}</span>
                </div>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Back</Button>
                <Button onClick={handleSubmit} className="flex-1 bg-blue-600" disabled={isVerifying}>
                  {isVerifying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Complete Verification
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
