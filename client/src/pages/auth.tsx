import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

/**
 * AuthPage Component:
 * Handles user authentication including Sign-Up and Log-In flows.
 * Users can choose their role (Buyer, Renter, Seller, Agent, Admin) during sign-up.
 */
export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const [isSignUp, setIsSignUp] = useState(true);
  const { login, signUp, user, isLoading: authLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync mode (login/signup) with URL query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "login") {
      setIsSignUp(false);
    }
  }, []);

  // Redirect user once they are successfully authenticated
  useEffect(() => {
    if (user) {
      if (isSignUp) {
        setLocation("/verify");
      } else {
        setLocation("/dashboard");
      }
    }
  }, [user, isSignUp, setLocation]);

  // Local state for authentication form
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "buyer" as "buyer" | "renter" | "seller" | "agent" | "admin"
  });

  // Handle form submission: calls signUp or login based on current mode
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      if (isSignUp) {
        await signUp(formData.email, formData.password, {
          name: formData.name,
          email: formData.email,
          role: formData.role,
          isVerified: false
        });
      } else {
        await login(formData.email, formData.password);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show global loading spinner while checking authentication state
  if (authLoading && !isSubmitting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-[90vh] flex items-center justify-center p-4 bg-slate-50/50 py-12">
      <Card className="w-full max-w-md shadow-xl border-slate-200 overflow-hidden">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
              <ShieldCheck className="w-8 h-8" />
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

        {/* Toggle between Sign Up and Log In modes */}
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
                    <option value="renter">Renter</option>
                    <option value="seller">Property Owner / Seller</option>
                    <option value="agent">Real Estate Agent</option>
                    <option value="admin">System Administrator</option>
                  </select>
                </div>
              </>
            )}
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
            <Button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 h-11 text-base font-semibold">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isSignUp ? "Sign Up" : "Log In"}
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
