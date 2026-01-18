import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Phone, Calendar, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * RequestCallbackPage Component:
 * Allows users to request a phone call from an agent regarding a property.
 */
export default function RequestCallbackPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));

    setIsSubmitting(false);
    setIsSuccess(true);
  };

  if (!user) return <div className="p-20 text-center">Please log in to request a callback.</div>;

  if (isSuccess) {
    return (
      <div className="container mx-auto px-4 py-20 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-4">Request Received!</h1>
        <p className="text-slate-500 max-w-md mb-8">
          The agent has been notified. You can expect a call within 24 business hours at the number provided.
        </p>
        <Button onClick={() => setLocation("/dashboard")}>Go to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-lg">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-6 group">
        <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" /> Back
      </Button>

      <Card className="shadow-xl">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Phone className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl">Request a Callback</CardTitle>
          <CardDescription>Leave your details and the agent will call you back.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input id="phone" placeholder="+234 ..." required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Preferred Time</Label>
              <select className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option>Anytime</option>
                <option>Morning (9 AM - 12 PM)</option>
                <option>Afternoon (12 PM - 4 PM)</option>
                <option>Evening (4 PM - 7 PM)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes (Optional)</Label>
              <Textarea id="notes" placeholder="e.g. I'm interested in the 3-bedroom unit..." />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full bg-blue-600 h-12" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit Request
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
