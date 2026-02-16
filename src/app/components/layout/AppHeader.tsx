"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Search,
  Wallet,
  Menu,
  X,
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
  ChevronDown,
  Sun,
  Moon,
  Rss,
  Zap,
  Clock,
  Trash2,
  Shield,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useMarketStore } from "@/app/stores/useMarketStore";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { useAgentStore } from "@/app/stores/useAgentStore";
import { searchMarkets } from "@/app/services/api";
import { NotificationBell } from "./NotificationBell";

// All nav items visible in the top bar
const CORE_NAV_ITEMS = [
  { id: "markets", labelKey: "nav.market", icon: BarChart3, path: "/" },
  { id: "mint", labelKey: "agent.mintFree", icon: Sparkles, path: "/agents/mint" },
  { id: "portfolio", labelKey: "nav.portfolio", icon: PieChart, path: "/portfolio" },
  { id: "leaderboard", labelKey: "nav.leaderboard", icon: Trophy, path: "/leaderboard" },
  { id: "wallet", labelKey: "nav.wallet", icon: CreditCard, path: "/wallet" },
  { id: "agents", labelKey: "nav.agents", icon: Bot, path: "/agents" },
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { id: "rewards", labelKey: "nav.rewards", icon: Gift, path: "/rewards" },
  { id: "feed", labelKey: "social.feed", icon: Rss, path: "/feed" },
  { id: "create", labelKey: "nav.create", icon: Plus, path: "/markets/create" },
];

// Items also shown in the user avatar dropdown
const USER_MENU_ITEMS = [
  { id: "create", labelKey: "nav.create", icon: Plus, path: "/markets/create" },
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { id: "rewards", labelKey: "nav.rewards", icon: Gift, path: "/rewards" },
  { id: "feed", labelKey: "social.feed", icon: Rss, path: "/feed" },
];

const ALL_NAV_ITEMS = CORE_NAV_ITEMS;

const SEARCH_HISTORY_KEY = "flip_search_history";
const MAX_SEARCH_HISTORY = 5;

function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SEARCH_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(history: string[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_SEARCH_HISTORY)));
}

function addToSearchHistory(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const history = getSearchHistory().filter((h) => h !== trimmed);
  history.unshift(trimmed);
  saveSearchHistory(history.slice(0, MAX_SEARCH_HISTORY));
}

function removeFromSearchHistory(query: string) {
  const history = getSearchHistory().filter((h) => h !== query);
  saveSearchHistory(history);
}

function clearSearchHistory() {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
}

function getActiveNavId(pathname: string): string {
  if (pathname === "/") return "markets";
  if (pathname.startsWith("/markets/create")) return "create";
  if (pathname.startsWith("/market/")) return "markets";
  if (pathname.startsWith("/portfolio")) return "portfolio";
  if (pathname.startsWith("/leaderboard")) return "leaderboard";
  if (pathname.startsWith("/feed")) return "feed";
  if (pathname.startsWith("/user/")) return "feed";
  if (pathname.startsWith("/wallet")) return "wallet";
  if (pathname.startsWith("/agents/mint")) return "mint";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/rewards")) return "rewards";
  if (pathname.startsWith("/admin")) return "admin";
  return "markets";
}

