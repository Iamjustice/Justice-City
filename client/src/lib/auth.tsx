import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { fetchVerificationStatus, submitVerification } from "@/lib/verification";

type UserRole = "buyer" | "seller" | "agent" | "owner" | "renter" | "admin" | null;

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (role?: UserRole) => void;
  logout: () => void;
  verifyIdentity: () => Promise<boolean>;
  updateProfileAvatar: (file: File) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const USER_STORAGE_KEY = "justice_city_user";
const VERIFICATION_POLL_INTERVAL_MS = 8000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(USER_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const persistUser = useCallback((nextUser: User | null) => {
    if (nextUser) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
    setUser(nextUser);
  }, []);

  const refreshVerificationStatus = useCallback(
    async (targetUser: User): Promise<boolean> => {
      try {
        const snapshot = await fetchVerificationStatus(targetUser.id);
        const resolvedIsVerified = Boolean(snapshot.isVerified) || targetUser.role === "admin";

        setUser((current) => {
          if (!current || current.id !== targetUser.id) return current;
          if (current.isVerified === resolvedIsVerified) return current;
          const updated = { ...current, isVerified: resolvedIsVerified };
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });

        return resolvedIsVerified;
      } catch {
        return Boolean(targetUser.isVerified);
      }
    },
    [],
  );

  useEffect(() => {
    if (!user?.id) return;
    void refreshVerificationStatus(user);
  }, [user?.id, refreshVerificationStatus]);

  useEffect(() => {
    if (!user?.id || user.isVerified) return;
    const timer = window.setInterval(() => {
      void refreshVerificationStatus(user);
    }, VERIFICATION_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [user?.id, user?.isVerified, refreshVerificationStatus, user]);

  const login = (role: UserRole = "buyer") => {
    setIsLoading(true);
    const resolvedRole = role ?? "buyer";
    const idByRole: Record<Exclude<UserRole, null>, string> = {
      buyer: "usr_buyer_001",
      seller: "usr_seller_001",
      agent: "usr_agent_001",
      owner: "usr_owner_001",
      renter: "usr_renter_001",
      admin: "usr_admin_001",
    };
    const nameByRole: Record<Exclude<UserRole, null>, string> = {
      buyer: "Alex Doe",
      seller: "Seller Stella",
      agent: "Agent Alex",
      owner: "Owner Olivia",
      renter: "Renter Ryan",
      admin: "Justice Admin",
    };

    const userData = {
      id: idByRole[resolvedRole],
      name: nameByRole[resolvedRole],
      email: `${resolvedRole}@example.com`,
      role: resolvedRole,
      isVerified: resolvedRole === "admin",
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${resolvedRole}`,
    };

    persistUser(userData);
    setIsLoading(false);
    void refreshVerificationStatus(userData);

    toast({
      title: "Welcome back",
      description:
        resolvedRole === "admin"
          ? "Admin session is active."
          : "Session started. Verification status will sync from backend.",
    });
  };

  const logout = () => {
    persistUser(null);
    toast({
      title: "Logged out",
    });
  };

  const verifyIdentity = async (): Promise<boolean> => {
    if (!user) return false;

    setIsLoading(true);

    try {
      const verification = await submitVerification({
        mode: "biometric",
        userId: user.id,
        country: "NG",
        firstName: user.name.split(" ")[0],
        lastName: user.name.split(" ").slice(1).join(" ") || "User",
      });

      let isApproved = verification.status === "approved";
      if (isApproved) {
        const updatedUser = { ...user, isVerified: true };
        persistUser(updatedUser);
      } else {
        isApproved = await refreshVerificationStatus(user);
      }

      toast({
        title: isApproved ? "Identity Verified" : "Identity Verification Submitted",
        description: isApproved
          ? "You now have full access to Justice City."
          : "Your Smile ID check is pending. We are polling backend status and will unlock access once approved.",
        variant: "default",
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

    return false;
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

    const updatedUser = { ...user, avatar: dataUrl };
    persistUser(updatedUser);

    toast({
      title: "Profile photo updated",
      description: "Your new profile photo is now active across your account.",
    });
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, verifyIdentity, updateProfileAvatar }}
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
