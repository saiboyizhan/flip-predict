import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CategoryNav } from "../components/explore/CategoryNav";
import { MarketGrid } from "../components/explore/MarketGrid";
import { useMarketStore } from "../stores/useMarketStore";
import { CATEGORIES } from "../data/markets";
import type { Market } from "../types/market.types";

// Convert store Market to MarketCard format
function toCardMarket(m: Market) {
  const cat = CATEGORIES.find(c => c.id === m.category);
  return {
    id: m.id,
    title: m.title,
    category: cat?.name || m.category,
    categoryEmoji: cat?.emoji || "",
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    volume: m.volume,
    participants: m.participants,
    endTime: m.endTime,
    status: m.status === "active" ? "active" as const : m.status === "closed" || m.status === "resolved" ? "settled" as const : "expiring" as const,
    description: m.description,
    resolution: m.resolutionSource,
  };
}

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    filteredMarkets,
    selectedCategory,
    setCategory,
  } = useMarketStore();

  const featuredMarkets = filteredMarkets.filter(m => m.featured).slice(0, 3);
  const cardMarkets = filteredMarkets.map(toCardMarket);

  const handleMarketClick = (marketId: string) => {
    navigate(`/market/${marketId}`);
  };

  return (
    <div className="pt-4">
      {/* Featured Market Banner */}
      {featuredMarkets.length > 0 && (
        <div className="px-4 sm:px-6 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden bg-gradient-to-r from-amber-500/10 via-zinc-900 to-emerald-500/10 border border-zinc-800 p-4 sm:p-6 md:p-8 cursor-pointer"
            onClick={() => handleMarketClick(featuredMarkets[0].id)}
          >
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-1 bg-amber-500 text-black text-xs font-bold">
                  {t("common.hotPrediction")}
                </span>
                <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs border border-emerald-500/30">
                  {t("common.trading")}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-3">
                {featuredMarkets[0].title}
              </h2>
              <p className="text-zinc-400 text-sm mb-4 sm:mb-6 max-w-2xl">
                {featuredMarkets[0].description}
              </p>
              <div className="flex flex-wrap items-center gap-4 sm:gap-8">
                <div>
                  <span className="text-emerald-400 text-2xl sm:text-3xl font-bold font-mono">
                    {Math.round(featuredMarkets[0].yesPrice * 100)}%
                  </span>
                  <span className="text-zinc-500 text-sm ml-2">{t("market.yes")}</span>
                </div>
                <div className="w-px h-8 bg-zinc-700 hidden sm:block" />
                <div>
                  <span className="text-red-400 text-2xl sm:text-3xl font-bold font-mono">
                    {Math.round(featuredMarkets[0].noPrice * 100)}%
                  </span>
                  <span className="text-zinc-500 text-sm ml-2">{t("market.no")}</span>
                </div>
                <div className="w-px h-8 bg-zinc-700 hidden sm:block" />
                <div>
                  <span className="text-amber-400 text-lg font-mono">
                    ${featuredMarkets[0].volume >= 1000000
                      ? `${(featuredMarkets[0].volume / 1000000).toFixed(1)}M`
                      : `${(featuredMarkets[0].volume / 1000).toFixed(1)}K`}
                  </span>
                  <span className="text-zinc-500 text-sm ml-2">{t("common.volume")}</span>
                </div>
              </div>
            </div>
            {/* Background glow */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
          </motion.div>
        </div>
      )}

      {/* Category Filter */}
      <div className="px-4 sm:px-6 mb-6">
        <CategoryNav
          selectedCategory={selectedCategory}
          onCategoryChange={(cat) => setCategory(cat as any)}
        />
      </div>

      {/* Market Grid */}
      <div className="px-4 sm:px-6 pb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold">
            {selectedCategory === "all" ? t("common.allMarkets") : (CATEGORIES.find(c => c.id === selectedCategory)?.name || selectedCategory)}
          </h2>
          <span className="text-zinc-500 text-xs sm:text-sm">{t("common.marketsCount", { count: filteredMarkets.length })}</span>
        </div>
        <MarketGrid
          markets={cardMarkets}
          onMarketClick={handleMarketClick}
        />
      </div>
    </div>
  );
}
