import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { ArrowLeft, Plus, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CreateMarketForm } from "../components/market/CreateMarketForm";
import { getMarketCreationStats } from "@/app/services/api";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { toast } from "sonner";

export default function CreateMarketPage() {
  const { navigate } = useTransitionNavigate();
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [stats, setStats] = useState({
    dailyCount: 0,
    maxPerDay: 3,
    creationFee: 0,
    balance: 0,
    totalCreated: 0,
  });

  useEffect(() => {
    if (isAuthenticated) {
      getMarketCreationStats()
        .then(setStats)
        .catch(() => { console.warn('[CreateMarket] Failed to load creation stats') });
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-[80vh]">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Wallet className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold text-muted-foreground mb-2">{t('auth.connectRequired')}</h2>
            <p className="text-muted-foreground text-sm mb-6">{t('auth.connectDescription')}</p>
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
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('createMarket.back')}
        </button>

        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-3">
            <Plus className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg sm:text-xl font-bold">{t('createMarket.title')}</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {t('createMarket.subtitle')}
          </p>
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <CreateMarketForm
            creationStats={stats}
            onSuccess={() => navigate('/')}
          />
        </motion.div>
      </div>
    </div>
  );
}
