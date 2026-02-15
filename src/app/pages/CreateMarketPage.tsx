import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CreateMarketForm } from "../components/market/CreateMarketForm";
import { getMarketCreationStats } from "@/app/services/api";

export default function CreateMarketPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [stats, setStats] = useState({
    dailyCount: 0,
    maxPerDay: 3,
    creationFee: 10,
    balance: 0,
    totalCreated: 0,
  });

  useEffect(() => {
    getMarketCreationStats()
      .then(setStats)
      .catch(() => {});
  }, []);

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
            <Plus className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl sm:text-4xl font-bold">{t('createMarket.title')}</h1>
          </div>
          <p className="text-muted-foreground text-lg">
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
