import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Wallet, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
  const [tradeHistoryError, setTradeHistoryError] = useState(false);
  const [tradeHistoryLoading, setTradeHistoryLoading] = useState(false);

  const loadTradeHistory = (addr: string) => {
    setTradeHistoryLoading(true);
    setTradeHistoryError(false);
    fetchTradeHistory(addr)
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
      .catch((err) => {
        console.error("Failed to load trade history:", err);
        setTradeHistoryError(true);
        toast.error(t("portfolio.loadHistoryFailed", { defaultValue: "Failed to load trade history" }));
      })
      .finally(() => {
        setTradeHistoryLoading(false);
      });
  };

  useEffect(() => {
    if (address) {
      usePortfolioStore.getState().fetchFromAPI(address);
      loadTradeHistory(address);
    }
  }, [address]);

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
        {tradeHistoryError && (
          <div className="mb-4 flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-400 font-medium">
                {t("portfolio.loadHistoryFailed", { defaultValue: "Failed to load trade history" })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("portfolio.loadHistoryFailedDesc", { defaultValue: "Your positions are still visible. Trade history will reload automatically." })}
              </p>
            </div>
            <button
              onClick={() => address && loadTradeHistory(address)}
              disabled={tradeHistoryLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${tradeHistoryLoading ? "animate-spin" : ""}`} />
              {t("common.retry", { defaultValue: "Retry" })}
            </button>
          </div>
        )}
        <PositionList history={history} />
      </div>
    </div>
  );
}
