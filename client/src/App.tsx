import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import Layout from "@/components/layout";
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
import ChatPage from "@/pages/chat";

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
        <Route path="/messages" component={ChatPage} />
        <Route path="/request-callback" component={RequestCallbackPage} />
        <Route path="/schedule-tour" component={ScheduleTourPage} />
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
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
