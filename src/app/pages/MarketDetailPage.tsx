import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { Loader2, RefreshCw } from "lucide-react";
import { MarketDetail } from "../components/market/MarketDetail";
import { useMarketStore } from "../stores/useMarketStore";
import { useContractPosition, useContractPrice } from "../hooks/useContracts";
import { CATEGORIES } from "../data/markets";
import { fetchMarket } from "../services/api";
import type { Market } from "../types/market.types";
import { formatUnits } from "viem";

function toCardMarket(m: Market) {
  const cat = CATEGORIES.find(c => c.id === m.category);

  // Map store MarketStatus to the card/detail status union
  let cardStatus: "active" | "expiring" | "settled" | "pending_resolution" | "resolved" | "expired";
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
    case "expired":
      cardStatus = "expired";
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
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const fetchedRef = useRef(false);

  const doFetch = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setFetchError(false);
    fetchMarket(id)
      .then((m) => {
        setApiMarket(m);
        setFetchError(false);
      })
      .catch(() => {
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Reset ref when id changes
  useEffect(() => {
    fetchedRef.current = false;
  }, [id]);

  // If market is not in store, try fetching it from the API (e.g. direct URL navigation)
  useEffect(() => {
    if (!storeMarket && id && !fetchedRef.current) {
      fetchedRef.current = true;
      doFetch();
    }
  }, [id, storeMarket, doFetch]);

  const market = storeMarket || apiMarket;

  // Read user position from on-chain (source of truth)
  const { address } = useAccount();
  const onChainMarketId = market?.onChainMarketId;
  const marketIdBigint = useMemo(() => {
    if (!onChainMarketId) return undefined;
    try { return BigInt(onChainMarketId); } catch { return undefined; }
  }, [onChainMarketId]);

  const { position: onChainPosition } = useContractPosition(marketIdBigint, address as `0x${string}` | undefined);
  const { yesPrice, noPrice } = useContractPrice(marketIdBigint);

  const mappedPosition = useMemo(() => {
    if (!onChainPosition) return undefined;
    const yesAmount = Number(formatUnits(onChainPosition.yesAmount, 18));
    const noAmount = Number(formatUnits(onChainPosition.noAmount, 18));
    if (yesAmount <= 0 && noAmount <= 0) return undefined;
    // Show the side with larger position; if both exist, show the larger one
    const side = yesAmount >= noAmount ? 'yes' : 'no';
    const shares = side === 'yes' ? yesAmount : noAmount;
    const currentPrice = side === 'yes' ? yesPrice : noPrice;
    // avgCost is not available on-chain, approximate with current price
    return { side, shares, avgCost: currentPrice };
  }, [onChainPosition, yesPrice, noPrice]);

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
            setApiMarket(null);
            doFetch();
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
