import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { fetchVerificationStatus, submitVerification } from "@/lib/verification";
import { apiRequest } from "@/lib/queryClient";
import { getSupabaseClient } from "@/lib/supabase";

type UserRole = "buyer" | "seller" | "agent" | "owner" | "renter" | "admin" | null;

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  avatar?: string;
}

interface SignInPayload {
  email: string;
  password: string;
}

interface SignUpPayload extends SignInPayload {
  name: string;
  role: "buyer" | "seller" | "agent" | "owner" | "renter";
  gender?: "male" | "female" | "other" | "prefer_not_to_say";
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (role?: UserRole) => void;
  signIn: (payload: SignInPayload) => Promise<void>;
  signUp: (payload: SignUpPayload) => Promise<boolean>;
  logout: () => Promise<void>;
  verifyIdentity: (options?: { verificationId?: string }) => Promise<boolean>;
  updateProfileAvatar: (file: File) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const VERIFICATION_POLL_INTERVAL_MS = 8000;

function normalizeRole(
  rawRole: unknown,
  options?: { allowAdmin?: boolean },
): Exclude<UserRole, null> {
  const role = String(rawRole ?? "")
    .trim()
    .toLowerCase();
  if (role === "buyer" || role === "seller" || role === "agent") {
    return role;
  }
  if (role === "admin") {
    return options?.allowAdmin ? "admin" : "buyer";
  }
  if (role === "owner" || role === "renter") return role;
  return "buyer";
}

function formatAuthError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const message = String(
      payload.message ??
        payload.error_description ??
        payload.msg ??
        payload.details ??
        "",
    ).trim();
    const code = String(payload.code ?? "").trim();
    const status = String(payload.status ?? payload.statusCode ?? "").trim();
    const body = String(payload.body ?? "").trim();

    const parts = [message, code ? `code=${code}` : "", status ? `status=${status}` : "", body]
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
  }

  return "Authentication failed. Please try again.";
}

