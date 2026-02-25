"use client";

import { motion } from "motion/react";
import { useState, useEffect, useCallback } from "react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { BarChart3, FileText, Scale, Info, Bot, User, AlertTriangle, Activity, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useChainId, usePublicClient, useWriteContract } from "wagmi";
import { formatBJDateTime } from "@/app/utils/date";
import { MarketHeader } from "./MarketHeader";
import { MarketCountdown } from "./MarketCountdown";
import { ResolutionBadge } from "./ResolutionBadge";
import { ClaimWinnings } from "./ClaimWinnings";
import { MarketCard } from "./MarketCard";
import { TradePanel } from "../trading/TradePanel";
import { OrderbookPanel } from "../trading/OrderbookPanel";
import { LiquidityPanel } from "../trading/LiquidityPanel";
import { CommentSection } from "./CommentSection";
import { PriceChart } from "./PriceChart";
import { finalizeSettlement, getSettlement, proposeSettlement, fetchMarketActivity, fetchRelatedMarkets, fetchMarket } from "@/app/services/api";
import { subscribeMarket, unsubscribeMarket } from "@/app/services/ws";
import type { MarketActivity } from "@/app/services/api";
import type { Market as MarketType } from "@/app/types/market.types";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { PREDICTION_MARKET_ABI, PREDICTION_MARKET_ADDRESS } from "@/app/config/contracts";
import { getBscScanUrl } from "@/app/hooks/useContracts";

interface MarketOptionDisplay {
  id: string;
  optionIndex: number;
  label: string;
  color: string;
  price: number;
  reserve: number;
}

interface Market {
  id: string;
  onChainMarketId?: string;
  title: string;
  category: string;
  categoryEmoji: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  participants: number;
  endTime: string;
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved" | "expired";
  description?: string;
  resolution?: string;
  resolutionType?: string;
  oraclePair?: string;
  targetPrice?: number;
  resolvedOutcome?: string;
  marketType?: "binary" | "multi";
  options?: MarketOptionDisplay[];
  totalLiquidity?: number;
}

interface MarketDetailProps {
  market: Market;
  userPosition?: {
    side: string;
    shares: number;
    avgCost: number;
  };
}

