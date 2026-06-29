"use client";

import { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { debounce } from "@/lib/performance";
import { SportsCatalog } from "@/components/SportsCatalog";
import { useAuth } from "@/context/AuthContext";
import type { WalletSummaryLine } from "@/lib/api/types";
import { publicConfigApi } from "@/lib/api";
import type { NavbarItem as PublicNavbarItem } from "@/lib/api/publicConfig";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  ChevronDown,
  Home,
  Radio,
  Gamepad2,
  PlayCircle,
  Trophy,
  Gift,
  Ticket,
  Wallet,
  RefreshCw,
  User,
  CreditCard,
  ArrowUpCircle,
  ArrowDownCircle,
  FileText,
  LogOut,
  Plane,
  Zap,
  Hash,
  MoreHorizontal,
  Menu,
  X,
  Plus,
} from "lucide-react";

const DEFAULT_MAIN_NAV_ITEMS = [
  { name: "HOME", href: "/" },
  { name: "GAMES", href: "/games" },
  { name: "AVIATOR", href: "/games?play=aviator" },
  { name: "JETX", href: "/games?play=jetx" },
  { name: "FAST KENO", href: "/games?play=fast-keno" },
  { name: "PROMOTIONS", href: "/promotions" },
];

const DEFAULT_MORE_NAV_ITEMS = [
  {
    name: "SPORT",
    href: "/sport",
    icon: Radio,
    submenu: [
      { name: "Upcoming events", href: "/sport" },
      { name: "Top Sports", href: "/sport/top" },
      { name: "Express", href: "/sport/express" },
      { name: "Results", href: "/sport/results" },
    ],
  },
  { name: "LIVE", href: "/live", icon: Radio },
  { name: "LIVE GAMES", href: "/live-games", icon: PlayCircle },
  { name: "VIRTUAL SPORTS", href: "/virtual-sports", icon: Trophy },
  { name: "COUPON CHECK", href: "/coupon-check", icon: Ticket },
];

function iconForNavLabel(label: string) {
  const key = label.toLowerCase();
  if (key.includes("home")) return Home;
  if (key.includes("game")) return Gamepad2;
  if (key.includes("aviator")) return Plane;
  if (key.includes("jetx")) return Zap;
  if (key.includes("keno")) return Hash;
  if (key.includes("promo")) return Gift;
  if (key.includes("sport")) return Trophy;
  if (key.includes("live")) return Radio;
  if (key.includes("ticket") || key.includes("coupon")) return Ticket;
  return MoreHorizontal;
}

