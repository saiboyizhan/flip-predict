import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MarketDetail } from "../components/market/MarketDetail";
import { useMarketStore } from "../stores/useMarketStore";
import { CATEGORIES } from "../data/markets";
import type { Market } from "../types/market.types";

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

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getMarketById } = useMarketStore();
  const { t } = useTranslation();

  const market = id ? getMarketById(id) : null;

  if (!market) {
    return (
      <div className="pt-4 px-4 sm:px-6 pb-12">
        <p className="text-zinc-400">{t('market.notFound')}</p>
        <button
          onClick={() => navigate("/")}
          className="text-amber-400 hover:text-amber-300 text-sm mt-2 transition-colors"
        >
          ← {t('market.backToHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="pt-4 px-4 sm:px-6 pb-12">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm mb-4 transition-colors"
      >
        ← {t('market.backToList')}
      </button>
      <MarketDetail
        market={toCardMarket(market)}
      />
    </div>
  );
}
