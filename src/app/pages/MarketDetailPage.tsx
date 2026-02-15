import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { MarketDetail } from "../components/market/MarketDetail";
import { useMarketStore } from "../stores/useMarketStore";
import { usePortfolioStore } from "../stores/usePortfolioStore";
import { CATEGORIES } from "../data/markets";
import { fetchMarket } from "../services/api";
import type { Market } from "../types/market.types";

function toCardMarket(m: Market) {
  const cat = CATEGORIES.find(c => c.id === m.category);

  // Map store MarketStatus to the card/detail status union
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
    onChainMarketId: m.onChainMarketId,
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
    totalLiquidity: m.totalLiquidity,
  };
}

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { navigate } = useTransitionNavigate();
  const { t } = useTranslation();
  const storeMarket = useMarketStore((s) => id ? s.markets.find((m) => m.id === id) : undefined);
  const [apiMarket, setApiMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(!storeMarket && !!id);
  const [fetchError, setFetchError] = useState(false);

  // If market is not in store, try fetching it from the API (e.g. direct URL navigation)
  useEffect(() => {
    if (!storeMarket && id && !apiMarket && !loading && !fetchError) {
      setLoading(true);
      fetchMarket(id)
        .then((m) => {
          setApiMarket(m);
          setFetchError(false);
        })
        .catch(() => {
          setFetchError(true);
        })
        .finally(() => setLoading(false));
    }
  }, [id, storeMarket, apiMarket, loading, fetchError]);

  const market = storeMarket || apiMarket;

  // Get user position for this market from portfolio store
  const positions = usePortfolioStore((s) => s.positions);
  const userPosition = id
    ? positions.find((p) => p.marketId === id)
    : undefined;
  const mappedPosition = userPosition
    ? { side: userPosition.side, shares: userPosition.shares, avgCost: userPosition.avgCost }
    : undefined;

  if (loading) {
    return (
      <div className="pt-4 px-4 sm:px-6 pb-12 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (fetchError && !market) {
    return (
      <div className="pt-4 px-4 sm:px-6 pb-12">
        <p className="text-muted-foreground">{t('market.notFound')}</p>
        <button
          onClick={() => {
            setFetchError(false);
            setApiMarket(null);
          }}
          className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm mt-3 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t('common.retry', 'Retry')}
        </button>
        <button
          onClick={() => navigate("/")}
          className="text-muted-foreground hover:text-foreground text-sm mt-2 transition-colors"
        >
          &larr; {t('market.backToHome')}
        </button>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="pt-4 px-4 sm:px-6 pb-12">
        <p className="text-muted-foreground">{t('market.notFound')}</p>
        <button
          onClick={() => navigate("/")}
          className="text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors"
        >
          &larr; {t('market.backToHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="pt-4 px-4 sm:px-6 pb-12">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm mb-4 transition-colors"
      >
        &larr; {t('market.backToList')}
      </button>
      <MarketDetail
        market={toCardMarket(market)}
        userPosition={mappedPosition}
      />
    </div>
  );
}
