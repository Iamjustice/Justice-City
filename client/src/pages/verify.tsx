import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";

// Import Smile ID Web Components
// Note: In a real environment, these would be loaded via the @smileid/web-components package
// The beta SDK uses custom elements like <smile-id-selfie-capture>
import "@smileid/web-components";

/**
 * VerificationPage Component:
 * Guided flow for users to verify their identity using Smile ID.
 */
export default function VerificationPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle Smile ID capture events
  useEffect(() => {
    const handleCapture = async (event: any) => {
      const { images } = event.detail;
      setIsVerifying(true);
      setError(null);

      try {
        await apiRequest("POST", "/api/verify-identity", {
          userId: user?.id,
          jobType: 1, // Biometric KYC
          images: images.map((img: any) => ({
            image_type_id: img.image_type_id,
            image: img.image,
          })),
        });
        setIsDone(true);
      } catch (err: any) {
        console.error("Verification failed:", err);
        setError("Identity verification failed. Please try again.");
      } finally {
        setIsVerifying(false);
      }
    };

    // Listen for the custom event from Smile ID components
    window.addEventListener("smileid-capture", handleCapture);
    return () => window.removeEventListener("smileid-capture", handleCapture);
  }, [user?.id]);

  if (!user) return <div className="p-20 text-center">Please log in to verify identity.</div>;

  if (isDone || user.isVerified) {
    return (
      <div className="container mx-auto px-4 py-20 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6">
          <ShieldCheck className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-4">Identity Verified!</h1>
        <p className="text-slate-500 max-w-md mb-8">
          Congratulations! Your identity has been successfully verified using Smile ID. You now have full access to all Justice City features.
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
        <p className="text-slate-500">Powered by Smile ID. Please follow the instructions to secure your account.</p>
      </div>

      <Card className="shadow-2xl border-none overflow-hidden">
        <CardContent className="p-0">
          {isVerifying ? (
            <div className="p-20 text-center flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
              <p className="text-slate-600 font-medium">Processing your identity documents...</p>
            </div>
          ) : (
            <div className="p-8">
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold">Smile ID Secure Capture</h3>
                  <p className="text-sm text-slate-500 mt-1">We'll need a quick selfie to verify your identity.</p>
                </div>

                {/*
                  Smile ID Web Component for Selfie Capture
                  The SDK automatically handles the camera access and image processing.
                */}
                <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 aspect-video flex items-center justify-center relative">
                   {/* @ts-ignore - Custom Element */}
                   <smile-id-selfie-capture />
                </div>

                <div className="p-4 bg-blue-50 rounded-xl text-xs text-blue-800 flex gap-3">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <p>Your biometric data is encrypted and processed securely by Smile ID according to international data protection standards.</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
