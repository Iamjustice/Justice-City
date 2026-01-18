import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "./supabase";
import { User as SupabaseUser } from "@supabase/supabase-js";

/**
 * Auth Context & Provider:
 * This file manages the authentication state of the application using Supabase Auth.
 * it provides functions for login, sign-up, logout, and identity verification.
 */

type UserRole = "buyer" | "renter" | "seller" | "agent" | "admin" | null;

// Extended user profile structure
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
    // Check for an existing active session on initial load
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await fetchProfile(session.user);
      }
      setIsLoading(false);
    };

    fetchSession();

    // Subscribe to auth state changes (sign-in, sign-out, etc.)
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

  /**
   * Fetches user profile metadata from the public.profiles table.
   * This metadata (role, verification status) is not part of the standard Supabase Auth user object.
   */
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
        // Fallback for cases where Auth user exists but Profile record is missing
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

  /**
   * Logs in an existing user using email and password.
   */
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

  /**
   * Signs up a new user and creates their associated profile record.
   */
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
      // Create the profile metadata record in the public database
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

  /**
   * Logs out the current user.
   */
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

  /**
   * Simulates/Triggers identity verification for the user profile.
   * Updates the is_verified status in the database.
   */
  const verifyIdentity = async () => {
    if (!user) return;

    setIsLoading(true);
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

// Hook for accessing authentication state and methods
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
