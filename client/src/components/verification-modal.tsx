import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ScanFace, FileCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerAction?: string;
}

export function VerificationModal({ isOpen, onClose, triggerAction = "access this feature" }: VerificationModalProps) {
  const [, setLocation] = useLocation();

  const handleVerify = () => {
    onClose();
    setLocation("/verify");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <motion.div
          key="intro"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <DialogHeader>
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <ShieldCheck className="w-6 h-6 text-blue-600" />
            </div>
            <DialogTitle className="text-center text-xl">Identity Verification Required</DialogTitle>
            <DialogDescription className="text-center">
              To {triggerAction}, you must verify your identity. This keeps Justice City safe for everyone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
              <ScanFace className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-sm text-slate-900">Facial Recognition</h4>
                <p className="text-xs text-slate-500">We'll scan your face to match your ID.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
              <FileCheck className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-sm text-slate-900">Government ID</h4>
                <p className="text-xs text-slate-500">Upload your Identity document, Passport, or Driver's License.</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleVerify}>
              Start Verification
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
