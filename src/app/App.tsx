import React, { Suspense, useEffect } from "react";
import { Routes, Route, useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Toaster } from "./components/ui/sonner";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { useTranslation } from "react-i18next";
import { AppHeader } from "./components/layout/AppHeader";
import PageSkeleton from "./components/PageSkeleton";
import { MintAgentModal } from "./components/agent/MintAgentModal";
import { useMarketStore } from "./stores/useMarketStore";
import { useAuthStore } from "./stores/useAuthStore";
import { useAgentStore } from "./stores/useAgentStore";

const SUPPORTED_CHAIN_IDS = [56, 97]; // BSC Mainnet and Testnet

function ChainWarningBanner() {
  const { t } = useTranslation();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || SUPPORTED_CHAIN_IDS.includes(chainId)) {
    return null;
  }

  return (
    <div className="bg-red-500/10 border-b border-red-500/40 px-4 py-3 flex flex-wrap items-center justify-center gap-3 text-sm">
      <span className="text-red-400 font-medium">
        {t("chain.wrongNetwork")}
      </span>
      <button
        onClick={() => switchChain({ chainId: 56 })}
        disabled={isPending}
        className="px-4 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-black font-bold text-xs tracking-wide uppercase transition-colors"
      >
        {isPending ? t("chain.switching") : t("chain.switchToBsc")}
      </button>
    </div>
  );
}

// Lazy load pages
const HomePage = React.lazy(() => import("./pages/HomePage"));
const MarketDetailPage = React.lazy(() => import("./pages/MarketDetailPage"));
const PortfolioPage = React.lazy(() => import("./pages/PortfolioPage"));
const LeaderboardPage = React.lazy(() => import("./pages/LeaderboardPage"));
const WalletPage = React.lazy(() => import("./pages/WalletPage"));
const ProfilePage = React.lazy(() => import("./pages/ProfilePage"));
const AgentDashboardPage = React.lazy(() => import("./pages/AgentDashboardPage"));
const MintAgentPage = React.lazy(() => import("./pages/MintAgentPage"));
const AgentDetailPage = React.lazy(() => import("./pages/AgentDetailPage"));
const CreateMarketPage = React.lazy(() => import("./pages/CreateMarketPage"));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage"));
const RewardsPage = React.lazy(() => import("./pages/RewardsPage"));
const UserProfilePage = React.lazy(() => import("./pages/UserProfilePage"));
const FeedPage = React.lazy(() => import("./pages/FeedPage"));
const NotificationsPage = React.lazy(() => import("./pages/NotificationsPage"));

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <h1 className="text-4xl font-bold text-muted-foreground mb-4">404</h1>
      <p className="text-muted-foreground mb-6">{t("error.notFound")}</p>
      <Link to="/" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-colors">
        {t("error.backToHome")}
      </Link>
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageTransition><HomePage /></PageTransition>} />
          <Route path="/market/:id" element={<PageTransition><MarketDetailPage /></PageTransition>} />
          <Route path="/portfolio" element={<PageTransition><PortfolioPage /></PageTransition>} />
          <Route path="/leaderboard" element={<PageTransition><LeaderboardPage /></PageTransition>} />
          <Route path="/wallet" element={<PageTransition><WalletPage /></PageTransition>} />
          <Route path="/profile" element={<PageTransition><ProfilePage /></PageTransition>} />
          <Route path="/markets/create" element={<PageTransition><CreateMarketPage /></PageTransition>} />
          <Route path="/agents" element={<PageTransition><AgentDashboardPage /></PageTransition>} />
          <Route path="/agents/mint" element={<PageTransition><MintAgentPage /></PageTransition>} />
          <Route path="/agents/:id" element={<PageTransition><AgentDetailPage /></PageTransition>} />
          <Route path="/dashboard" element={<PageTransition><DashboardPage /></PageTransition>} />
          <Route path="/rewards" element={<PageTransition><RewardsPage /></PageTransition>} />
          <Route path="/user/:address" element={<PageTransition><UserProfilePage /></PageTransition>} />
          <Route path="/feed" element={<PageTransition><FeedPage /></PageTransition>} />
          <Route path="/notifications" element={<PageTransition><NotificationsPage /></PageTransition>} />
          <Route path="*" element={
            <PageTransition>
              <NotFoundPage />
            </PageTransition>
          } />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    void useMarketStore.getState().fetchFromAPI();
  }, []);

  // On mount or when auth changes: check agent status, prompt mint if none
  useEffect(() => {
    if (isAuthenticated) {
      useAgentStore.getState().fetchMyAgents().then(() => {
        const { hasAgent } = useAgentStore.getState();
        if (!hasAgent) {
          useAgentStore.getState().setShowMintModal(true);
        }
      });
    }
  }, [isAuthenticated]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Toaster position="top-right" />
      <AppHeader />
      <ChainWarningBanner />
      <AnimatedRoutes />
      <MintAgentModal />
    </div>
  );
}