interface SearchResult {
  id: string;
  title: string;
  category?: string;
  yesPrice?: number;
}

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchHistory, setSearchHistoryState] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const { navigate } = useTransitionNavigate();
  const location = useLocation();
  const setStoreSearch = useMarketStore((s) => s.setSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect: walletDisconnect } = useDisconnect();
  const { open: openWeb3Modal } = useAppKit();
  const { login, disconnect: authDisconnect, isAuthenticated, isAdmin } = useAuthStore();
  const prevAddressRef = useRef<string | undefined>(undefined);

  const hasAgent = useAgentStore((s) => s.hasAgent);

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

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
        setShowSearchHistory(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Refresh search history from localStorage
  const refreshSearchHistory = useCallback(() => {
    setSearchHistoryState(getSearchHistory());
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

      // Hide history when user starts typing
      setShowSearchHistory(false);

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

          // Save to search history
          addToSearchHistory(value);
          refreshSearchHistory();
        } catch {
          // Fallback: just do local filtering via store, don't show dropdown
          setShowSearchResults(false);
          if (location.pathname !== "/") navigate("/");
        } finally {
          setSearchLoading(false);
        }
      }, 300);
    },
    [setStoreSearch, location.pathname, navigate, refreshSearchHistory],
  );

  const handleSearchResultClick = (marketId: string) => {
    setShowSearchResults(false);
    setShowSearchHistory(false);
    setSearchQuery("");
    setStoreSearch("");
    navigate(`/market/${marketId}`);
  };

  const handleSearchFocus = () => {
    if (searchQuery.trim() && searchResults.length > 0) {
      setShowSearchResults(true);
    } else if (!searchQuery.trim()) {
      refreshSearchHistory();
      setShowSearchHistory(true);
    }
  };

  const handleHistoryItemClick = (query: string) => {
    setShowSearchHistory(false);
    setSearchQuery(query);
    handleSearch(query);
  };

  const handleRemoveHistoryItem = (e: React.MouseEvent, query: string) => {
    e.stopPropagation();
    removeFromSearchHistory(query);
    refreshSearchHistory();
  };

  const handleClearAllHistory = () => {
    clearSearchHistory();
    refreshSearchHistory();
    setShowSearchHistory(false);
  };

  const toggleLang = () => {
    const next = i18n.language === "zh" ? "en" : "zh";
    i18n.changeLanguage(next);
  };

  const activePage = getActiveNavId(location.pathname);

  return (
    <header className="sticky top-0 z-50 bg-background/60 backdrop-blur-xl border-b border-white/[0.06]">
      {/* Main Bar */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: Logo */}
        <div
          className="flex items-center gap-2 shrink-0 cursor-pointer group"
          onClick={() => navigate("/")}
        >
          {/* Mark: rounded square with gradient + white probability curve */}
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-shadow">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M2 16 C5 16 6 6 9 6 C12 6 12 18 15 18 C18 18 19 10 22 10"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="22" cy="10" r="2" fill="white" opacity="0.9" />
            </svg>
          </div>
          {/* Wordmark */}
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-lg font-extrabold tracking-tight text-foreground">
              Flip
            </span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase rounded bg-blue-500/15 text-blue-400 border border-blue-500/25 leading-none">
              Beta
            </span>
          </div>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-md hidden md:block relative" ref={searchDropdownRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={handleSearchFocus}
              placeholder={t("nav.searchMarket")}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg text-foreground text-sm py-2 pl-10 pr-10 focus:outline-none focus:border-blue-500/40 transition-colors placeholder:text-muted-foreground"
            />
            {searchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
            )}
          </div>

          {/* Search History Dropdown */}
          {showSearchHistory && !showSearchResults && searchHistory.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
              <div className="px-4 py-2 border-b border-white/[0.06]">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  {t("nav.recentSearches", "Recent Searches")}
                </span>
              </div>
              {searchHistory.map((item) => (
                <button
                  key={item}
                  onClick={() => handleHistoryItemClick(item)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-accent transition-colors text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate">{item}</span>
                  </div>
                  <button
                    onClick={(e) => handleRemoveHistoryItem(e, item)}
                    className="p-1 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title={t("nav.removeSearch", "Remove")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </button>
              ))}
              <button
                onClick={handleClearAllHistory}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-red-400 hover:bg-accent/50 transition-colors border-t border-white/[0.06]"
              >
                <Trash2 className="w-3 h-3" />
                <span>{t("nav.clearHistory", "Clear All History")}</span>
              </button>
            </div>
          )}

          {/* Search Results Dropdown */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleSearchResultClick(result.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate">{result.title}</div>
                    {result.category && (
                      <div className="text-xs text-muted-foreground mt-0.5">{result.category}</div>
                    )}
                  </div>
                  {result.yesPrice != null && (
                    <span className="text-sm font-mono text-blue-500 shrink-0 ml-3">
                      {(result.yesPrice * 100).toFixed(0)}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Lang + Notification + Wallet + User Menu + Mobile Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Language Switcher */}
          <button
            onClick={toggleLang}
            className="flex items-center gap-1 px-2 py-1.5 sm:px-3 sm:py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] text-muted-foreground hover:text-blue-500 text-xs sm:text-sm font-medium transition-colors"
            title={t('nav.switchLang')}
            aria-label={t('nav.switchLang')}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{i18n.language === "zh" ? t("lang.zh") : t("lang.en")}</span>
          </button>

          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-1 px-2 py-1.5 sm:px-3 sm:py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] text-muted-foreground hover:text-blue-500 text-xs sm:text-sm font-medium transition-colors"
            title={t('nav.toggleTheme')}
            aria-label={t('nav.toggleTheme')}
          >
            {resolvedTheme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <NotificationBell />
          {isConnected && address ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => openWeb3Modal()}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-card border border-emerald-500/30 rounded-lg hover:border-emerald-500/50 transition-colors"
              >
                <Wallet className="w-4 h-4 text-emerald-400" />
                <span className="text-foreground text-sm font-mono hidden sm:inline">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </span>
              </button>
              {/* User Avatar Dropdown */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="p-2 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] text-muted-foreground hover:text-blue-500 transition-colors"
                  title={t("nav.myProfile")}
                >
                  <User className="w-4 h-4" />
                </button>
                {userMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 bg-card border border-border rounded-xl shadow-xl z-50 min-w-[220px] py-1">
                    {/* Profile link at top */}
                    <button
                      onClick={() => {
                        navigate("/profile");
                        setUserMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors border-b border-border ${
                        activePage === "profile"
                          ? "text-blue-500"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      <User className="w-4 h-4" />
                      <span>{t("nav.myProfile")}</span>
                    </button>
                    {/* Admin link - only visible to admins */}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          navigate("/admin/pending");
                          setUserMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                          activePage === "admin"
                            ? "text-blue-500"
                            : "text-amber-400 hover:text-amber-300 hover:bg-accent"
                        }`}
                      >
                        <Shield className="w-4 h-4" />
                        <span>{t("admin.pendingMarkets")}</span>
                      </button>
                    )}
                    {USER_MENU_ITEMS.map((item) => {
                      const isActive = activePage === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            navigate(item.path);
                            setUserMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                            isActive
                              ? "text-blue-500"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
                        >
                          <item.icon className="w-4 h-4" />
                          <span>{t(item.labelKey)}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        walletDisconnect();
                        authDisconnect();
                        setUserMenuOpen(false);
                        toast.success(t("wallet.disconnected"));
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-red-400 hover:text-red-300 hover:bg-accent border-t border-border"
                    >
                      <X className="w-4 h-4" />
                      <span>{t("wallet.disconnect")}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={() => openWeb3Modal()}
              className="flex items-center gap-2 px-3 py-2 sm:px-4 border border-white/[0.08] rounded-lg hover:border-blue-500/50 text-foreground hover:text-blue-400 bg-white/[0.04] font-semibold text-sm transition-colors"
            >
              <Wallet className="w-4 h-4" />
              <span className="hidden sm:inline">{t("nav.connectWallet")}</span>
            </button>
          )}

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('nav.toggleMenu')}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Desktop Nav - 6 core items covering the full product loop */}
      <div className="hidden md:flex items-center gap-1 px-6 pb-3">
        {CORE_NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id;
          const isMint = item.id === "mint";
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                isMint && !isActive
                  ? "text-emerald-400 hover:text-emerald-300"
                  : isActive
                    ? "text-blue-500"
                    : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span>{t(item.labelKey)}</span>
              {isActive && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_2px_8px] shadow-blue-500/30"
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
            className="md:hidden overflow-hidden border-t border-border"
          >
            {/* Mobile Search */}
            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={t("nav.searchMarket")}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg text-foreground text-sm py-2 pl-10 pr-4 focus:outline-none focus:border-blue-500/40 transition-colors placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* Mobile Nav Items */}
            <div className="p-2">
              {ALL_NAV_ITEMS.map((item) => {
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
                        ? "text-blue-500 bg-blue-500/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
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
