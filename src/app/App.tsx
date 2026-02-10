import React, { Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Toaster } from "sonner";
import { AppHeader } from "./components/layout/AppHeader";
import PageSkeleton from "./components/PageSkeleton";

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
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Toaster theme="dark" position="top-right" />
      <AppHeader />
      <AnimatedRoutes />
    </div>
  );
}
