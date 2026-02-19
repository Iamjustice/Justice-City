import { useRef, useState, type ChangeEvent } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Mail, Phone, MapPin, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function ProfilePage() {
  const { user, updateProfileAvatar } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!user) return <div className="p-20 text-center">Please log in to view profile.</div>;

  const emailVerified = Boolean(user.emailVerified);
  const phoneVerified = Boolean(user.phoneVerified);

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setIsUploadingAvatar(true);
    try {
      await updateProfileAvatar(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update profile photo.";
      toast({
        title: "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleOpenVerification = () => {
    setLocation("/verify");
    toast({
      title: "Continue verification",
      description: "Finish email and identity verification to unlock dashboard access.",
    });
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Card className="md:col-span-1">
          <CardContent className="pt-8 text-center">
            <Avatar className="w-32 h-32 mx-auto mb-4 border-4 border-white shadow-xl">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="text-4xl">{user.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <h2 className="text-2xl font-bold text-slate-900">{user.name}</h2>
            <p className="text-slate-500 capitalize mb-4">{user.role}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <Button
              variant="outline"
              className="mb-4"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
            >
              {isUploadingAvatar ? "Uploading..." : "Change Profile Photo"}
            </Button>
            {user.isVerified && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-sm font-semibold">
                <ShieldCheck className="w-4 h-4" />
                Verified
              </div>
            )}
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Trust and safety notice: upload a clear, recent photo of yourself. Accounts
                  without a valid personal profile photo may be restricted and can be suspended
                  after compliance review.
                </p>
              </div>
              <p className="text-[11px] text-amber-700 mt-2">
                Accepted: JPG, PNG, WEBP. Maximum file size: 5MB.
              </p>
            </div>
            <div className="mt-8 pt-8 border-t border-slate-100 space-y-4 text-left">
              <div className="flex items-center justify-between gap-3 text-slate-600">
                <div className="min-w-0 flex items-center gap-3">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span className="text-sm truncate">{user.email}</span>
                </div>
                {emailVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Verified
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={handleOpenVerification}>
                    Verify
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 text-slate-600">
                <div className="min-w-0 flex items-center gap-3">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span className="text-sm truncate">+234 (0) 906 534 0189</span>
                </div>
                {phoneVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Verified
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Unverified</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <MapPin className="w-4 h-4" />
                <span className="text-sm">Owerri, Nigeria</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-sm text-slate-500 font-medium">Full Name</p>
                  <p className="text-slate-900 font-semibold">{user.name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-slate-500 font-medium">Nickname</p>
                  <p className="text-slate-900 font-semibold">J-City Pioneer</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-slate-500 font-medium">Gender</p>
                  <p className="text-slate-900 font-semibold">Not Specified</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-slate-500 font-medium">Date of Birth</p>
                  <p className="text-slate-900 font-semibold">January 15, 1995</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="p-4 bg-slate-50 rounded-2xl">
                  <p className="text-sm text-slate-500 mb-1">Account Created</p>
                  <p className="font-semibold text-slate-900">Jan 12, 2026</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl">
                  <p className="text-sm text-slate-500 mb-1">Verification Level</p>
                  <p className="font-semibold text-slate-900">Level 2 (Full)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {[
                  { action: "Viewed Property", target: "Luxury Villa in Lekki", time: "2 hours ago" },
                  { action: "Saved Property", target: "Modern Flat Owerri", time: "1 day ago" },
                  { action: "Profile Updated", target: "Photo change", time: "3 days ago" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div>
                      <p className="font-medium text-slate-900">{item.action}</p>
                      <p className="text-sm text-slate-500">{item.target}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
