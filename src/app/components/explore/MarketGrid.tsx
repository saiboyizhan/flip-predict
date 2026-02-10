"use client";

import { motion } from "motion/react";
import { LayoutGrid, List, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarketCard } from "../market/MarketCard";
import { MarketCardSkeleton } from "../ui/MarketCardSkeleton";
import type { Market } from "../market/MarketCard";

interface MarketGridProps {
  markets: Market[];
  loading?: boolean;
  viewMode?: "grid" | "list";
  onViewModeChange?: (mode: "grid" | "list") => void;
  onMarketClick?: (marketId: string) => void;
}

export function MarketGrid({
  markets,
  loading = false,
  viewMode = "grid",
  onViewModeChange,
  onMarketClick,
}: MarketGridProps) {
  const { t } = useTranslation();

  // Loading State
  if (loading) {
    return (
      <div>
        {/* View Toggle */}
        <div className="flex items-center justify-end mb-4 gap-2">
          <button className="p-2 bg-zinc-800 text-zinc-500">
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button className="p-2 bg-zinc-800 text-zinc-500">
            <List className="w-4 h-4" />
          </button>
        </div>
        <div className={viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
          : "space-y-4"
        }>
          {Array.from({ length: 6 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Empty State
  if (markets.length === 0) {
    return (
      <div>
        {/* View Toggle */}
        {onViewModeChange && (
          <div className="flex items-center justify-end mb-4 gap-2">
            <button
              onClick={() => onViewModeChange("grid")}
              className={`p-2 transition-colors ${viewMode === "grid" ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-500 hover:text-white"}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewModeChange("list")}
              className={`p-2 transition-colors ${viewMode === "list" ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-500 hover:text-white"}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="bg-zinc-900 border border-zinc-800 p-8 sm:p-16 flex flex-col items-center justify-center">
          <SearchX className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-700 mb-4" />
          <h3 className="text-lg sm:text-xl font-bold text-zinc-400 mb-2">{t("market.noMarkets")}</h3>
          <p className="text-zinc-600 text-sm text-center">{t("market.noMarketsDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* View Toggle */}
      {onViewModeChange && (
        <div className="flex items-center justify-end mb-4 gap-2">
          <button
            onClick={() => onViewModeChange("grid")}
            className={`p-2 transition-colors ${viewMode === "grid" ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-500 hover:text-white"}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            className={`p-2 transition-colors ${viewMode === "list" ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-500 hover:text-white"}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
            : "space-y-4"
        }
      >
        {markets.map((market, index) => (
          <motion.div
            key={market.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <MarketCard
              market={market}
              size={viewMode === "list" ? "compact" : "medium"}
              onClick={() => onMarketClick?.(market.id)}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
