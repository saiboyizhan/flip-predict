"use client";

import { LayoutGrid, List, SearchX, AlertCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarketCard } from "../market/MarketCard";
import { MarketCardSkeleton } from "../ui/MarketCardSkeleton";
import type { Market } from "../market/MarketCard";

interface MarketGridProps {
  markets: Market[];
  loading?: boolean;
  error?: boolean;
  viewMode?: "grid" | "list";
  onViewModeChange?: (mode: "grid" | "list") => void;
  onMarketClick?: (marketId: string) => void;
  onRetry?: () => void;
}

export function MarketGrid({
  markets,
  loading = false,
  error = false,
  viewMode = "grid",
  onViewModeChange,
  onMarketClick,
  onRetry,
}: MarketGridProps) {
  const { t } = useTranslation();

  // Error State
  if (error && markets.length === 0) {
    return (
      <div className="glass rounded-xl p-8 sm:p-16 flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-red-500/60" />
        </div>
        <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">{t("market.loadFailed")}</h3>
        <p className="text-muted-foreground text-sm text-center max-w-md mb-6">{t("market.loadFailedDesc")}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-6 py-2.5 bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 text-blue-400 rounded-xl font-bold text-sm tracking-wide transition-colors"
          >
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  // Loading State
  if (loading) {
    return (
      <div>
        <div className={viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
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
              className={`p-2 transition-colors ${viewMode === "grid" ? "bg-blue-500 text-white rounded-lg" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewModeChange("list")}
              className={`p-2 transition-colors ${viewMode === "list" ? "bg-blue-500 text-white rounded-lg" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        )}
        <div
          className="glass rounded-xl p-10 sm:p-16 flex flex-col items-center justify-center"
        >
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
            <SearchX className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">{t("market.noMarkets")}</h3>
          <p className="text-muted-foreground text-sm text-center max-w-md mb-6">{t("market.noMarketsDesc")}</p>
          <div className="flex items-center gap-2 px-5 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400 text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            {t("market.exploreOther")}
          </div>
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
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
            className={`p-2 transition-colors ${viewMode === "grid" ? "bg-blue-500 text-white rounded-lg" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            className={`p-2 transition-colors ${viewMode === "list" ? "bg-blue-500 text-white rounded-lg" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
            : "space-y-4"
        }
      >
        {markets.map((market) => (
          <MarketCard
            key={market.id}
            market={market}
            size={viewMode === "list" ? "compact" : "medium"}
            onClick={() => onMarketClick?.(market.id)}
          />
        ))}
      </div>
    </div>
  );
}