const loginSchema = z.object({
  phone: z.string().trim().min(8, "Phone number is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name"),
    phone: z.string().trim().regex(/^\d{8,}$/, "Enter a valid phone number"),
    password: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/[A-Z]/, "Must contain uppercase letter")
      .regex(/[0-9]/, "Must contain a number"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
    referralCode: z.string().trim().max(40, "Referral code too long").optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export function Header() {
  const sessionExpired =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("session_expired") === "true";
  const pathname = usePathname();
  const {
    isAuthenticated,
    wallet,
    walletLoading,
    refreshWallet,
    login,
    register,
    logout,
  } = useAuth();

  const defaultCurrency =
    process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.trim().toUpperCase() || 'ETB';
  const walletLine =
    wallet?.summary?.find(
      (s: WalletSummaryLine) => s.currency.toUpperCase() === defaultCurrency
    ) ??
    wallet?.summary?.[0];
  const userBalance = walletLine ? Number(walletLine.balance) : 0;

  const [logoUrl, setLogoUrl] = useState<string>("");
  const [platformName, setPlatformName] = useState<string>("");
  const [mainNavItems, setMainNavItems] = useState(DEFAULT_MAIN_NAV_ITEMS);
  const [moreNavItems, setMoreNavItems] = useState(DEFAULT_MORE_NAV_ITEMS);

  useEffect(() => {
    let cancelled = false;
    const fetchConfig = () => {
      Promise.all([
        publicConfigApi.getPublicGeneral().catch(() => null),
        publicConfigApi.listNavbarItems().catch(() => ({ items: [] as PublicNavbarItem[] })),
      ]).then(([cfg, nav]) => {
          if (cancelled) return;
          if (cfg) {
            setLogoUrl(cfg.header_logo_url || cfg.logo_url || "");
            setPlatformName(cfg.platform_name ?? "");
          }
          const activeNav = (nav?.items ?? [])
            .filter((item) => item?.is_active !== false)
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
          if (activeNav.length > 0) {
            const main = activeNav
              .filter((i) => (i.bucket ?? "main") === "main")
              .map((i) => ({ name: i.label, href: i.href }));
            const more = activeNav
              .filter((i) => i.bucket === "more")
              .map((i) => ({ name: i.label, href: i.href, icon: iconForNavLabel(i.label) }));
            if (main.length > 0) setMainNavItems(main);
            if (more.length > 0) setMoreNavItems(more);
          }
        })
        .catch(() => { /* keep defaults */ });
    };
    fetchConfig();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchConfig(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [language, setLanguage] = useState("EN");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registerFullName, setRegisterFullName] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirm, setRegisterConfirm] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [registerSuccess, setRegisterSuccess] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sportsCatalogOpen, setSportsCatalogOpen] = useState(true);

  useEffect(() => {
    const toggle = () => setMobileMenuOpen((prev) => !prev);
    const close = () => setMobileMenuOpen(false);
    window.addEventListener("1birr:toggle-menu", toggle);
    window.addEventListener("1birr:close-menu", close);
    return () => {
      window.removeEventListener("1birr:toggle-menu", toggle);
      window.removeEventListener("1birr:close-menu", close);
    };
  }, []);

  // Let any other component (game launcher, betslip, deposit page…) request
  // the login dialog by firing `1birr:open-login`. This is how
  // unauthenticated users are redirected to login before playing a game or
  // placing an online bet.
  useEffect(() => {
    const open = () => {
      setMobileMenuOpen(false);
      setLoginOpen(true);
    };
    window.addEventListener("1birr:open-login", open);
    return () => window.removeEventListener("1birr:open-login", open);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setReferralCode(ref.trim());
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const parsed = loginSchema.safeParse({
      phone: phone,
      password,
    });
    if (!parsed.success) {
      setLoginError(parsed.error.issues[0]?.message ?? "Invalid login input");
      return;
    }
    try {
      await login({ phone: parsed.data.phone, password: parsed.data.password });
      setLoginOpen(false);
      setPhone("");
      setPassword("");
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : "Invalid phone number or password"
      );
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError("");
    setRegisterSuccess("");
    const parsed = registerSchema.safeParse({
      fullName: registerFullName,
      phone: registerPhone,
      password: registerPassword,
      confirmPassword: registerConfirm,
      referralCode: referralCode || undefined,
    });
    if (!parsed.success) {
      setRegisterError(parsed.error.issues[0]?.message ?? "Invalid registration input");
      return;
    }

    try {
      await register({
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
        password: parsed.data.password,
        referral_code: parsed.data.referralCode || undefined,
      });
      setRegisterFullName("");
      setRegisterPhone("");
      setRegisterPassword("");
      setRegisterConfirm("");
      setRegisterSuccess("Account created successfully");
      setRegisterOpen(false);
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : "Registration failed"
      );
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  // Debounced search function
  const performSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    // No mock search fallback: until a dedicated endpoint is wired,
    // keep search box stateful but return no fabricated results.
    setSearchResults([]);
  }, []);

  // Create debounced version (500ms delay)
  const debouncedSearch = useCallback(
    debounce((query: string) => performSearch(query), 500),
    [performSearch]
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };

  return (
    <header
      className="sticky top-0 z-50"
      style={{ background: "#142447" }}
    >
      {/* Top row */}
      <div
        className="flex items-center justify-between px-2 sm:px-4 py-2 border-b"
        style={{ borderColor: "var(--mezzo-border)" }}
      >
        {/* Logo and Mobile Menu Button */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Mobile Menu Toggle
              Visible on tablets only (md ≤ viewport < lg). On phones the
              new `MobileBottomNav` exposes the same drawer via its Menu
              tab, so showing the hamburger here too would be redundant
              and crowd the wallet/avatar area (matches the reference
              mockup which has only logo + balance + avatar on phones). */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="hidden md:inline-flex lg:hidden text-white p-2 hover:bg-gray-800 rounded"
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>

          {/* Brand logo — clicking still routes to home (unchanged). */}
          <Link href="/" className="flex items-center gap-2" aria-label="1birr.bet home">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={platformName || "1birr.bet"}
                className="h-8 sm:h-10 w-auto max-w-[160px] object-contain shrink-0"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            ) : (
              <>
                <span
                  className="flex items-center justify-center rounded-lg font-extrabold text-black h-8 w-8 sm:h-10 sm:w-10 text-sm sm:text-base shrink-0"
                  style={{ background: "#22c55e" }}
                >
                  1B
                </span>
                <span className="font-extrabold text-lg sm:text-2xl leading-none tracking-tight">
                  <span className="text-white">{platformName ? platformName.replace(/\.bet$/i, "") : "1birr"}</span>
                  <span style={{ color: "#22c55e" }}>.bet</span>
                </span>
              </>
            )}
          </Link>

          {/* Desktop Search */}
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
            <Input
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search teams, leagues, matches..."
              className="pl-10 w-48 lg:w-64 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white placeholder:text-gray-500 focus-visible:ring-[var(--mezzo-accent-green)]"
            />
            {searchResults.length > 0 && (
              <div
                className="absolute top-full mt-2 w-full rounded-lg border p-2 z-50"
                style={{ background: "#000", borderColor: "#333" }}
              >
                {searchResults.map((result, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 rounded hover:bg-gray-800 cursor-pointer text-sm text-white"
                  >
                    <div className="font-semibold">{result.name}</div>
                    <div className="text-xs text-gray-400">{result.type}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-2 lg:gap-3">
          {isAuthenticated ? (
            <>
              {/* Deposit Button - Hidden on small screens */}
              <Link href="/deposit" className="hidden sm:block">
                <Button
                  className="text-black font-semibold px-3 sm:px-4 py-2 text-xs sm:text-sm"
                  style={{ background: "var(--mezzo-accent-green)" }}
                >
                  Deposit
                </Button>
              </Link>

              {/* Wallet Balance
                  On mobile (<sm) the full "Deposit" button at the left is
                  hidden, so we embed a compact yellow "+" shortcut inside
                  the wallet pill. It only appears below the sm breakpoint
                  to avoid duplicating the full Deposit CTA on larger
                  screens (which keeps the existing desktop design intact). */}
              <div
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded"
                style={{ background: "var(--mezzo-bg-tertiary)" }}
              >
                <Wallet className="w-3 h-3 sm:w-4 sm:h-4 text-gray-400" />
                <span className="text-xs sm:text-sm font-semibold text-white hidden sm:inline">
                  ETB
                </span>
                <span className="text-xs sm:text-sm font-bold text-white">
                  {walletLoading ? "…" : userBalance.toFixed(2)}
                </span>
                <Link
                  href="/deposit"
                  aria-label="Deposit"
                  className="sm:hidden ml-0.5 w-5 h-5 rounded-full flex items-center justify-center text-black shadow-sm hover:opacity-90 transition-opacity touch-target"
                  style={{ background: "var(--mezzo-accent-yellow)" }}
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={3} />
                </Link>
              </div>

              {/* Refresh Button - Hidden on mobile */}
              <Button
                variant="ghost"
                className="text-gray-400 hover:text-white p-2 hidden md:flex"
                type="button"
                onClick={() => void refreshWallet()}
                aria-label="Refresh wallet balance"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>

              {/* User Avatar Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open profile menu"
                    style={{
                      width: 36,
                      height: 36,
                      minWidth: 36,
                      minHeight: 36,
                      borderRadius: 9999,
                      background: "var(--mezzo-accent-yellow)",
                      color: "#000",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                      border: "none",
                      cursor: "pointer",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
                    }}
                  >
                    <User
                      size={20}
                      strokeWidth={2.5}
                      color="#000"
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-56 bg-black border-gray-700"
                  style={{ backgroundColor: "#000000", borderColor: "#333" }}
                >
                  <DropdownMenuItem
                    asChild
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <Link
                      href="/bets-history"
                      className="flex items-center gap-2 w-full px-3 py-2"
                    >
                      <Ticket className="w-4 h-4" />
                      My Bets
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <Link
                      href="/deposit"
                      className="flex items-center gap-2 w-full px-3 py-2"
                    >
                      <ArrowDownCircle className="w-4 h-4" />
                      Deposit
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <Link
                      href="/withdraw"
                      className="flex items-center gap-2 w-full px-3 py-2"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      Withdraw
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <Link
                      href="/transaction-history"
                      className="flex items-center gap-2 w-full px-3 py-2"
                    >
                      <CreditCard className="w-4 h-4" />
                      Transaction History
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <Link
                      href="/coupon-check"
                      className="flex items-center gap-2 w-full px-3 py-2"
                    >
                      <FileText className="w-4 h-4" />
                      Check Ticket
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <Link
                      href="/profile"
                      className="flex items-center gap-2 w-full px-3 py-2"
                    >
                      <User className="w-4 h-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-red-400 hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-red-400 px-3 py-2"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Language selector
                  Hidden on <sm to match the logged-out branch and keep
                  the phone header uncluttered (logo + wallet + avatar
                  only, as per the reference mockup). The selector stays
                  reachable at sm+ so language switching is never lost. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="hidden sm:flex items-center gap-1 text-white">
                    <img
                      src="https://ext.same-assets.com/1203561035/3447107198.png"
                      alt="EN"
                      className="w-5 h-4 rounded-sm"
                    />
                    <span className="hidden md:inline">{language}</span>
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="bg-black border-gray-700"
                  style={{ backgroundColor: "#000000", borderColor: "#333" }}
                >
                  <DropdownMenuItem
                    onClick={() => setLanguage("EN")}
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <img
                      src="https://ext.same-assets.com/1203561035/3447107198.png"
                      alt="EN"
                      className="w-5 h-4 rounded-sm mr-2"
                    />
                    English
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLanguage("AM")}
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <img
                      src="https://ext.same-assets.com/1203561035/927399642.png"
                      alt="AM"
                      className="w-5 h-4 rounded-sm mr-2"
                    />
                    Amharic
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e] hover:text-black px-2 sm:px-4 py-2 text-xs sm:text-sm"
                onClick={() => setLoginOpen(true)}
              >
                LOGIN
              </Button>
              <Button
                className="text-black font-semibold px-2 sm:px-4 py-2 text-xs sm:text-sm bg-[#22c55e] hover:bg-[#16a34a]"
                onClick={() => setRegisterOpen(true)}
              >
                REGISTER
              </Button>

              {/* Language selector - Hidden on small screens */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="hidden sm:flex items-center gap-1 text-white">
                    <img
                      src="https://ext.same-assets.com/1203561035/3447107198.png"
                      alt="EN"
                      className="w-5 h-4 rounded-sm"
                    />
                    <span className="hidden md:inline">{language}</span>
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="bg-black border-gray-700"
                  style={{ backgroundColor: "#000000", borderColor: "#333" }}
                >
                  <DropdownMenuItem
                    onClick={() => setLanguage("EN")}
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <img
                      src="https://ext.same-assets.com/1203561035/3447107198.png"
                      alt="EN"
                      className="w-5 h-4 rounded-sm mr-2"
                    />
                    English
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLanguage("AM")}
                    className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white"
                  >
                    <img
                      src="https://ext.same-assets.com/1203561035/927399642.png"
                      alt="AM"
                      className="w-5 h-4 rounded-sm mr-2"
                    />
                    Amharic
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {sessionExpired && (
        <div className="px-3 sm:px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs sm:text-sm">
          Your session expired. Please log in again.
        </div>
      )}

      {/* Desktop Navigation - Hidden on mobile */}
      <nav className="hidden lg:flex items-center justify-center px-8 py-0" style={{ background: "#000" }}>
        <div className="flex items-center gap-2">
          {mainNavItems.map((item) => {
            const Icon = iconForNavLabel(item.name);
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 px-6 xl:px-8 py-2.5 transition-colors ${
                  isActive ? "text-[var(--mezzo-accent-yellow)]" : "text-gray-300 hover:text-white"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-wider">{item.name}</span>
              </Link>
            );
          })}

          {/* More Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex flex-col items-center justify-center gap-0.5 px-6 xl:px-8 py-2.5 transition-colors text-gray-300 hover:text-white"
              >
                <MoreHorizontal className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-wider">MORE</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="bg-black border-gray-700 min-w-[200px]"
              style={{ backgroundColor: "#000000", borderColor: "#333" }}
            >
              {moreNavItems.map((item) => {
                const Icon = item.icon;

                if (item.submenu) {
                  return (
                    <div key={item.name} className="relative group">
                      <DropdownMenuItem asChild>
                        <Link href={item.href} className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white px-4 py-3 text-sm flex items-center gap-2">
                          <Icon className="w-4 h-4" />
                          {item.name}
                          <ChevronDown className="w-3 h-3 ml-auto -rotate-90" />
                        </Link>
                      </DropdownMenuItem>
                    </div>
                  );
                }

                return (
                  <DropdownMenuItem key={item.name} asChild>
                    <Link href={item.href} className="text-white hover:bg-gray-800 cursor-pointer focus:bg-gray-800 focus:text-white px-4 py-3 text-sm flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {item.name}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 z-40" style={{ background: "#000", borderTop: "1px solid var(--mezzo-border)" }}>
          <div className="py-2 max-h-[calc(100vh-120px)] overflow-y-auto">
            {/* Mobile Search */}
            <div className="px-4 py-2 md:hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
                <Input
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder="Search..."
                  className="pl-10 w-full bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                />
              </div>
            </div>

            {/* Main Nav Items */}
            {mainNavItems.map((item) => {
              const Icon = iconForNavLabel(item.name);
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-6 py-3 transition-colors ${
                    isActive ? "bg-[var(--mezzo-bg-secondary)] text-[var(--mezzo-accent-yellow)]" : "text-gray-300 hover:bg-[var(--mezzo-bg-secondary)]"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm font-semibold">{item.name}</span>
                </Link>
              );
            })}

            {/* Browse Sports & Leagues
                Mirrors the desktop left sidebar (`SportsCatalog`) so
                phone/tablet users get the same league / country filter
                UX. Opened by default and placed directly after the main
                navigation so it's the first thing mobile users see when
                they tap Menu — exactly matching the sidebar's role on
                desktop. Selecting a league auto-closes the drawer via
                `onNavigate`. Hidden on `lg+` to avoid duplicating the
                sidebar content on desktop. */}
            <div
              className="border-t lg:hidden"
              style={{ borderColor: "var(--mezzo-border)" }}
            >
              <Collapsible open={sportsCatalogOpen} onOpenChange={setSportsCatalogOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-6 py-3 text-[var(--mezzo-accent-yellow)] hover:bg-[var(--mezzo-bg-secondary)] transition-colors group">
                    <span className="flex items-center gap-3">
                      <Trophy className="w-5 h-5" />
                      <span className="text-sm font-bold tracking-wide">
                        TOP LEAGUES &amp; SPORTS
                      </span>
                    </span>
                    <ChevronDown className="w-4 h-4 transition-transform group-data-[state=closed]:-rotate-90" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div
                    className="border-t"
                    style={{
                      borderColor: "var(--mezzo-border)",
                      background: "var(--mezzo-bg-primary)",
                    }}
                  >
                    <SportsCatalog
                      onNavigate={() => setMobileMenuOpen(false)}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* More Items */}
            <div className="border-t" style={{ borderColor: "var(--mezzo-border)" }}>
              {moreNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                if (item.submenu) {
                  return (
                    <div key={item.name}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-6 py-3 transition-colors ${
                          isActive ? "bg-[var(--mezzo-bg-secondary)] text-[var(--mezzo-accent-yellow)]" : "text-gray-300 hover:bg-[var(--mezzo-bg-secondary)]"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-sm font-semibold">{item.name}</span>
                      </Link>
                      {item.submenu.map((subItem) => (
                        <Link
                          key={subItem.name}
                          href={subItem.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex items-center gap-3 px-12 py-2 text-sm text-gray-400 hover:bg-[var(--mezzo-bg-secondary)]"
                        >
                          {subItem.name}
                        </Link>
                      ))}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-6 py-3 transition-colors ${
                      isActive ? "bg-[var(--mezzo-bg-secondary)] text-[var(--mezzo-accent-yellow)]" : "text-gray-300 hover:bg-[var(--mezzo-bg-secondary)]"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-semibold">{item.name}</span>
                  </Link>
                );
              })}
            </div>

            {/* Mobile-only actions */}
            {isAuthenticated && (
              <div className="border-t sm:hidden" style={{ borderColor: "var(--mezzo-border)" }}>
                <Link
                  href="/deposit"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-6 py-3 text-gray-300 hover:bg-[var(--mezzo-bg-secondary)]"
                >
                  <ArrowDownCircle className="w-5 h-5" />
                  <span className="text-sm font-semibold">Deposit</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="bg-black border-gray-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white">
              Login
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLogin} className="space-y-4 pt-4">
            {loginError && (
              <div className="px-4 py-2 rounded bg-red-500/20 border border-red-500 text-red-400 text-sm">
                {loginError}
              </div>
            )}
            <div>
              <label className="text-sm text-gray-400">Phone Number</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0924004654"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
                required
              />
            </div>
            <div className="text-xs text-gray-500 p-2 rounded bg-gray-900">
              <p className="mb-1">Use your registered account credentials.</p>
            </div>
            <Button
              type="submit"
              className="w-full text-black font-semibold"
              style={{ background: "var(--mezzo-accent-green)" }}
            >
              Login
            </Button>
            <p className="text-center text-sm text-gray-400">
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(false);
                  setRegisterOpen(true);
                }}
                className="text-[var(--mezzo-accent-yellow)] hover:underline"
              >
                Register
              </button>
            </p>
          </form>
        </DialogContent>
      </Dialog>

      {/* Register Dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="bg-black border-gray-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white">
              Register
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegister} className="space-y-4 pt-4">
            {registerError && (
              <div className="px-4 py-2 rounded bg-red-500/20 border border-red-500 text-red-400 text-sm">
                {registerError}
              </div>
            )}
            {registerSuccess && (
              <div className="px-4 py-2 rounded bg-green-500/20 border border-green-500 text-green-400 text-sm">
                {registerSuccess}
              </div>
            )}
            <div>
              <label className="text-sm text-gray-400">Full Name</label>
              <Input
                value={registerFullName}
                onChange={(e) => setRegisterFullName(e.target.value)}
                placeholder="e.g. Abebe Kebede"
                autoComplete="name"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Phone Number</label>
              <Input
                value={registerPhone}
                onChange={(e) => setRegisterPhone(e.target.value)}
                placeholder="0924004654"
                inputMode="tel"
                autoComplete="tel"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Referral Code (optional)</label>
              <Input
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                placeholder="Enter referral code"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Password</label>
              <Input
                type="password"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                placeholder="Create a password"
                autoComplete="new-password"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Confirm Password</label>
              <Input
                type="password"
                value={registerConfirm}
                onChange={(e) => setRegisterConfirm(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className="mt-1 bg-gray-900 border-gray-700 text-white focus-visible:ring-[var(--mezzo-accent-green)]"
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full text-black font-semibold"
              style={{ background: "var(--mezzo-accent-green)" }}
            >
              Register
            </Button>
            <p className="text-center text-sm text-gray-400">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setRegisterOpen(false);
                  setLoginOpen(true);
                }}
                className="text-[var(--mezzo-accent-yellow)] hover:underline"
              >
                Login
              </button>
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  );
}
