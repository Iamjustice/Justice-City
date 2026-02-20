import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import Layout from "@/components/layout";
import DevErrorBoundary from "@/components/dev/dev-error-boundary";
import DevRuntimeOverlay from "@/components/dev/dev-runtime-overlay";
import DevHelperBanner from "@/components/dev/dev-helper-banner";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import PropertyDetails from "@/pages/property-details";
import Dashboard from "@/pages/dashboard";
import Services from "@/pages/services";
import AuthPage from "@/pages/auth";
import VerificationPage from "@/pages/verify";
import ProfilePage from "@/pages/profile";
import RequestCallbackPage from "@/pages/request-callback";
import ScheduleTourPage from "@/pages/schedule-tour";
import PrivacyPolicyPage from "@/pages/privacy-policy";
import TermsOfServicePage from "@/pages/terms-of-service";
import EscrowPolicyPage from "@/pages/escrow-policy";
import HiringPage from "@/pages/hiring";
import ProviderPackagePage from "@/pages/provider-package";

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/verify" component={VerificationPage} />
        <Route path="/property/:id" component={PropertyDetails} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/services" component={Services} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/request-callback" component={RequestCallbackPage} />
        <Route path="/schedule-tour" component={ScheduleTourPage} />
        <Route path="/hiring" component={HiringPage} />
        <Route path="/terms-of-service" component={TermsOfServicePage} />
        <Route path="/privacy-policy" component={PrivacyPolicyPage} />
        <Route path="/escrow-policy" component={EscrowPolicyPage} />
        <Route path="/provider-package/:token" component={ProviderPackagePage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <DevErrorBoundary>
            <Toaster />
            <Router />
            <DevRuntimeOverlay />
            <DevHelperBanner />
          </DevErrorBoundary>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
