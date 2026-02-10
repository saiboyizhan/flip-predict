"use client";

import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { BarChart3, FileText, Scale, Info, Bot, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarketHeader } from "./MarketHeader";
import { MarketCountdown } from "./MarketCountdown";
import { ResolutionBadge } from "./ResolutionBadge";
import { ClaimWinnings } from "./ClaimWinnings";
import { TradePanel } from "../trading/TradePanel";
import { OrderBook } from "../trading/OrderBook";
import { LimitOrderForm } from "../trading/LimitOrderForm";
import { OpenOrders } from "../trading/OpenOrders";
import { CommentSection } from "./CommentSection";
import { PriceChart } from "./PriceChart";
import { getSettlement } from "@/app/services/api";

interface Market {
  id: string;
  title: string;
  category: string;
  categoryEmoji: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  participants: number;
  endTime: string;
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved";
  description?: string;
  resolution?: string;
  resolutionType?: string;
  oraclePair?: string;
  targetPrice?: number;
  resolvedOutcome?: string;
}

interface MarketDetailProps {
  market: Market;
  userPosition?: {
    side: string;
    shares: number;
    avgCost: number;
  };
}

export function MarketDetail({ market, userPosition }: MarketDetailProps) {
  const { t } = useTranslation();
  const [prefilledPrice, setPrefilledPrice] = useState<number | undefined>();
  const [settlement, setSettlement] = useState<{
    resolution_type?: string;
    oracle_pair?: string;
    target_price?: number;
    resolved_price?: number;
    outcome?: string;
    resolved_at?: string;
  } | null>(null);

  const isResolved =
    market.status === "resolved" || market.status === "settled";
  const isPending = market.status === "pending_resolution";

  useEffect(() => {
    if (isResolved || isPending) {
      getSettlement(market.id)
        .then((data) => setSettlement(data.resolution))
        .catch(() => {});
    }
  }, [market.id, isResolved, isPending]);

  const resolutionType =
    settlement?.resolution_type ?? market.resolutionType;
  const outcome =
    settlement?.outcome ?? market.resolvedOutcome;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column */}
      <div className="lg:col-span-8 space-y-6">
        {/* Header */}
        <MarketHeader market={market} />

        {/* Countdown + Resolution Badge */}
        <div className="flex flex-wrap items-center gap-3">
          <MarketCountdown
            endTime={market.endTime}
            status={market.status}
            outcome={outcome}
          />
          {resolutionType && (
            <ResolutionBadge
              resolutionType={resolutionType}
              oraclePair={settlement?.oracle_pair ?? market.oraclePair}
              targetPrice={settlement?.target_price ?? market.targetPrice}
            />
          )}
        </div>

        {/* Pending resolution notice */}
        {isPending && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/30 p-6"
          >
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-bold text-amber-400">{t('market.pendingSettlement')}</h3>
            </div>
            <p className="text-amber-300/70 text-sm">
              {t('market.pendingSettlementDesc')}
            </p>
          </motion.div>
        )}

        {/* Settlement info (when resolved) */}
        {isResolved && settlement && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-bold text-white">{t('market.settlementInfo')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-zinc-500 block mb-1">{t('market.settlementMethod')}</span>
                <div className="flex items-center gap-1.5 text-zinc-300">
                  {settlement.resolution_type === "manual" ? (
                    <>
                      <User className="w-3.5 h-3.5 text-zinc-400" />
                      {t('market.manualSettlement')}
                    </>
                  ) : (
                    <>
                      <Bot className="w-3.5 h-3.5 text-amber-400" />
                      {t('market.oracleSettlement')}
                    </>
                  )}
                </div>
              </div>
              {settlement.oracle_pair && (
                <div>
                  <span className="text-zinc-500 block mb-1">{t('market.tradingPair')}</span>
                  <span className="text-zinc-300 font-mono">
                    {settlement.oracle_pair}
                  </span>
                </div>
              )}
              {settlement.resolved_price != null && (
                <div>
                  <span className="text-zinc-500 block mb-1">{t('market.settlementPrice')}</span>
                  <span className="text-amber-400 font-mono font-bold">
                    $
                    {settlement.resolved_price.toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {settlement.resolved_at && (
                <div>
                  <span className="text-zinc-500 block mb-1">{t('market.settlementTime')}</span>
                  <span className="text-zinc-300 text-xs">
                    {new Date(settlement.resolved_at).toLocaleString("zh-CN")}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Price Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900 border border-zinc-800 p-8"
        >
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-white">{t('market.probTrend')}</h2>
          </div>
          <PriceChart marketId={market.id} />
        </motion.div>

        {/* Description */}
        {market.description && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-zinc-900 border border-zinc-800 p-8"
          >
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-bold text-white">{t('market.description')}</h2>
            </div>
            <p className="text-zinc-400 leading-relaxed">
              {market.description}
            </p>
          </motion.div>
        )}

        {/* Resolution Rules */}
        {market.resolution && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-zinc-900 border border-zinc-800 p-8"
          >
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-bold text-white">{t('market.resolutionRules')}</h2>
            </div>
            <p className="text-zinc-400 leading-relaxed">
              {market.resolution}
            </p>
          </motion.div>
        )}
      </div>

      {/* Right Column */}
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-24 space-y-6">
          {isResolved && outcome ? (
            /* Show ClaimWinnings when resolved */
            <ClaimWinnings
              marketId={market.id}
              outcome={outcome}
              userPosition={userPosition}
            />
          ) : (
            /* Show trading panels when active */
            <>
              <TradePanel
                marketId={market.id}
                marketTitle={market.title}
                status={market.status}
              />
              <OrderBook
                marketId={market.id}
                side="yes"
                onPriceClick={setPrefilledPrice}
              />
              <LimitOrderForm
                marketId={market.id}
                side="yes"
                prefilledPrice={prefilledPrice}
              />
              <OpenOrders marketId={market.id} />
            </>
          )}
          <CommentSection marketId={market.id} />
        </div>
      </div>
    </div>
  );
}
