import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CategoryNav } from "../components/explore/CategoryNav";
import { TimeFilter } from "../components/explore/TimeFilter";
import { MarketGrid } from "../components/explore/MarketGrid";
import { useMarketStore } from "../stores/useMarketStore";
import { useShallow } from "zustand/react/shallow";
import { CATEGORIES } from "../data/markets";
import type { Market } from "../types/market.types";

// Convert store Market to MarketCard format
function toCardMarket(m: Market) {
  const cat = CATEGORIES.find(c => c.id === m.category);

  // Map store MarketStatus to MarketCard status union
  let cardStatus: "active" | "expiring" | "settled" | "pending_resolution" | "resolved";
  switch (m.status) {
    case "active":
      cardStatus = "active";
      break;
    case "pending":
    case "pending_resolution":
      cardStatus = "pending_resolution";
      break;
    case "closed":
    case "resolved":
      cardStatus = "settled";
      break;
    case "disputed":
      cardStatus = "expiring";
      break;
    default:
      cardStatus = "active";
  }

  return {
    id: m.id,
    title: m.title,
    category: m.category,
    categoryEmoji: cat?.emoji || "",
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    volume: m.volume,
    participants: m.participants,
    endTime: m.endTime,
    status: cardStatus,
    description: m.description,
    resolution: m.resolutionSource,
    resolvedOutcome: m.resolvedOutcome,
    marketType: m.marketType,
    options: m.options,
    totalLiquidity: m.totalLiquidity ?? 0,
  };
}

export default function HomePage() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const {
    markets,
    filteredMarkets,
    selectedCategory,
    setCategory,
    sortBy,
    setSortBy,
    timeWindow,
    setTimeWindow,
    error: marketError,
    loading: marketLoading,
    fetchFromAPI,
  } = useMarketStore(
    useShallow((s) => ({
      markets: s.markets,
      filteredMarkets: s.filteredMarkets,
      selectedCategory: s.selectedCategory,
      setCategory: s.setCategory,
      sortBy: s.sortBy,
      setSortBy: s.setSortBy,
      timeWindow: s.timeWindow,
      setTimeWindow: s.setTimeWindow,
      error: s.error,
      loading: s.loading,
      fetchFromAPI: s.fetchFromAPI,
    }))
  );

  const featuredMarkets = filteredMarkets.filter(m => m.featured).slice(0, 3);
  const cardMarkets = filteredMarkets.map(toCardMarket);

  const handleMarketClick = (marketId: string) => {
    navigate(`/market/${marketId}`);
  };

  return (
    <div className="relative pt-4">
      {/* Decorative blur */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />


      {/* Featured Market Banner */}
      {featuredMarkets.length > 0 && (
        <div className="relative px-4 sm:px-6 mb-6">
          {/* Primary Featured */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden bg-card border border-blue-500/10 rounded-xl p-4 sm:p-6 md:p-8 cursor-pointer hover:border-blue-500/30 transition-colors card-highlight"
            onClick={() => handleMarketClick(featuredMarkets[0].id)}
          >
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-1 bg-blue-500 text-white text-xs font-bold rounded-lg shadow-sm shadow-blue-500/40">
                  {t("common.hotPrediction")}
                </span>
                <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs border border-emerald-500/30">
                  {t("common.trading")}
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold mb-3">
                {featuredMarkets[0].title}
              </h2>
              <p className="text-muted-foreground text-sm mb-4 sm:mb-6 max-w-2xl">
                {featuredMarkets[0].description}
              </p>
              <div className="flex flex-wrap items-center gap-4 sm:gap-8">
                <div>
                  <span className="text-emerald-400 text-xl sm:text-2xl font-bold font-mono tabular-nums tracking-tight">
                    {Math.round(featuredMarkets[0].yesPrice * 100)}%
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">{t("market.yes")}</span>
                </div>
                <div className="w-px h-8 bg-border hidden sm:block" />
                <div>
                  <span className="text-red-400 text-xl sm:text-2xl font-bold font-mono tabular-nums tracking-tight">
                    {100 - Math.round(featuredMarkets[0].yesPrice * 100)}%
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">{t("market.no")}</span>
                </div>
                <div className="w-px h-8 bg-border hidden sm:block" />
                <div>
                  <span className="text-blue-400 text-lg font-mono tabular-nums">
                    ${featuredMarkets[0].volume >= 1000000
                      ? `${(featuredMarkets[0].volume / 1000000).toFixed(1)}M`
                      : `${(featuredMarkets[0].volume / 1000).toFixed(1)}K`}
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">{t("common.volume")}</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Secondary Featured Cards */}
          {featuredMarkets.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {featuredMarkets.slice(1, 3).map((m, i) => {
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.08 }}
                    className="relative overflow-hidden bg-card border border-white/[0.06] rounded-xl p-4 cursor-pointer hover:border-blue-500/20 hover:shadow-md hover:shadow-blue-500/10 transition-all"
                    onClick={() => handleMarketClick(m.id)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-semibold rounded-md">
                        {t("common.featured")}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold mb-2 line-clamp-2">{m.title}</h3>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-emerald-400 font-mono font-bold">
                        {Math.round(m.yesPrice * 100)}% {t("market.yes")}
                      </span>
                      <span className="text-red-400 font-mono font-bold">
                        {100 - Math.round(m.yesPrice * 100)}% {t("market.no")}
                      </span>
                      <span className="text-muted-foreground ml-auto font-mono">
                        ${m.volume >= 1000000
                          ? `${(m.volume / 1000000).toFixed(1)}M`
                          : `${(m.volume / 1000).toFixed(1)}K`}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Category Filter */}
      <div className="px-4 sm:px-6 mb-6">
        <CategoryNav
          selectedCategory={selectedCategory}
          onCategoryChange={(cat) => setCategory(cat as any)}
        />
      </div>

      {/* Sidebar + Market Grid */}
      <div className="px-4 sm:px-6 pb-12">
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Left Sidebar - Time Filter (desktop only) */}
          <aside className="hidden lg:block lg:w-44 shrink-0">
            <div className="sticky top-20">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
                {t("timeFilter.label")}
              </h3>
              <TimeFilter selected={timeWindow} onChange={setTimeWindow} markets={markets} />
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {/* Mobile Time Filter */}
            <div className="lg:hidden mb-4 -mx-2 px-2 overflow-x-auto scrollbar-hide">
              <div className="flex items-center gap-2 min-w-max">
                <TimeFilter selected={timeWindow} onChange={setTimeWindow} markets={markets} />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
              <h2 className="text-base sm:text-lg md:text-xl font-bold">
                {t(`category.${selectedCategory}`)}
              </h2>
              <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-foreground flex-1 sm:flex-none min-w-0"
                >
                  <option value="volume">{t("sort.volume")}</option>
                  <option value="newest">{t("sort.newest")}</option>
                  <option value="ending-soon">{t("sort.endingSoon")}</option>
                  <option value="popular">{t("sort.popular")}</option>
                </select>
                <span className="text-muted-foreground text-xs whitespace-nowrap">{t("common.marketsCount", { count: filteredMarkets.length })}</span>
              </div>
            </div>
            <MarketGrid
              markets={cardMarkets}
              loading={marketLoading}
              error={marketError}
              onMarketClick={handleMarketClick}
              onRetry={fetchFromAPI}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
