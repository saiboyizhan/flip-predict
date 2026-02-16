import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { PositionList } from "../components/portfolio/PositionList";
import { usePortfolioStore } from "../stores/usePortfolioStore";
import { useAuthStore } from "../stores/useAuthStore";
import { fetchTradeHistory } from "../services/api";

interface HistoryRecord {
  id: string;
  marketTitle: string;
  side: "yes" | "no";
  amount: number;
  result: "won" | "lost" | "pending";
  pnl: number;
  settledAt: string;
}

export default function PortfolioPage() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const address = useAuthStore((s) => s.address);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fetchFromAPI = usePortfolioStore((s) => s.fetchFromAPI);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    if (address) {
      void fetchFromAPI(address);
      fetchTradeHistory(address)
        .then((data) => {
          const records: HistoryRecord[] = (data.trades ?? []).map((t: any) => ({
            id: String(t.id ?? t.orderId ?? Math.random()),
            marketTitle: String(t.market_title ?? t.market ?? t.marketTitle ?? ""),
            side: t.side === "no" ? "no" : "yes",
            amount: Number(t.amount) || 0,
            result: t.result === "won" ? "won" : t.result === "lost" ? "lost" : "pending",
            pnl: Number(t.pnl) || 0,
            settledAt: String(t.settled_at ?? t.settledAt ?? t.timestamp ?? new Date(Number(t.created_at) || Date.now()).toLocaleString()),
          }));
          setHistory(records);
        })
        .catch((err) => console.error("Failed to load trade history:", err));
    }
  }, [address, fetchFromAPI]);

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-[80vh]">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Wallet className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold text-muted-foreground mb-2">{t('portfolio.connectRequired')}</h2>
            <p className="text-muted-foreground text-sm mb-6">{t('portfolio.connectRequiredDesc')}</p>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-colors"
            >
              {t('portfolio.discoverMarkets')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[80vh]">
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <h1 className="text-lg sm:text-xl font-bold text-foreground">{t('portfolio.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('portfolio.description')}</p>
        </motion.div>
        <PositionList history={history} />
      </div>
    </div>
  );
}