/** Format a timestamp (ms epoch) to relative time string (i18n-aware) */
function timeAgo(timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t('notification.justNow');
  if (diff < 3_600_000) return t('notification.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('notification.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('notification.daysAgo', { count: Math.floor(diff / 86_400_000) });
}

/** Truncate address to 0x1234...abcd */
function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function MarketDetail({ market, userPosition }: MarketDetailProps) {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const authAddress = useAuthStore((s) => s.address);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  // Live price state (overrides props when WS updates arrive)
  const [liveYesPrice, setLiveYesPrice] = useState(market.yesPrice);
  const [liveNoPrice, setLiveNoPrice] = useState(market.noPrice);
  const [liveVolume, setLiveVolume] = useState(market.volume);
  const [liveParticipants, setLiveParticipants] = useState(market.participants);

  // Sync from props when market changes (e.g. navigating between markets)
  useEffect(() => {
    setLiveYesPrice(market.yesPrice);
    setLiveNoPrice(market.noPrice);
    setLiveVolume(market.volume);
    setLiveParticipants(market.participants);
  }, [market.id, market.yesPrice, market.noPrice, market.volume, market.participants]);

  // Subscribe to WebSocket price updates
  useEffect(() => {
    const handler = (data: any) => {
      if (data.marketId !== market.id) return;
      if (data.type === 'price_update') {
        setLiveYesPrice(data.yesPrice);
        setLiveNoPrice(data.noPrice);
      }
    };
    subscribeMarket(market.id, handler);
    return () => { unsubscribeMarket(market.id, handler); };
  }, [market.id]);

  // Callback when a trade completes -- refetch market data
  const handleTradeComplete = useCallback(() => {
    fetchMarket(market.id).then((m) => {
      setLiveVolume(m.volume);
      setLiveParticipants(m.participants);
      setLiveYesPrice(m.yesPrice);
      setLiveNoPrice(m.noPrice);
    }).catch((e) => { console.warn('[MarketDetail] Failed to refresh after trade:', e.message) });
  }, [market.id]);

  // Build a live version of market for child components
  const liveMarket = { ...market, yesPrice: liveYesPrice, noPrice: liveNoPrice, volume: liveVolume, participants: liveParticipants };
  const [settlement, setSettlement] = useState<{
    resolution_type?: string;
    oracle_pair?: string;
    target_price?: number;
    resolved_price?: number;
    outcome?: string;
    resolved_at?: string;
  } | null>(null);
  const [settlementData, setSettlementData] = useState<{
    resolution?: Record<string, unknown> | null;
    proposals?: Record<string, unknown>[];
    challenges?: Record<string, unknown>[];
    logs?: Record<string, unknown>[];
  } | null>(null);
  const [activity, setActivity] = useState<MarketActivity[]>([]);
  const [relatedMarkets, setRelatedMarkets] = useState<MarketType[]>([]);

  const isResolved =
    market.status === "resolved" || market.status === "settled";
  const isPending = market.status === "pending_resolution";
  const isLowLiquidity = market.volume < 1000 || (market.totalLiquidity != null && market.totalLiquidity < 5000);

  // Compute effective status for display
  const effectiveStatusInfo = (() => {
    if (isResolved) {
      const outcomeLabel = market.resolvedOutcome ? ` (${market.resolvedOutcome})` : "";
      return { label: `${t("market.status.resolved")}${outcomeLabel}`, className: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30" };
    }
    if (isPending) {
      return { label: t("market.status.pending"), className: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
    }
    if (market.status === "expired") {
      return { label: t("market.status.expired"), className: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
    }
    const now = Date.now();
    const end = new Date(market.endTime).getTime();
    const diff = end - now;
    if (diff <= 0) {
      return { label: t("market.status.expired"), className: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return { label: t("market.status.expiring"), className: "bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse" };
    }
    return { label: t("market.status.active"), className: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" };
  })();

  const refreshSettlement = useCallback(() => {
    if (isResolved || isPending) {
      getSettlement(market.id)
        .then((data) => {
          setSettlement(data.resolution ?? null);
          setSettlementData({
            resolution: data.resolution ?? null,
            proposals: Array.isArray(data.proposals) ? data.proposals as Record<string, unknown>[] : [],
            challenges: Array.isArray(data.challenges) ? data.challenges as Record<string, unknown>[] : [],
            logs: Array.isArray(data.logs) ? data.logs as Record<string, unknown>[] : [],
          });
        })
        .catch((e) => { console.warn('[MarketDetail] Failed to load settlement:', e.message) });
    }
  }, [market.id, isResolved, isPending]);

  useEffect(() => {
    refreshSettlement();
  }, [refreshSettlement]);

  // Fetch recent activity
  useEffect(() => {
    fetchMarketActivity(market.id)
      .then(setActivity)
      .catch((e) => { console.warn('[MarketDetail] Failed to load activity:', e.message) });
  }, [market.id]);

  // Fetch related markets
  useEffect(() => {
    fetchRelatedMarkets(market.id)
      .then(setRelatedMarkets)
      .catch((e) => { console.warn('[MarketDetail] Failed to load related markets:', e.message) });
  }, [market.id]);

  const resolutionType =
    settlement?.resolution_type ?? market.resolutionType;
  const outcome =
    settlement?.outcome ?? market.resolvedOutcome;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
      {/* Left Column */}
      <div className="lg:col-span-8 space-y-4 sm:space-y-6">
        {/* Header */}
        <MarketHeader market={liveMarket} />

        {/* Status + Countdown + Resolution Badge */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Lifecycle status badge */}
          <span className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold ${effectiveStatusInfo.className}`}>
            {effectiveStatusInfo.label}
          </span>
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

        {/* Low Liquidity Warning */}
        {isLowLiquidity && !isResolved && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-amber-400">{t('market.lowLiquidityWarning')}</h4>
                <p className="text-amber-300/60 text-xs mt-0.5">
                  {t('market.lowLiquidityDesc', { volume: market.volume < 1000 ? ` ($${market.volume.toFixed(0)})` : "" })}
                </p>
              </div>
            </div>
          </motion.div>
        )}

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
            <p className="text-amber-300/50 text-xs mt-1">
              {t('market.autoSettlementHint')}
            </p>
          </motion.div>
        )}

        {isAdmin && !isResolved && (
          <SettlementActionPanel
            market={market}
            settlementData={settlementData}
            authAddress={authAddress}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            onUpdated={refreshSettlement}
          />
        )}

        {/* Settlement info (when resolved) */}
        {isResolved && settlement && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-blue-400" />
              <h3 className="text-lg font-bold text-foreground">{t('market.settlementInfo')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">{t('market.settlementMethod')}</span>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  {settlement.resolution_type === "manual" ? (
                    <>
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      {t('market.manualSettlement')}
                    </>
                  ) : settlement.resolution_type === "price_above" || settlement.resolution_type === "price_below" ? (
                    <>
                      <Bot className="w-3.5 h-3.5 text-blue-400" />
                      {t('market.oracleSettlement')}
                    </>
                  ) : (
                    <>
                      <Bot className="w-3.5 h-3.5 text-emerald-400" />
                      {t('resolved.autoSettlement')}
                    </>
                  )}
                </div>
              </div>
              {settlement.oracle_pair && (
                <div>
                  <span className="text-muted-foreground block mb-1">{t('market.tradingPair')}</span>
                  <span className="text-muted-foreground font-mono">
                    {settlement.oracle_pair}
                  </span>
                </div>
              )}
              {settlement.resolved_price != null && (
                <div>
                  <span className="text-muted-foreground block mb-1">{t('market.settlementPrice')}</span>
                  <span className="text-blue-400 font-mono font-bold">
                    $
                    {settlement.resolved_price.toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {settlement.resolved_at && (
                <div>
                  <span className="text-muted-foreground block mb-1">{t('market.settlementTime')}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatBJDateTime(settlement.resolved_at)}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Price Chart */}
        <div className="bg-card border border-border p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm sm:text-base font-bold text-foreground">{t('market.probTrend')}</h2>
          </div>
          <div className="w-full overflow-x-auto">
            <PriceChart marketId={market.id} marketType={market.marketType} options={market.options} />
          </div>
        </div>

        {/* Description */}
        {market.description && (
          <div className="bg-card border border-border p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-blue-400" />
              <h2 className="text-sm sm:text-base font-bold text-foreground">{t('market.description')}</h2>
            </div>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {market.description}
            </p>
          </div>
        )}

        {/* Resolution Rules */}
        {market.resolution && (
          <div className="bg-card border border-border p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-blue-400" />
              <h2 className="text-sm sm:text-base font-bold text-foreground">{t('market.resolutionRules')}</h2>
            </div>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {market.resolution}
            </p>
          </div>
        )}

        {/* Recent Activity */}
        <RecentActivitySection activity={activity} />

        {/* Market Discussion */}
        <CommentSection marketId={market.id} />

        {/* Related Markets */}
        {relatedMarkets.length > 0 && (
          <RelatedMarketsSection markets={relatedMarkets} />
        )}
      </div>

      {/* Right Column */}
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-24 space-y-4 sm:space-y-6">
          {/* Low liquidity inline warning near trade panel */}
          {isLowLiquidity && !isResolved && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/25 rounded-lg text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{t('market.lowLiquidityCaution')}</span>
            </div>
          )}
          {isResolved && outcome ? (
            /* Show ClaimWinnings + LP claim when resolved */
            <>
              <ClaimWinnings
                marketId={market.id}
                onChainMarketId={market.onChainMarketId}
                outcome={outcome}
                userPosition={userPosition}
              />
              <LiquidityPanel
                marketId={market.id}
                onChainMarketId={market.onChainMarketId}
                status={market.status}
                onLiquidityChange={handleTradeComplete}
              />
            </>
          ) : (
            /* Show trading panels when active */
            <>
              <TradePanel
                marketId={market.id}
                onChainMarketId={market.onChainMarketId}
                marketTitle={market.title}
                status={market.status}
                marketType={market.marketType}
                options={market.options}
                onTradeComplete={handleTradeComplete}
              />
              <OrderbookPanel
                marketId={market.id}
              />
              <LiquidityPanel
                marketId={market.id}
                onChainMarketId={market.onChainMarketId}
                status={market.status}
                onLiquidityChange={handleTradeComplete}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface SettlementActionPanelProps {
  market: Market;
  settlementData: {
    resolution?: Record<string, unknown> | null;
    proposals?: Record<string, unknown>[];
    challenges?: Record<string, unknown>[];
    logs?: Record<string, unknown>[];
  } | null;
  authAddress: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  onUpdated: () => void;
}

function SettlementActionPanel({
  market,
  settlementData,
  authAddress,
  isAuthenticated,
  isAdmin,
  onUpdated,
}: SettlementActionPanelProps) {
  const { t } = useTranslation();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const isMulti = market.marketType === "multi" && Array.isArray(market.options) && market.options.length > 0;
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [winningOptionId, setWinningOptionId] = useState<string>(
    (market.options && market.options.length > 0) ? market.options[0].id : ""
  );
  const [busy, setBusy] = useState(false);

  if (isMulti) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-300"
      >
        {t("settlement.multiMarketNotSupported", { defaultValue: "Multi-option market settlement is not yet supported in the UI." })}
      </motion.div>
    );
  }

  async function handleSettle() {
    if (!isAuthenticated || !isAdmin) return;
    if (!publicClient) {
      toast.error(t("settlement.walletClientUnavailable", { defaultValue: "Wallet client unavailable" }));
      return;
    }

    let onChainMarketId: bigint;
    try {
      onChainMarketId = BigInt(market.onChainMarketId);
    } catch {
      toast.error(t("settlement.invalidOnChainMarketId", { defaultValue: "Invalid on-chain market ID" }));
      return;
    }

    setBusy(true);
    try {
      // Step 1: Send on-chain adminFinalizeResolution tx (admin can override outcome, accepts 2 args)
      const txHash = await writeContractAsync({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: "adminFinalizeResolution",
        args: [onChainMarketId, outcome === "yes"],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("On-chain transaction reverted");
      }

      // Step 2: Propose + finalize on backend in one flow
      const proposeRes = await proposeSettlement(market.id, {
        outcome: isMulti ? undefined : outcome,
        winningOptionId: isMulti ? winningOptionId : undefined,
        resolveTxHash: txHash,
        challengeWindowHours: 0,
      });

      const proposalId = proposeRes?.proposal?.id;
      if (proposalId) {
        await finalizeSettlement(market.id, {
          proposalId,
          outcome: isMulti ? undefined : outcome,
          winningOptionId: isMulti ? winningOptionId : undefined,
          resolveTxHash: txHash,
        });
      }

      const scanUrl = getBscScanUrl(chainId);
      toast.success(t("settlement.marketFinalized", { defaultValue: "Market settled successfully" }), {
        action: {
          label: "BscScan",
          onClick: () => window.open(`${scanUrl}/tx/${txHash}`, "_blank"),
        },
      });
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border p-4 sm:p-6 space-y-4"
    >
      <div>
        <h3 className="text-sm sm:text-base font-bold text-foreground">{t("settlement.settleMarket", { defaultValue: "Settle Market" })}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settlement.settleDesc", { defaultValue: "Select the winning outcome and settle on-chain." })}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as "yes" | "no")}
          className="bg-input-background border border-border text-foreground text-sm py-2 px-3 flex-1"
        >
          <option value="yes">YES</option>
          <option value="no">NO</option>
        </select>
        <button
          onClick={handleSettle}
          disabled={busy || !isAuthenticated}
          className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? t("settlement.settling", { defaultValue: "Settling..." }) : t("settlement.settle", { defaultValue: "Settle" })}
        </button>
      </div>
    </motion.div>
  );
}

/** Recent Activity Section */
function RecentActivitySection({ activity }: { activity: MarketActivity[] }) {
  const { t } = useTranslation();
  if (activity.length === 0) return null;

  return (
    <div className="bg-card border border-border p-6 rounded-xl">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-bold text-foreground">{t('market.recentActivity')}</h2>
        <span className="text-xs text-muted-foreground ml-auto">{t('market.tradesCount', { count: activity.length })}</span>
      </div>
      <div className="space-y-0 divide-y divide-border">
        {activity.map((item) => (
          <div key={item.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                item.type === "sell"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-emerald-500/20 text-emerald-400"
              }`}>
                {item.type === "sell" ? t('market.tradeSell') : t('market.tradeBuy')}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${
                    item.side === "yes" ? "text-emerald-400" : item.side === "no" ? "text-red-400" : "text-blue-400"
                  }`}>
                    {item.optionLabel ?? item.side.toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {truncateAddress(item.userAddress)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <div className="text-sm font-mono font-semibold text-foreground">
                  ${item.amount.toFixed(2)}
                </div>
                {item.shares > 0 && (
                  <div className="text-xs text-muted-foreground font-mono">
                    {item.shares.toFixed(2)} shares
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-[60px] justify-end">
                <Clock className="w-3 h-3" />
                {timeAgo(item.createdAt, t)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Related Markets Section */
function RelatedMarketsSection({ markets }: { markets: MarketType[] }) {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();

  // Map MarketType to the MarketCard's Market interface
  const toCardMarket = (m: MarketType) => ({
    id: m.id,
    title: m.title,
    category: m.category,
    categoryEmoji: "",
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    volume: m.volume,
    participants: m.participants,
    endTime: m.endTime,
    status: (m.status === "pending" || m.status === "pending_resolution" ? "pending_resolution" : m.status === "closed" || m.status === "resolved" ? "settled" : "active") as "active" | "settled" | "pending_resolution",
    resolvedOutcome: m.resolvedOutcome,
    marketType: m.marketType,
    options: m.options,
    totalLiquidity: m.totalLiquidity,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-foreground">{t('market.relatedMarkets')}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {markets.map((m) => (
          <MarketCard
            key={m.id}
            market={toCardMarket(m)}
            size="compact"
            onClick={() => navigate(`/market/${m.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
