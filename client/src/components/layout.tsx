import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { 
  ShieldCheck, 
  ShieldAlert, 
  Menu, 
  X, 
  LayoutDashboard, 
  Home, 
  LogOut,
  User 
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import BrandLogo from "@/components/brand-logo";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, login, logout } = useAuth();
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b bg-white">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <BrandLogo className="group-hover:scale-[1.01] transition-transform" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/" className={cn(
              "text-sm font-medium transition-colors hover:text-blue-600",
              location === "/" ? "text-blue-600" : "text-slate-600"
            )}>
              Marketplace
            </Link>
            <Link href="/services" className={cn(
              "text-sm font-medium transition-colors hover:text-blue-600",
              location === "/services" ? "text-blue-600" : "text-slate-600"
            )}>
              Services
            </Link>
            <Link href="/hiring" className={cn(
              "text-sm font-medium transition-colors hover:text-blue-600",
              location === "/hiring" ? "text-blue-600" : "text-slate-600"
            )}>
              Hiring
            </Link>
          </nav>

          {/* User Actions */}
          <div className="hidden md:flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                {/* Verification Badge */}
                <div className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
                  user.isVerified 
                    ? "bg-green-50 text-green-700 border-green-200" 
                    : "bg-amber-50 text-amber-700 border-amber-200"
                )}>
                  {user.isVerified ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Verified
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Unverified
                    </>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                      <Avatar className="h-9 w-9 border-2 border-white shadow-sm hover:scale-105 transition-transform">
                        <AvatarImage src={user.avatar} alt={user.name} />
                        <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user.name}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="cursor-pointer w-full flex items-center">
                        <User className="mr-2 h-4 w-4" />
                        <span>My Profile</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="cursor-pointer w-full flex items-center">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        <span>Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={logout} className="text-red-600 cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" asChild className="rounded-full hover:bg-slate-100">
                  <Link href="/auth?mode=login">
                    <User className="w-5 h-5 text-slate-600" />
                  </Link>
                </Button>
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            className="md:hidden p-2 text-slate-600 z-50"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 top-16 bg-white z-40 p-4 space-y-6 animate-in slide-in-from-top duration-300">
            <nav className="flex flex-col gap-4">
              <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className={cn(
                "text-lg font-medium p-2 rounded-lg",
                location === "/" ? "bg-blue-50 text-blue-600" : "text-slate-600"
              )}>
                Marketplace
              </Link>
              <Link href="/services" onClick={() => setIsMobileMenuOpen(false)} className={cn(
                "text-lg font-medium p-2 rounded-lg",
                location === "/services" ? "bg-blue-50 text-blue-600" : "text-slate-600"
              )}>
                Services
              </Link>
              <Link href="/hiring" onClick={() => setIsMobileMenuOpen(false)} className={cn(
                "text-lg font-medium p-2 rounded-lg",
                location === "/hiring" ? "bg-blue-50 text-blue-600" : "text-slate-600"
              )}>
                Hiring
              </Link>
              {user && (
                <Link href="/dashboard" onClick={() => setIsMobileMenuOpen(false)} className={cn(
                  "text-lg font-medium p-2 rounded-lg",
                  location === "/dashboard" ? "bg-blue-50 text-blue-600" : "text-slate-600"
                )}>
                  Dashboard
                </Link>
              )}
            </nav>
            <div className="pt-4 border-t border-slate-100 flex flex-col gap-3">
              {user ? (
                <>
                  <Link href="/profile" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar} alt={user.name} />
                      <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.isVerified ? "Verified User" : "Unverified User"}</p>
                    </div>
                  </Link>
                  <Button 
                    variant="outline" 
                    className="w-full text-red-600 border-red-100 hover:bg-red-50"
                    onClick={() => {
                      logout();
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    variant="outline" 
                    className="w-full h-12"
                    asChild
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <Link href="/auth?mode=login">Log in</Link>
                  </Button>
                  <Button 
                    className="w-full h-12 bg-blue-600"
                    asChild
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <Link href="/auth">Sign up</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BrandLogo className="h-7 max-w-[180px]" />
              </div>
              <p className="text-sm text-slate-500 max-w-xs">
                Restoring trust in real estate through mandatory identity and property verification.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 md:col-span-3 md:grid-cols-3">
              <div>
                <h4 className="font-semibold text-slate-900 mb-4">Platform</h4>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li><Link href="/" className="hover:text-blue-600">Marketplace</Link></li>
                  <li><Link href="/verify" className="hover:text-blue-600">Verification</Link></li>
                  <li><Link href="/services" className="hover:text-blue-600">Pricing</Link></li>
                  <li><Link href="/hiring" className="hover:text-blue-600">Hiring</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-4">Legal</h4>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li><Link href="/terms-of-service" className="hover:text-blue-600">Terms of Service</Link></li>
                  <li><Link href="/privacy-policy" className="hover:text-blue-600">Privacy Policy</Link></li>
                  <li><Link href="/escrow-policy" className="hover:text-blue-600">Escrow Policy</Link></li>
                </ul>
              </div>

              <div className="col-start-1 md:col-start-auto">
                <h4 className="font-semibold text-slate-900 mb-4">Contact</h4>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li>contact@justicecityltd.com</li>
                  <li>+234 906 534 0189</li>
                  <li>Owerri, Imo, Nigeria</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-slate-100 text-center text-sm text-slate-400">
            (c) 2026 Justice City Ltd. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
