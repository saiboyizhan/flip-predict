"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Search,
  Wallet,
  Menu,
  X,
  Home,
  BarChart3,
  PieChart,
  Trophy,
  CreditCard,
  User,
  Bot,
  Sparkles,
  Plus,
  Globe,
  Loader2,
  LayoutDashboard,
  Gift,
} from "lucide-react";
import { useMarketStore } from "@/app/stores/useMarketStore";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { searchMarkets } from "@/app/services/api";
import { NotificationBell } from "./NotificationBell";

const NAV_ITEMS = [
  { id: "home", labelKey: "nav.home", icon: Home, path: "/" },
  { id: "markets", labelKey: "nav.market", icon: BarChart3, path: "/" },
  { id: "portfolio", labelKey: "nav.portfolio", icon: PieChart, path: "/portfolio" },
  { id: "leaderboard", labelKey: "nav.leaderboard", icon: Trophy, path: "/leaderboard" },
  { id: "wallet", labelKey: "nav.wallet", icon: CreditCard, path: "/wallet" },
  { id: "agents", labelKey: "nav.agents", icon: Bot, path: "/agents" },
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { id: "rewards", labelKey: "nav.rewards", icon: Gift, path: "/rewards" },
  { id: "create", labelKey: "nav.create", icon: Plus, path: "/markets/create" },
  { id: "mint", labelKey: "nav.mint", icon: Sparkles, path: "/agents/mint" },
];

function getActiveNavId(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/markets/create")) return "create";
  if (pathname.startsWith("/market/")) return "markets";
  if (pathname.startsWith("/portfolio")) return "portfolio";
  if (pathname.startsWith("/leaderboard")) return "leaderboard";
  if (pathname.startsWith("/wallet")) return "wallet";
  if (pathname.startsWith("/agents/mint")) return "mint";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/rewards")) return "rewards";
  return "home";
}

interface SearchResult {
  id: string;
  title: string;
  category?: string;
  yesPrice?: number;
}

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setStoreSearch = useMarketStore((s) => s.setSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { login, disconnect: authDisconnect, isAuthenticated } = useAuthStore();
  const prevAddressRef = useRef<string | undefined>(undefined);

  // Auto-login when wallet connects
  useEffect(() => {
    if (isConnected && address && address !== prevAddressRef.current && !isAuthenticated) {
      prevAddressRef.current = address;
      login(address, signMessageAsync).then((success) => {
        if (success) {
          toast.success(t("auth.loginSuccess"));
        } else {
          toast.error(t("auth.signFailed"));
        }
      });
    }
    if (!isConnected && prevAddressRef.current) {
      prevAddressRef.current = undefined;
      authDisconnect();
    }
  }, [isConnected, address, isAuthenticated, login, signMessageAsync, authDisconnect, t]);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!value.trim()) {
        setSearchResults([]);
        setShowSearchResults(false);
        setStoreSearch("");
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setStoreSearch(value);

        // Call backend search API for dropdown results
        setSearchLoading(true);
        try {
          const data = await searchMarkets(value);
          const markets = data.markets ?? [];
          setSearchResults(
            markets.map((m: any) => ({
              id: m.id,
              title: m.title,
              category: m.category,
              yesPrice: m.yesPrice,
            }))
          );
          setShowSearchResults(true);
        } catch {
          // Fallback: just do local filtering via store, don't show dropdown
          setShowSearchResults(false);
          if (location.pathname !== "/") navigate("/");
        } finally {
          setSearchLoading(false);
        }
      }, 300);
    },
    [setStoreSearch, location.pathname, navigate],
  );

  const handleSearchResultClick = (marketId: string) => {
    setShowSearchResults(false);
    setSearchQuery("");
    setStoreSearch("");
    navigate(`/market/${marketId}`);
  };

  const toggleLang = () => {
    const next = i18n.language === "zh" ? "en" : "zh";
    i18n.changeLanguage(next);
  };

  const activePage = getActiveNavId(location.pathname);

  return (
    <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-zinc-800">
      {/* Main Bar */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: Logo */}
        <div
          className="flex items-center gap-3 shrink-0 cursor-pointer"
          onClick={() => navigate("/")}
        >
          <div className="w-8 h-8 bg-amber-500 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-black" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight hidden sm:inline">
            {t("nav.siteName")}
          </span>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-md hidden md:block relative" ref={searchDropdownRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowSearchResults(true);
              }}
              placeholder={t("nav.searchMarket")}
              className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2 pl-10 pr-10 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600"
            />
            {searchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 animate-spin" />
            )}
          </div>

          {/* Search Results Dropdown */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 shadow-xl z-50 max-h-80 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleSearchResultClick(result.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{result.title}</div>
                    {result.category && (
                      <div className="text-xs text-zinc-500 mt-0.5">{result.category}</div>
                    )}
                  </div>
                  {result.yesPrice != null && (
                    <span className="text-sm font-mono text-amber-400 shrink-0 ml-3">
                      {(result.yesPrice * 100).toFixed(0)}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Lang + Notification + Wallet + Mobile Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Language Switcher */}
          <button
            onClick={toggleLang}
            className="flex items-center gap-1 px-2 py-1.5 sm:px-3 sm:py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-amber-400 text-xs sm:text-sm font-medium transition-colors"
            title="Switch Language"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{i18n.language === "zh" ? t("lang.zh") : t("lang.en")}</span>
          </button>

          <NotificationBell />
          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
              const connected = mounted && account && chain;
              return (
                <div
                  {...(!mounted && {
                    "aria-hidden": true,
                    style: { opacity: 0, pointerEvents: "none" as const, userSelect: "none" as const },
                  })}
                >
                  {connected ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={openAccountModal}
                        className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
                      >
                        <Wallet className="w-4 h-4 text-amber-400" />
                        <span className="text-white text-sm font-mono hidden sm:inline">{account.displayName}</span>
                        {account.displayBalance && (
                          <span className="text-amber-400 text-sm font-mono font-semibold hidden md:inline">
                            {account.displayBalance}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => navigate("/profile")}
                        className="p-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-amber-400 transition-colors"
                        title={t("nav.myProfile")}
                      >
                        <User className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={openConnectModal}
                      className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
                    >
                      <Wallet className="w-4 h-4" />
                      <span className="hidden sm:inline">{t("nav.connectWallet")}</span>
                    </button>
                  )}
                </div>
              );
            }}
          </ConnectButton.Custom>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-zinc-400 hover:text-white transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Desktop Nav */}
      <div className="hidden md:flex items-center gap-1 px-6 pb-3">
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "text-amber-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span>{t(item.labelKey)}</span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden overflow-hidden border-t border-zinc-800"
          >
            {/* Mobile Search */}
            <div className="p-4 border-b border-zinc-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={t("nav.searchMarket")}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2 pl-10 pr-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Mobile Nav Items */}
            <div className="p-2">
              {NAV_ITEMS.map((item) => {
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      navigate(item.path);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? "text-amber-400 bg-amber-500/10"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <span>{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
