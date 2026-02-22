import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { fetchVerificationStatus, submitVerification } from "@/lib/verification";
import { apiRequest } from "@/lib/queryClient";
import { getSupabaseClient } from "@/lib/supabase";

type UserRole = "buyer" | "seller" | "agent" | "owner" | "renter" | "admin" | null;

interface User {
  id: string;
  name: string;
  nickname?: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  phone?: string;
  gender?: "male" | "female";
  dateOfBirth?: string;
  homeAddress?: string;
  officeAddress?: string;
  avatar?: string;
}

interface SignInPayload {
  email: string;
  password: string;
}

interface SignUpPayload extends SignInPayload {
  name: string;
  role: "buyer" | "seller" | "agent" | "owner" | "renter";
  gender: "male" | "female";
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (role?: UserRole) => void;
  signIn: (payload: SignInPayload) => Promise<void>;
  signUp: (payload: SignUpPayload) => Promise<boolean>;
  logout: () => Promise<void>;
  verifyIdentity: (options?: { verificationId?: string; dateOfBirth?: string }) => Promise<boolean>;
  refreshUserProfile: () => Promise<void>;
  updateProfileAvatar: (file: File) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const VERIFICATION_POLL_INTERVAL_MS = 8000;
const AUTH_REQUEST_TIMEOUT_MS = 20000;
const PROFILE_SYNC_TIMEOUT_MS = 12000;

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
  const isUsefulMessage = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const normalized = value.trim();
    if (!normalized) return false;

    const lowered = normalized.toLowerCase();
    if (
      lowered === "{}" ||
      lowered === "[]" ||
      lowered === "null" ||
      lowered === "undefined" ||
      lowered === "[object object]"
    ) {
      return false;
    }

    return true;
  };

  const readPayloadMessage = (payload: Record<string, unknown>): string => {
    const nestedError = payload.error;
    const nestedErrorObj =
      nestedError && typeof nestedError === "object" && !Array.isArray(nestedError)
        ? (nestedError as Record<string, unknown>)
        : null;

    const message = String(
      payload.message ??
        payload.error_description ??
        payload.msg ??
        payload.details ??
        payload.error_details ??
        (typeof nestedError === "string" ? nestedError : "") ??
        nestedErrorObj?.message ??
        "",
    ).trim();
    const code = String(payload.code ?? "").trim();
    const status = String(payload.status ?? payload.statusCode ?? "").trim();
    const body = String(
      payload.body ??
        payload.responseText ??
        nestedErrorObj?.details ??
        "",
    ).trim();

    const parts = [message, code ? `code=${code}` : "", status ? `status=${status}` : "", body]
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.join(" | ");
  };

  if (error instanceof Error) {
    const baseMessage = String(error.message ?? "").trim();
    if (isUsefulMessage(baseMessage)) {
      return baseMessage;
    }

    try {
      const parsed = JSON.parse(baseMessage);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const extracted = readPayloadMessage(parsed as Record<string, unknown>);
        if (isUsefulMessage(extracted)) {
          return extracted;
        }
      }
    } catch {
      // Keep falling back to object-field extraction.
    }
  }

  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const extracted = readPayloadMessage(payload);
    if (isUsefulMessage(extracted)) return extracted;
  }

  return "Authentication failed. Please try again.";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function toAppUser(payload: {
  id: string;
  name?: string;
  nickname?: string;
  email?: string;
  role?: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  phone?: string;
  gender?: string;
  dateOfBirth?: string;
  homeAddress?: string;
  officeAddress?: string;
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
    nickname: String(payload.nickname ?? "").trim() || undefined,
    email,
    role: normalizeRole(payload.role ?? "buyer", { allowAdmin: true }),
    isVerified: Boolean(payload.isVerified),
    emailVerified: Boolean(payload.emailVerified),
    phoneVerified: Boolean(payload.phoneVerified),
    phone: String(payload.phone ?? "").trim() || undefined,
    gender:
      String(payload.gender ?? "").trim().toLowerCase() === "male" ||
      String(payload.gender ?? "").trim().toLowerCase() === "female"
        ? (String(payload.gender ?? "").trim().toLowerCase() as "male" | "female")
        : undefined,
    dateOfBirth: String(payload.dateOfBirth ?? "").trim() || undefined,
    homeAddress: String(payload.homeAddress ?? "").trim() || undefined,
    officeAddress: String(payload.officeAddress ?? "").trim() || undefined,
    avatar: String(payload.avatar ?? "").trim() || undefined,
  };
}

