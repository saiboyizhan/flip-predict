import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  BarChart3,
  TrendingUp,
  Users,
  Activity,
  ArrowUpRight,
  DollarSign,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchPlatformStats } from "../services/api";

interface PlatformStats {
  totalMarkets: number;
  activeMarkets: number;
  totalVolume: number;
  totalUsers: number;
  todayNewMarkets: number;
  todayTrades: number;
}

function StatCardSkeleton() {
  return (
    <div className="bg-secondary border border-border p-4 animate-pulse">
      <div className="h-3 bg-muted rounded w-16 mb-2" />
      <div className="h-6 bg-muted rounded w-20 mb-1" />
      <div className="h-2.5 bg-muted rounded w-12" />
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchPlatformStats()
      .then((data) => {
        setStats(data);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const statCards = stats
    ? [
        {
          label: t('dashboard.totalMarkets'),
          value: stats.totalMarkets.toLocaleString(),
          icon: BarChart3,
          iconColor: "text-blue-400",
          borderColor: "border-blue-500/30",
        },
        {
          label: t('dashboard.activeMarkets'),
          value: stats.activeMarkets.toLocaleString(),
          icon: Activity,
          iconColor: "text-emerald-400",
          borderColor: "border-emerald-500/30",
          sub: t('dashboard.activeRate', { rate: ((stats.activeMarkets / Math.max(stats.totalMarkets, 1)) * 100).toFixed(0) }),
        },
        {
          label: t('dashboard.totalVolume'),
          value: `$${stats.totalVolume >= 1000000 ? (stats.totalVolume / 1000000).toFixed(1) + "M" : stats.totalVolume >= 1000 ? (stats.totalVolume / 1000).toFixed(1) + "K" : stats.totalVolume.toLocaleString()}`,
          icon: DollarSign,
          iconColor: "text-blue-400",

          borderColor: "border-blue-500/30",
        },
        {
          label: t('dashboard.totalUsers'),
          value: stats.totalUsers.toLocaleString(),
          icon: Users,
          iconColor: "text-purple-400",

          borderColor: "border-purple-500/30",
        },
        {
          label: t('dashboard.todayNewMarkets'),
          value: stats.todayNewMarkets.toLocaleString(),
          icon: ArrowUpRight,
          iconColor: "text-emerald-400",

          borderColor: "border-border",
          sub: t('dashboard.today'),
        },
        {
          label: t('dashboard.todayTrades'),
          value: stats.todayTrades.toLocaleString(),
          icon: Zap,
          iconColor: "text-blue-400",

          borderColor: "border-border",
          sub: t('dashboard.today'),
        },
      ]
    : [];

  return (
    <div className="relative min-h-screen p-4 sm:p-8">
      {/* Decorative blur */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <TrendingUp className="w-5 h-5 text-blue-400" />
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">{t('dashboard.title')}</h1>
            <p className="text-muted-foreground text-sm mt-1">{t('dashboard.subtitle')}</p>
          </div>
        </motion.div>

        {/* Stats Grid */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/50 border border-border p-12 text-center"
          >
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground text-lg mb-2">{t('dashboard.loadFailed')}</p>
            <p className="text-muted-foreground text-sm mb-4">{t('dashboard.loadFailedDesc')}</p>
            <button
              onClick={() => {
                setLoading(true);
                setError(false);
                fetchPlatformStats()
                  .then((data) => setStats(data))
                  .catch(() => setError(true))
                  .finally(() => setLoading(false));
              }}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-colors"
            >
              {t('common.retry')}
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`bg-secondary border ${card.borderColor} p-4 hover:scale-[1.01] transition-transform`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-muted/50 border border-border flex items-center justify-center rounded">
                    <card.icon className={`w-4 h-4 ${card.iconColor}`} />
                  </div>
                  <span className="text-muted-foreground text-xs tracking-wider uppercase">
                    {card.label}
                  </span>
                </div>
                <div className="text-xl font-bold text-foreground">
                  {card.value}
                </div>
                {card.sub && (
                  <div className="text-muted-foreground text-xs mt-0.5">{card.sub}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