function toAppUser(payload: {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  avatar?: string;
}): User {
  const email = String(payload.email ?? "").trim();
  const resolvedName =
    String(payload.name ?? "").trim() ||
    email.split("@")[0] ||
    "User";

  return {
    id: String(payload.id ?? ""),
    name: resolvedName,
    email,
    role: normalizeRole(payload.role ?? "buyer", { allowAdmin: true }),
    isVerified: Boolean(payload.isVerified),
    emailVerified: Boolean(payload.emailVerified),
    phoneVerified: Boolean(payload.phoneVerified),
    avatar: String(payload.avatar ?? "").trim() || undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!supabase) return "";
    const { data, error } = await supabase.auth.getSession();
    if (error) return "";
    return String(data.session?.access_token ?? "").trim();
  }, [supabase]);

  const fetchAuthProfile = useCallback(
    async (accessToken: string): Promise<User> => {
      const response = await apiRequest("GET", "/api/auth/me", undefined, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json()) as {
        id: string;
        name?: string;
        email?: string;
        role?: string;
        isVerified?: boolean;
        emailVerified?: boolean;
        phoneVerified?: boolean;
        avatar?: string;
      };
      return toAppUser(payload);
    },
    [],
  );

  const syncSessionUser = useCallback(async (): Promise<void> => {
    if (!supabase) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const profile = await fetchAuthProfile(data.session.access_token);
      setUser(profile);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAuthProfile, supabase]);

  useEffect(() => {
    let active = true;
    void syncSessionUser();

    if (!supabase) return () => undefined;

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;

      if (!session?.access_token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        const profile = await fetchAuthProfile(session.access_token);
        if (!active) return;
        setUser(profile);
      } catch {
        if (!active) return;
        setUser(null);
      } finally {
        if (active) setIsLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [fetchAuthProfile, supabase, syncSessionUser]);

  const refreshVerificationStatus = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;

    try {
      const snapshot = await fetchVerificationStatus(user.id);
      const resolved = Boolean(snapshot.isVerified);
      setUser((current) => {
        if (!current || current.id !== user.id) return current;
        if (current.isVerified === resolved) return current;
        return { ...current, isVerified: resolved };
      });
      return resolved;
    } catch {
      return Boolean(user.isVerified);
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id || user.isVerified) return;
    const timer = window.setInterval(() => {
      void refreshVerificationStatus();
    }, VERIFICATION_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshVerificationStatus, user?.id, user?.isVerified]);

  const login = (_role?: UserRole) => {
    window.location.assign("/auth?mode=login");
  };

  const signIn = async (payload: SignInPayload): Promise<void> => {
    if (!supabase) {
      throw new Error(
        "Supabase auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
      );
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: payload.email.trim(),
        password: payload.password,
      });

      if (error) {
        throw new Error(formatAuthError(error));
      }
      const accessToken = String(data.session?.access_token ?? "").trim();
      if (!accessToken) {
        throw new Error("Session token was not returned.");
      }

      const profile = await fetchAuthProfile(accessToken);
      setUser(profile);
      toast({
        title: "Welcome back",
        description: "You are now signed in.",
      });
    } catch (error) {
      throw new Error(formatAuthError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (payload: SignUpPayload): Promise<boolean> => {
    if (!supabase) {
      throw new Error(
        "Supabase auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
      );
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: payload.email.trim(),
        password: payload.password,
        options: {
          data: {
            full_name: payload.name.trim(),
            role: normalizeRole(payload.role),
            ...(payload.gender ? { gender: payload.gender } : {}),
          },
        },
      });

      if (error) {
        throw new Error(formatAuthError(error));
      }

      const accessToken = String(data.session?.access_token ?? "").trim();
      if (!accessToken) {
        toast({
          title: "Check your inbox",
          description:
            "Your account was created. Complete email confirmation, then log in to continue.",
        });
        return false;
      }

      const profile = await fetchAuthProfile(accessToken);
      setUser(profile);
      toast({
        title: "Account created",
        description: "Your account is ready. Next, verify your email code to continue.",
      });
      return true;
    } catch (error) {
      throw new Error(formatAuthError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    toast({ title: "Logged out" });
  };

  const verifyIdentity = async (
    options?: { verificationId?: string },
  ): Promise<boolean> => {
    if (!user) return false;

    setIsLoading(true);
    try {
      const verification = await submitVerification({
        mode: "biometric",
        userId: user.id,
        verificationId: options?.verificationId,
        country: "NG",
        firstName: user.name.split(" ")[0],
        lastName: user.name.split(" ").slice(1).join(" ") || "User",
      });

      let isApproved = verification.status === "approved";
      if (!isApproved) {
        isApproved = await refreshVerificationStatus();
      } else {
        setUser((current) => (current ? { ...current, isVerified: true } : current));
      }

      toast({
        title: isApproved ? "Identity Verified" : "Identity Verification Submitted",
        description: isApproved
          ? "You now have full access to Justice City."
          : "Verification is pending review. Status will update automatically.",
        className: isApproved ? "bg-green-600 text-white border-none" : undefined,
      });

      return isApproved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed.";
      toast({
        title: "Verification Failed",
        description: message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfileAvatar = async (file: File): Promise<void> => {
    if (!user) {
      throw new Error("You must be logged in to update your profile photo.");
    }
    if (!file.type.toLowerCase().startsWith("image/")) {
      throw new Error("Please upload a valid image file (JPG, PNG, or WEBP).");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Profile photo must be 5MB or smaller.");
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("Missing auth session. Please sign in again.");
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Failed to read selected image."));
          return;
        }
        resolve(reader.result);
      };
      reader.onerror = () => reject(new Error("Failed to read selected image."));
      reader.readAsDataURL(file);
    });

    const response = await apiRequest(
      "PATCH",
      "/api/auth/profile",
      { avatarUrl: dataUrl },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const payload = (await response.json()) as {
      id: string;
      name?: string;
      email?: string;
      role?: string;
      isVerified?: boolean;
      emailVerified?: boolean;
      phoneVerified?: boolean;
      avatar?: string;
    };
    setUser(toAppUser(payload));

    toast({
      title: "Profile photo updated",
      description: "Your new profile photo is now active across your account.",
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        signIn,
        signUp,
        logout,
        verifyIdentity,
        updateProfileAvatar,
      }}
    >
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
