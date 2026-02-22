import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Upload, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  VerificationApiError,
  fetchVerificationStatus,
  getSmileLinkFallbackUrl,
  sendEmailOtp,
  sendEmailVerificationLink,
  sendPhoneOtp,
  uploadVerificationDocument,
  verifyEmailOtp,
  verifyPhoneOtp,
} from "@/lib/verification";
import { useToast } from "@/hooks/use-toast";
import BrandLogo from "@/components/brand-logo";

export default function VerificationPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [otpMethod, setOtpMethod] = useState<"sms" | "email">("email");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [verifyBlockedSec, setVerifyBlockedSec] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<File | null>(null);
  const [utilityBillDocument, setUtilityBillDocument] = useState<File | null>(null);
  const [homeAddress, setHomeAddress] = useState("");
  const [officeAddress, setOfficeAddress] = useState("");
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [verificationId, setVerificationId] = useState("");
  const [isStatusPolling, setIsStatusPolling] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [hasSubmittedBiometric, setHasSubmittedBiometric] = useState(false);
  const hasRedirectedRef = useRef(false);
  const { verifyIdentity, refreshUserProfile, isLoading, user } = useAuth();
  const { toast } = useToast();
  const emailVerificationRequired = Boolean(user && !user.emailVerified);
  const phoneVerificationRequired = Boolean(user && !user.phoneVerified);
  const contactVerificationRequired = emailVerificationRequired || phoneVerificationRequired;
  const canChooseOtpMethod = emailVerificationRequired && phoneVerificationRequired;

  const normalizePhone = (value: string): string => value.replace(/\s+/g, "").trim();
  const normalizeEmail = (value: string): string => value.trim().toLowerCase();
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Failed to read selected document."));
          return;
        }
        resolve(reader.result);
      };
      reader.onerror = () => reject(new Error("Failed to read selected document."));
      reader.readAsDataURL(file);
    });

  useEffect(() => {
    if (!user?.email) return;
    setEmail((current) => (current.trim() ? current : user.email));
  }, [user?.email]);

  useEffect(() => {
    if (emailVerificationRequired) {
      setOtpMethod("email");
      return;
    }
    if (phoneVerificationRequired) {
      setOtpMethod("sms");
    }
  }, [emailVerificationRequired, phoneVerificationRequired]);

  useEffect(() => {
    if (resendCooldownSec <= 0 && verifyBlockedSec <= 0) return;

    const timer = window.setInterval(() => {
      setResendCooldownSec((current) => (current > 0 ? current - 1 : 0));
      setVerifyBlockedSec((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldownSec, verifyBlockedSec]);

  const checkVerificationStatus = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!user?.id) return false;
      if (options?.manual) {
        setIsStatusPolling(true);
      }

      try {
        const snapshot = await fetchVerificationStatus(user.id);
        const identityApproved = snapshot.isVerified || snapshot.latestStatus === "approved";
        const needsEmailVerification = Boolean(user && !user.emailVerified);
        const needsPhoneVerification = Boolean(user && !user.phoneVerified);
        const needsContactVerification = needsEmailVerification || needsPhoneVerification;
        const pendingContactLabel =
          needsEmailVerification && needsPhoneVerification
            ? "email and phone"
            : needsEmailVerification
              ? "email"
              : "phone";
        const biometricSubmissionPending =
          snapshot.latestStatus === "pending" &&
          (snapshot.latestProvider === "smile-id" || Boolean(snapshot.latestSmileJobId));
        const prefillPending = snapshot.latestStatus === "pending" && !biometricSubmissionPending;

        if (needsContactVerification) {
          setStep(1);
          setHasSubmittedBiometric(biometricSubmissionPending);

          if (biometricSubmissionPending) {
            setStatusMessage(
              `Identity check is in progress. Verify your ${pendingContactLabel} while Smile ID review continues.`,
            );
            if (options?.manual) {
              toast({
                title: "Identity still processing",
                description: `Contact verification is still required. Complete your ${pendingContactLabel} verification to continue.`,
              });
            }
          } else if (prefillPending) {
            setStatusMessage(
              `Document captured. Verify your ${pendingContactLabel}, then start biometric liveness scan.`,
            );
          } else if (identityApproved) {
            setStatusMessage(`Identity check is complete. Verify your ${pendingContactLabel} to continue.`);
          } else if (snapshot.latestStatus === "failed") {
            setStatusMessage(`Verify your ${pendingContactLabel} first, then retry facial capture if required.`);
          } else {
            setStatusMessage("");
          }
          return false;
        }

        if (identityApproved && user?.emailVerified && user?.phoneVerified) {
          if (!hasRedirectedRef.current) {
            hasRedirectedRef.current = true;
            toast({
              title: "Verification complete",
              description: "Your identity has been verified successfully.",
            });
            setLocation("/dashboard");
          }
          return true;
        }

        if (snapshot.latestStatus === "pending") {
          setStep(3);
          if (biometricSubmissionPending) {
            setHasSubmittedBiometric(true);
            setStatusMessage("Verification submitted. Waiting for Smile ID confirmation.");
            if (options?.manual) {
              toast({
                title: "Still processing",
                description: "Verification is pending review. Please check again shortly.",
              });
            }
          } else {
            setHasSubmittedBiometric(false);
            setStatusMessage("Document uploaded. Start biometric liveness scan to continue.");
            if (options?.manual) {
              toast({
                title: "Biometric scan required",
                description: "Your document is saved. Tap Start Scan to continue verification.",
              });
            }
          }
        } else if (snapshot.latestStatus === "failed") {
          setHasSubmittedBiometric(false);
          setStep(3);
          setStatusMessage(
            snapshot.latestMessage?.trim() ||
              "Verification was not approved. Please retry facial capture.",
          );
          if (options?.manual) {
            toast({
              title: "Verification not approved",
              description:
                snapshot.latestMessage?.trim() ||
                "Please retry facial capture and submit again.",
              variant: "destructive",
            });
          }
        } else {
          setHasSubmittedBiometric(false);
          setStatusMessage("");
          setStep(2);
        }

        return false;
      } catch (error) {
        if (options?.manual) {
          const message =
            error instanceof Error ? error.message : "Unable to check verification status.";
          toast({
            title: "Status check failed",
            description: message,
            variant: "destructive",
          });
        }
        return false;
      } finally {
        if (options?.manual) {
          setIsStatusPolling(false);
        }
      }
    },
    [setLocation, toast, user?.emailVerified, user?.id, user?.phoneVerified],
  );

  useEffect(() => {
    if (isLoading) return;

    if (!user?.id) {
      setLocation("/auth?mode=login");
      return;
    }

    if (user.isVerified && user.emailVerified && user.phoneVerified && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      setLocation("/dashboard");
      return;
    }

    void checkVerificationStatus();
    const timer = window.setInterval(() => {
      void checkVerificationStatus();
    }, 8000);

    return () => window.clearInterval(timer);
  }, [checkVerificationStatus, isLoading, setLocation, user?.id, user?.isVerified]);

  const resetOtpState = () => {
    setOtpSent(false);
    setOtpCode("");
    setResendCooldownSec(0);
    setVerifyBlockedSec(0);
    setAttemptsRemaining(null);
  };

  const handleSendCode = async () => {
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);
    if (otpMethod === "sms") {
      if (!normalizedPhone) {
        toast({
          title: "Phone number required",
          description: "Enter your phone number in international format, e.g. +2349012345678.",
          variant: "destructive",
        });
        return;
      }

      if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
        toast({
          title: "Invalid phone format",
          description: "Use E.164 format, e.g. +2349012345678.",
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!normalizedEmail) {
        toast({
          title: "Email required",
          description: "Enter the email address you want to verify.",
          variant: "destructive",
        });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        toast({
          title: "Invalid email",
          description: "Enter a valid email address.",
          variant: "destructive",
        });
        return;
      }
    }

    if (resendCooldownSec > 0) {
      toast({
        title: "Please wait",
        description: `You can request another code in ${resendCooldownSec}s.`,
      });
      return;
    }

    setIsSendingCode(true);
    try {
      const result =
        otpMethod === "sms"
          ? await sendPhoneOtp(normalizedPhone)
          : await sendEmailOtp(normalizedEmail);

      setOtpSent(true);
      setAttemptsRemaining(null);
      setVerifyBlockedSec(0);
      setResendCooldownSec(
        typeof result.cooldownSec === "number" && result.cooldownSec > 0 ? result.cooldownSec : 60,
      );
      toast({
        title: "Code sent",
        description:
          otpMethod === "sms"
            ? "Enter the SMS code to continue."
            : "Enter the email code to continue.",
      });
    } catch (error) {
      if (error instanceof VerificationApiError && typeof error.retryAfterSec === "number") {
        setResendCooldownSec(Math.max(0, error.retryAfterSec));
      }
      const message = error instanceof Error ? error.message : "Failed to send OTP code.";
      toast({
        title: "OTP send failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);
    const token = otpCode.trim();

    if (otpMethod === "sms") {
      if (!normalizedPhone) {
        toast({
          title: "Phone number required",
          description: "Enter your phone number in international format, e.g. +2349012345678.",
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!normalizedEmail) {
        toast({
          title: "Email required",
          description: "Enter the email address you want to verify.",
          variant: "destructive",
        });
        return;
      }
    }

    if (!token) {
      toast({
        title: "Code required",
        description:
          otpMethod === "sms"
            ? "Enter the OTP code sent to your phone."
            : "Enter the OTP code sent to your email.",
        variant: "destructive",
      });
      return;
    }

    if (verifyBlockedSec > 0) {
      toast({
        title: "Too many attempts",
        description: `Please wait ${verifyBlockedSec}s before trying another code.`,
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingCode(true);
    try {
      const result =
        otpMethod === "sms"
          ? await verifyPhoneOtp(normalizedPhone, token, user?.id)
          : await verifyEmailOtp(normalizedEmail, token, user?.id);
      if (!result.valid) {
        const remaining = typeof result.attemptsRemaining === "number" ? result.attemptsRemaining : null;
        setAttemptsRemaining(remaining);
        toast({
          title: "Invalid code",
          description:
            remaining !== null
              ? `${result.message ?? "Invalid or expired code."} Attempts left: ${remaining}.`
              : (result.message ?? "Invalid or expired code."),
          variant: "destructive",
        });
        return;
      }

      setAttemptsRemaining(null);
      setVerifyBlockedSec(0);
      resetOtpState();
      await refreshUserProfile();

      const nextEmailVerified = Boolean(user?.emailVerified) || otpMethod === "email";
      const nextPhoneVerified = Boolean(user?.phoneVerified) || otpMethod === "sms";

      if (!nextEmailVerified || !nextPhoneVerified) {
        setStep(1);
        if (!nextEmailVerified) {
          setOtpMethod("email");
          setStatusMessage("Phone verified. Now verify your email address to continue.");
        } else {
          setOtpMethod("sms");
          setStatusMessage("Email verified. Now verify your phone number to continue.");
        }
        return;
      }

      setStatusMessage("");
      setStep(2);
      toast({
        title: "Contacts verified",
        description: "Email and phone are verified. Proceed to upload your identity document.",
      });
    } catch (error) {
      if (error instanceof VerificationApiError) {
        if (typeof error.retryAfterSec === "number") {
          setVerifyBlockedSec(Math.max(0, error.retryAfterSec));
        }
        if (typeof error.attemptsRemaining === "number") {
          setAttemptsRemaining(error.attemptsRemaining);
        }
      }
      const message = error instanceof Error ? error.message : "Invalid or expired OTP code.";
      toast({
        title: "OTP verification failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleSendVerificationLink = async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      toast({
        title: "Email required",
        description: "Enter the email address you want to verify.",
        variant: "destructive",
      });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast({
        title: "Invalid email",
        description: "Enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingLink(true);
    try {
      await sendEmailVerificationLink(normalizedEmail);
      toast({
        title: "Verification link sent",
        description: "Check your inbox and click the email link to verify your address.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send verification link.";
      toast({
        title: "Link send failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSendingLink(false);
    }
  };

  const handleContinueToBiometric = async () => {
    if (!homeAddress.trim()) {
      toast({
        title: "Home address required",
        description: "Enter your current residential address before continuing.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedDocument) {
      toast({
        title: "Upload required",
        description: "Please choose your ID document before continuing.",
        variant: "destructive",
      });
      return;
    }
    if (!utilityBillDocument) {
      toast({
        title: "Utility bill required",
        description: "Upload a recent utility bill before continuing.",
        variant: "destructive",
      });
      return;
    }
    if (!user?.id) {
      toast({
        title: "Session required",
        description: "Please sign in again before uploading your document.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingDocument(true);
    try {
      const normalizedHomeAddress = homeAddress.trim();
      const normalizedOfficeAddress = officeAddress.trim();
      const identityContentBase64 = await readFileAsDataUrl(selectedDocument);
      const utilityBillContentBase64 = await readFileAsDataUrl(utilityBillDocument);

      const uploadedIdentity = await uploadVerificationDocument({
        userId: user.id,
        documentType: "identity",
        fileName: selectedDocument.name,
        mimeType: selectedDocument.type || undefined,
        fileSizeBytes: selectedDocument.size,
        contentBase64: identityContentBase64,
        verificationId: verificationId || undefined,
        homeAddress: normalizedHomeAddress,
        officeAddress: normalizedOfficeAddress || undefined,
      });

      const uploadedUtilityBill = await uploadVerificationDocument({
        userId: user.id,
        documentType: "utility_bill",
        fileName: utilityBillDocument.name,
        mimeType: utilityBillDocument.type || undefined,
        fileSizeBytes: utilityBillDocument.size,
        contentBase64: utilityBillContentBase64,
        verificationId: uploadedIdentity.verificationId || verificationId || undefined,
        homeAddress: normalizedHomeAddress,
        officeAddress: normalizedOfficeAddress || undefined,
      });

      setVerificationId(uploadedUtilityBill.verificationId || uploadedIdentity.verificationId);
      setStep(3);
      toast({
        title: "Documents captured",
        description: "ID and utility bill uploaded securely. Continue with biometric scan.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload verification document.";
      toast({
        title: "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSavingDocument(false);
    }
  };

  const handleStartScan = async () => {
    if (hasSubmittedBiometric) {
      await checkVerificationStatus({ manual: true });
      return;
    }

    try {
      const isApproved = await verifyIdentity({
        verificationId: verificationId || undefined,
      });
      if (isApproved) {
        hasRedirectedRef.current = true;
        setLocation("/dashboard");
        return;
      }

      setHasSubmittedBiometric(true);
      setStatusMessage("Verification submitted. Waiting for Smile ID confirmation.");
    } catch {
      const fallbackUrl = getSmileLinkFallbackUrl();
      if (!fallbackUrl) {
        setHasSubmittedBiometric(false);
        setStatusMessage("Could not start biometric liveness check. Please retry.");
        return;
      }

      toast({
        title: "Redirecting to Smile Link",
        description: "Live verification will continue in the secure hosted Smile flow.",
      });
      window.location.assign(fallbackUrl);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4 bg-slate-50/50">
      <Card className="w-full max-w-2xl shadow-xl border-slate-200">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <BrandLogo className="h-8 w-auto max-w-[180px]" />
          </div>
          <CardTitle className="text-2xl font-display font-bold">Identity Verification</CardTitle>
          <CardDescription>Complete these steps to become a verified member</CardDescription>
          
          {/* Progress Bar */}
          <div className="flex items-center justify-between mt-8 relative max-w-sm mx-auto">
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 -translate-y-1/2"></div>
            {[1, 2, 3].map((s) => (
              <div 
                key={s} 
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  s <= step ? "bg-blue-600 text-white" : "bg-white text-slate-400 border-2 border-slate-200"
                }`}
              >
                {s < step ? <CheckCircle2 className="w-5 h-5" /> : s}
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="py-8">
          {step === 1 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  {contactVerificationRequired
                    ? canChooseOtpMethod
                      ? "Step 1: Verify Email and Phone"
                      : emailVerificationRequired
                        ? "Step 1: Verify Your Email"
                        : "Step 1: Verify Your Phone"
                    : "Step 1: Contact Verification"}
                </h3>
                <p className="text-slate-500 text-sm">
                  {contactVerificationRequired
                    ? canChooseOtpMethod
                      ? "Both email and phone verification are required before identity approval."
                      : emailVerificationRequired
                        ? "Email verification is required before you can continue."
                        : "Phone verification is required before you can continue."
                    : "Choose SMS or Email OTP to continue"}
                </p>
                {statusMessage ? (
                  <p className="text-xs text-slate-500">{statusMessage}</p>
                ) : null}
              </div>
              <div className="max-w-xs mx-auto space-y-4">
                {canChooseOtpMethod ? (
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                    <Button
                      type="button"
                      variant={otpMethod === "sms" ? "default" : "ghost"}
                      className={otpMethod === "sms" ? "bg-blue-600 hover:bg-blue-700" : ""}
                      onClick={() => {
                        setOtpMethod("sms");
                        resetOtpState();
                      }}
                    >
                      SMS OTP
                    </Button>
                    <Button
                      type="button"
                      variant={otpMethod === "email" ? "default" : "ghost"}
                      className={otpMethod === "email" ? "bg-blue-600 hover:bg-blue-700" : ""}
                      onClick={() => {
                        setOtpMethod("email");
                        resetOtpState();
                      }}
                    >
                      Email OTP
                    </Button>
                  </div>
                ) : null}
                {otpMethod === "sms" ? (
                  <div className="space-y-2 text-left">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      placeholder="+2349012345678"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </div>
                ) : (
                  <div className="space-y-2 text-left">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                )}
                {!otpSent ? (
                  <div className="space-y-2">
                    <Button
                      onClick={handleSendCode}
                      className="w-full bg-blue-600"
                      disabled={isSendingCode || resendCooldownSec > 0}
                    >
                      {isSendingCode
                        ? "Sending..."
                        : resendCooldownSec > 0
                          ? `Send Code (${resendCooldownSec}s)`
                          : otpMethod === "email"
                            ? "Send Email Code"
                            : "Send SMS Code"}
                    </Button>
                    {otpMethod === "email" ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={handleSendVerificationLink}
                        disabled={isSendingLink}
                      >
                        {isSendingLink ? "Sending link..." : "Send Verification Link"}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 text-left">
                      <Label htmlFor="otp-code">Verification Code</Label>
                      <Input
                        id="otp-code"
                        placeholder="Enter 6-digit code"
                        inputMode="numeric"
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value)}
                      />
                    </div>
                    <Button
                      onClick={handleVerifyCode}
                      className="w-full bg-blue-600"
                      disabled={isVerifyingCode || verifyBlockedSec > 0}
                    >
                      {isVerifyingCode
                        ? "Verifying..."
                        : verifyBlockedSec > 0
                          ? `Verify Code (${verifyBlockedSec}s)`
                          : "Verify Code"}
                    </Button>
                    {attemptsRemaining !== null ? (
                      <p className="text-xs text-amber-700 text-left">
                        Attempts remaining: {attemptsRemaining}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full"
                      onClick={handleSendCode}
                      disabled={isSendingCode || resendCooldownSec > 0}
                    >
                      {resendCooldownSec > 0 ? `Resend Code (${resendCooldownSec}s)` : "Resend Code"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 2: Address + Document Upload</h3>
                <p className="text-slate-500 text-sm">
                  Enter your address, upload your government ID, and upload a recent utility bill.
                </p>
              </div>
              <div className="grid gap-4 text-left">
                <div className="space-y-2">
                  <Label htmlFor="home-address">Home Address</Label>
                  <Input
                    id="home-address"
                    placeholder="Street, area, city, state"
                    value={homeAddress}
                    onChange={(event) => setHomeAddress(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="office-address">Office Address (Optional)</Label>
                  <Input
                    id="office-address"
                    placeholder="Office street, area, city, state"
                    value={officeAddress}
                    onChange={(event) => setOfficeAddress(event.target.value)}
                  />
                </div>
              </div>
              <label
                htmlFor="verification-document"
                className="block border-2 border-dashed border-slate-200 rounded-2xl p-8 hover:border-blue-400 transition-colors cursor-pointer group"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-7 h-7 text-blue-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-900">Upload Government ID</p>
                    <p className="text-xs text-slate-500">Passport, Driver's License, National ID (max. 10MB)</p>
                    {selectedDocument ? (
                      <p className="text-xs text-green-700 font-medium">Selected: {selectedDocument.name}</p>
                    ) : null}
                  </div>
                </div>
                <input
                  id="verification-document"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedDocument(file);
                  }}
                />
              </label>
              <label
                htmlFor="verification-utility-bill"
                className="block border-2 border-dashed border-slate-200 rounded-2xl p-8 hover:border-blue-400 transition-colors cursor-pointer group"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-7 h-7 text-blue-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-900">Upload Utility Bill</p>
                    <p className="text-xs text-slate-500">Electricity, Water, Waste, or similar (max. 10MB)</p>
                    {utilityBillDocument ? (
                      <p className="text-xs text-green-700 font-medium">Selected: {utilityBillDocument.name}</p>
                    ) : null}
                  </div>
                </div>
                <input
                  id="verification-utility-bill"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setUtilityBillDocument(file);
                  }}
                />
              </label>
              <Button
                onClick={handleContinueToBiometric}
                className="w-full bg-blue-600"
                disabled={!homeAddress.trim() || !selectedDocument || !utilityBillDocument || isSavingDocument}
              >
                {isSavingDocument ? "Saving..." : "Continue"}
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Step 3: Biometric Liveness Check</h3>
                <p className="text-slate-500 text-sm">Position your face within the frame to confirm identity</p>
              </div>
              <div className="w-64 h-64 rounded-full mx-auto border-4 border-blue-200 bg-white/80 shadow-inner flex items-center justify-center">
                <div className="w-44 h-44 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center px-6">
                  <BrandLogo className="h-12 w-auto max-w-[160px]" />
                </div>
              </div>
              {statusMessage ? (
                <p className="text-sm text-slate-500">{statusMessage}</p>
              ) : null}
              <Button
                onClick={handleStartScan}
                className="w-full bg-blue-600"
                disabled={isLoading || isStatusPolling}
              >
                {isLoading
                  ? "Submitting to Smile ID..."
                  : isStatusPolling
                    ? "Checking Status..."
                    : hasSubmittedBiometric
                      ? "Refresh Verification Status"
                      : "Start Scan"}
              </Button>
              {contactVerificationRequired ? (
                <Button type="button" variant="outline" className="w-full" onClick={() => setStep(1)}>
                  Go to Contact Verification
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
        
        <CardFooter className="justify-center border-t bg-slate-50/50 py-4">
          <p className="text-xs text-slate-500 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            Your data is encrypted and handled securely according to our Privacy Policy
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
