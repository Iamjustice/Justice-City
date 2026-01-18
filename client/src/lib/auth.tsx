import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "./supabase";
import { User as SupabaseUser } from "@supabase/supabase-js";

type UserRole = "buyer" | "renter" | "seller" | "agent" | "admin" | null;

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  avatar?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profile: Omit<UserProfile, "id">) => Promise<void>;
  logout: () => Promise<void>;
  verifyIdentity: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Check active sessions and sets the user
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await fetchProfile(session.user);
      }
      setIsLoading(false);
    };

    fetchSession();

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await fetchProfile(session.user);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (supabaseUser: SupabaseUser) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', supabaseUser.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setUser({
          id: data.id,
          name: data.name,
          email: supabaseUser.email!,
          role: data.role,
          isVerified: data.is_verified,
          avatar: data.avatar,
        });
      } else {
        // Handle case where auth user exists but profile doesn't yet
        setUser({
          id: supabaseUser.id,
          name: supabaseUser.email?.split('@')[0] || 'User',
          email: supabaseUser.email!,
          role: 'buyer',
          isVerified: false,
        });
      }
    } catch (error: any) {
      console.error('Error fetching profile:', error.message);
    }
  };

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
      setIsLoading(false);
      throw error;
    }

    toast({
      title: "Welcome back",
      description: "Successfully logged in.",
    });
  };

  const signUp = async (email: string, password: string, profile: Omit<UserProfile, "id">) => {
    setIsLoading(true);
    const { data: { user: supabaseUser }, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      toast({
        title: "Sign up failed",
        description: error.message,
        variant: "destructive",
      });
      setIsLoading(false);
      throw error;
    }

    if (supabaseUser) {
      // Create profile in our database
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([
          {
            id: supabaseUser.id,
            name: profile.name,
            role: profile.role,
            is_verified: profile.isVerified,
            avatar: profile.avatar
          },
        ]);

      if (profileError) {
        console.error('Error creating profile:', profileError.message);
      }
    }

    toast({
      title: "Account created",
      description: "Please check your email for verification.",
    });
    setIsLoading(false);
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setUser(null);
      toast({
        title: "Logged out",
      });
    }
  };

  const verifyIdentity = async () => {
    if (!user) return;

    setIsLoading(true);
    // In a real app, this would trigger a verification flow (e.g., Stripe Identity or similar)
    // For now, we'll just update the profile in Supabase
    const { error } = await supabase
      .from('profiles')
      .update({ is_verified: true })
      .eq('id', user.id);

    if (error) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setUser({ ...user, isVerified: true });
      toast({
        title: "Identity Verified",
        description: "You now have full access to Justice City.",
        className: "bg-green-600 text-white border-none",
      });
    }
    setIsLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, signUp, verifyIdentity }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