function toFallbackUserFromAuthUser(
  authUser: {
    id?: string | null;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
  } | null | undefined,
  options?: { fallbackName?: string; fallbackRole?: string },
): User | null {
  const userId = String(authUser?.id ?? "").trim();
  if (!userId) return null;

  const metadata = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
  const email = String(authUser?.email ?? "").trim();
  const name =
    String(metadata.full_name ?? metadata.name ?? options?.fallbackName ?? "").trim() ||
    email.split("@")[0] ||
    "User";
  const avatar =
    String(metadata.avatar_url ?? metadata.picture ?? "").trim() || undefined;
  const nickname =
    String(metadata.nickname ?? metadata.username ?? "").trim() || undefined;
  const role = normalizeRole(metadata.role ?? options?.fallbackRole ?? "buyer", {
    allowAdmin: true,
  });
  const emailVerified = Boolean(
    String(authUser?.email_confirmed_at ?? authUser?.confirmed_at ?? "").trim(),
  );

  return toAppUser({
    id: userId,
    name,
    nickname,
    email,
    role,
    avatar,
    emailVerified,
    isVerified: false,
    phoneVerified: false,
  });
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
        nickname?: string;
        email?: string;
        role?: string;
        isVerified?: boolean;
        emailVerified?: boolean;
        phoneVerified?: boolean;
        phone?: string;
        gender?: string;
        dateOfBirth?: string;
        homeAddress?: string;
        officeAddress?: string;
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

    try {
      const { data, error } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_REQUEST_TIMEOUT_MS,
        "Session check timed out. Please refresh and try again.",
      );

      if (error || !data.session?.access_token) {
        setUser(null);
        return;
      }

      try {
        const profile = await withTimeout(
          fetchAuthProfile(data.session.access_token),
          PROFILE_SYNC_TIMEOUT_MS,
          "Profile sync timed out.",
        );
        setUser(profile);
      } catch {
        const fallbackUser = toFallbackUserFromAuthUser(data.session.user, {
          fallbackName: data.session.user.email ?? "",
          fallbackRole: "buyer",
        });
        setUser(fallbackUser);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAuthProfile, supabase]);

  const refreshUserProfile = useCallback(async (): Promise<void> => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    try {
      const profile = await fetchAuthProfile(accessToken);
      setUser(profile);
    } catch {
      // Keep the current session state if profile refresh fails transiently.
    }
  }, [fetchAuthProfile, getAccessToken]);

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
        const profile = await withTimeout(
          fetchAuthProfile(session.access_token),
          PROFILE_SYNC_TIMEOUT_MS,
          "Profile sync timed out.",
        );
        if (!active) return;
        setUser(profile);
      } catch {
        if (!active) return;
        const fallbackUser = toFallbackUserFromAuthUser(session.user, {
          fallbackName: session.user.email ?? "",
          fallbackRole: "buyer",
        });
        setUser(fallbackUser);
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
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: payload.email.trim(),
          password: payload.password,
        }),
        AUTH_REQUEST_TIMEOUT_MS,
        "Login request timed out. Please check your connection and try again.",
      );

      if (error) {
        throw new Error(formatAuthError(error));
      }
      const accessToken = String(data.session?.access_token ?? "").trim();
      if (!accessToken) {
        throw new Error("Session token was not returned.");
      }

      try {
        const profile = await withTimeout(
          fetchAuthProfile(accessToken),
          PROFILE_SYNC_TIMEOUT_MS,
          "Login completed but profile sync is taking too long.",
        );
        setUser(profile);
      } catch (profileError) {
        console.error("Sign-in profile sync failed", profileError);
        const fallbackUser = toFallbackUserFromAuthUser(data.user, {
          fallbackName: payload.email.trim(),
          fallbackRole: "buyer",
        });
        if (!fallbackUser) {
          throw profileError;
        }
        setUser(fallbackUser);
      }

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
      const directSupabaseSignUp = async (): Promise<boolean> => {
        const signUpRequest = {
          email: payload.email.trim(),
          password: payload.password,
          options: {
            data: {
              full_name: payload.name.trim(),
              role: normalizeRole(payload.role),
              gender: payload.gender,
            },
          },
        };

        const { data, error } = await withTimeout(
          supabase.auth.signUp(signUpRequest),
          AUTH_REQUEST_TIMEOUT_MS,
          "Sign up request timed out. Please check your connection and try again.",
        );

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

        try {
          const profile = await withTimeout(
            fetchAuthProfile(accessToken),
            PROFILE_SYNC_TIMEOUT_MS,
            "Account created but profile sync is taking too long.",
          );
          setUser(profile);
        } catch (profileError) {
          console.error("Sign-up profile sync failed", profileError);
          const fallbackUser = toFallbackUserFromAuthUser(data.user, {
            fallbackName: payload.name,
            fallbackRole: payload.role,
          });
          if (!fallbackUser) {
            throw profileError;
          }
          setUser(fallbackUser);
        }

        toast({
          title: "Account created",
          description: "Your account is ready. Next, verify your email code to continue.",
        });
        return true;
      };

      let alreadyExists = false;
      try {
        const response = await apiRequest("POST", "/api/auth/signup", {
          name: payload.name.trim(),
          email: payload.email.trim(),
          password: payload.password,
          role: payload.role,
          gender: payload.gender,
        });

        const body = (await response.json()) as
          | { created?: boolean; alreadyExists?: boolean }
          | undefined;
        alreadyExists = Boolean(body?.alreadyExists);
      } catch (serverSignupError) {
        const serverMessage = formatAuthError(serverSignupError);
        const lowered = serverMessage.toLowerCase();
        const shouldFallbackToDirect =
          serverMessage.startsWith("404:") ||
          lowered.includes("not found") ||
          lowered.includes("supabase service client is not configured");
        if (!shouldFallbackToDirect) {
          throw new Error(serverMessage);
        }
        return await directSupabaseSignUp();
      }

      const normalizedEmail = payload.email.trim();
      const { data: loginData, error: loginError } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: payload.password,
        }),
        AUTH_REQUEST_TIMEOUT_MS,
        "Account created but login timed out. Please try logging in now.",
      );

      if (loginError) {
        const loginMessage = formatAuthError(loginError);
        if (alreadyExists && loginMessage.toLowerCase().includes("invalid login")) {
          throw new Error(
            "This email is already registered. Use your existing password or reset password.",
          );
        }
        throw new Error(loginMessage);
      }

      const accessToken = String(loginData.session?.access_token ?? "").trim();
      if (!accessToken) {
        throw new Error("Account created but session token was not returned.");
      }

      try {
        const profile = await withTimeout(
          fetchAuthProfile(accessToken),
          PROFILE_SYNC_TIMEOUT_MS,
          "Account created but profile sync is taking too long.",
        );
        setUser(profile);
      } catch (profileError) {
        console.error("Server-signup profile sync failed", profileError);
        const fallbackUser = toFallbackUserFromAuthUser(loginData.user, {
          fallbackName: payload.name,
          fallbackRole: payload.role,
        });
        if (!fallbackUser) {
          throw profileError;
        }
        setUser(fallbackUser);
      }

      toast({
        title: alreadyExists ? "Welcome back" : "Account created",
        description: alreadyExists
          ? "This email already had an account, so we signed you in."
          : "Your account is ready. Continue to verification to finish onboarding.",
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
    options?: { verificationId?: string; dateOfBirth?: string },
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
        dateOfBirth: options?.dateOfBirth,
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
      phone?: string;
      gender?: string;
      dateOfBirth?: string;
      homeAddress?: string;
      officeAddress?: string;
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
        refreshUserProfile,
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
