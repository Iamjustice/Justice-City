import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import BrandLogo from "@/components/brand-logo";

function normalizeAuthUiError(error: unknown): string {
  const fallback = "Sign-up could not be completed. Please try again.";

  const isJunk = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return (
      !normalized ||
      normalized === "{}" ||
      normalized === "[]" ||
      normalized === "null" ||
      normalized === "undefined" ||
      normalized === "[object object]"
    );
  };

  if (error instanceof Error) {
    const message = String(error.message ?? "").trim();
    if (!isJunk(message)) return message;
  }

  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const message = String(
      payload.message ?? payload.error_description ?? payload.details ?? payload.msg ?? "",
    ).trim();
    if (!isJunk(message)) return message;
  }

  return fallback;
}

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const [isSignUp, setIsSignUp] = useState(true);
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const { signIn, signUp, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    // Check if we should start in login mode
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "login") {
      setIsSignUp(false);
    }
  }, []);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "buyer" as "buyer" | "seller" | "agent" | "owner" | "renter",
    gender: "prefer_not_to_say" as "male" | "female" | "other" | "prefer_not_to_say",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMessage("");
    try {
      if (isSignUp) {
        const signedIn = await signUp({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role,
          gender: formData.gender,
        });
        if (signedIn) {
          setLocation("/verify");
        } else {
          setLocation("/auth?mode=login");
        }
      } else {
        await signIn({
          email: formData.email,
          password: formData.password,
        });
        setLocation("/dashboard");
      }
    } catch (error) {
      const message = normalizeAuthUiError(error);
      setAuthErrorMessage(message);
      console.error("Auth submit failed", {
        mode: isSignUp ? "signup" : "login",
        message,
        error,
      });
      toast({
        title: isSignUp ? "Sign up failed" : "Login failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-[90vh] flex items-center justify-center p-4 bg-slate-50/50 py-12">
      <Card className="w-full max-w-md shadow-xl border-slate-200 overflow-hidden">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <BrandLogo className="h-8 w-auto max-w-[180px]" />
            </div>
          </div>
          <CardTitle className="text-2xl font-display font-bold">
            {isSignUp ? "Create an account" : "Welcome back"}
          </CardTitle>
          <CardDescription>
            {isSignUp 
              ? "Join Justice City to start your verified real estate journey" 
              : "Enter your credentials to access your account"}
          </CardDescription>
        </CardHeader>
        <div className="p-1 px-6 flex justify-center">
          <div className="flex bg-slate-100 p-1 rounded-lg w-full max-w-xs">
            <button
              onClick={() => setIsSignUp(true)}
              className={cn(
                "flex-1 py-1.5 text-sm font-semibold rounded-md transition-all",
                isSignUp ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Sign Up
            </button>
            <button
              onClick={() => setIsSignUp(false)}
              className={cn(
                "flex-1 py-1.5 text-sm font-semibold rounded-md transition-all",
                !isSignUp ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Log In
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input 
                    id="name" 
                    placeholder="John Doe" 
                    required 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">I am a...</Label>
                  <select 
                    id="role"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value as any})}
                  >
                    <option value="buyer">Buyer / Searcher</option>
                    <option value="seller">Property Owner / Seller</option>
                    <option value="agent">Real Estate Agent</option>
                    <option value="owner">Property Owner (Long-term)</option>
                    <option value="renter">Renter / Tenant</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">Gender (Optional)</Label>
                  <select
                    id="gender"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={formData.gender}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        gender: e.target.value as "male" | "female" | "other" | "prefer_not_to_say",
                      })
                    }
                  >
                    <option value="prefer_not_to_say">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </>
            )}
            {authErrorMessage ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {authErrorMessage}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="john@example.com" 
                required 
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 h-11 text-base font-semibold"
            >
              {isLoading ? "Please wait..." : isSignUp ? "Sign Up" : "Log In"}
            </Button>
            <div className="text-sm text-center text-slate-500">
              {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
              <button 
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className={cn(
                  "font-semibold hover:underline",
                  isSignUp ? "text-blue-600" : "text-blue-600"
                )}
              >
                {isSignUp ? "Log In" : "Sign Up"}
              </button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
