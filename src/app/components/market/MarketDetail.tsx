"use client";

import { motion } from "motion/react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, FileText, Scale, Info, Bot, User, AlertTriangle, Activity, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MarketHeader } from "./MarketHeader";
import { MarketCountdown } from "./MarketCountdown";
import { ResolutionBadge } from "./ResolutionBadge";
import { ClaimWinnings } from "./ClaimWinnings";
import { MarketCard } from "./MarketCard";
import { TradePanel } from "../trading/TradePanel";
import { OrderBook } from "../trading/OrderBook";
import { LimitOrderForm } from "../trading/LimitOrderForm";
import { OpenOrders } from "../trading/OpenOrders";
import { CommentSection } from "./CommentSection";
import { PriceChart } from "./PriceChart";
import { challengeSettlement, finalizeSettlement, getSettlement, proposeSettlement, fetchMarketActivity, fetchRelatedMarkets } from "@/app/services/api";
import type { MarketActivity } from "@/app/services/api";
import type { Market as MarketType } from "@/app/types/market.types";
import { useAuthStore } from "@/app/stores/useAuthStore";

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
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved";
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

/** Format a timestamp (ms epoch) to relative time string */
function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Truncate address to 0x1234...abcd */
function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function MarketDetail({ market, userPosition }: MarketDetailProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authAddress = useAuthStore((s) => s.address);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [prefilledPrice, setPrefilledPrice] = useState<number | undefined>();
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
      return { label: `Settled${outcomeLabel}`, className: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30" };
    }
    if (isPending) {
      return { label: "Pending Settlement", className: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
    }
    const now = Date.now();
    const end = new Date(market.endTime).getTime();
    const diff = end - now;
    if (diff <= 0) {
      return { label: "Expired", className: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return { label: "Expiring Soon", className: "bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse" };
    }
    return { label: "Trading", className: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" };
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
        .catch(() => {});
    }
  }, [market.id, isResolved, isPending]);

  useEffect(() => {
    refreshSettlement();
  }, [refreshSettlement]);

  // Fetch recent activity
  useEffect(() => {
    fetchMarketActivity(market.id)
      .then(setActivity)
      .catch(() => {});
  }, [market.id]);

  // Fetch related markets
  useEffect(() => {
    fetchRelatedMarkets(market.id)
      .then(setRelatedMarkets)
      .catch(() => {});
  }, [market.id]);

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

        {/* Status + Countdown + Resolution Badge */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Lifecycle status badge */}
          <span className={`flex items-center gap-1.5 px-4 py-2 text-sm font-bold ${effectiveStatusInfo.className}`}>
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
                <h4 className="text-sm font-bold text-amber-400">Low Liquidity Warning</h4>
                <p className="text-amber-300/60 text-xs mt-0.5">
                  This market has low trading volume{market.volume < 1000 ? ` ($${market.volume.toFixed(0)})` : ""} and/or limited liquidity. Large orders may experience significant price impact.
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

        {(isPending || (market.status === "active" && new Date(market.endTime).getTime() <= Date.now())) && (
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
                    {new Date(settlement.resolved_at).toLocaleString()}
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
          className="bg-card border border-border p-8"
        >
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-bold text-foreground">{t('market.probTrend')}</h2>
          </div>
          <PriceChart marketId={market.id} marketType={market.marketType} options={market.options} />
        </motion.div>

        {/* Description */}
        {market.description && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card border border-border p-8"
          >
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-blue-400" />
              <h2 className="text-xl font-bold text-foreground">{t('market.description')}</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed">
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
            className="bg-card border border-border p-8"
          >
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-blue-400" />
              <h2 className="text-xl font-bold text-foreground">{t('market.resolutionRules')}</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              {market.resolution}
            </p>
          </motion.div>
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
        <div className="lg:sticky lg:top-24 space-y-6">
          {/* Low liquidity inline warning near trade panel */}
          {isLowLiquidity && !isResolved && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/25 rounded-lg text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Low liquidity -- trade with caution</span>
            </div>
          )}
          {isResolved && outcome ? (
            /* Show ClaimWinnings when resolved */
            <ClaimWinnings
              marketId={market.id}
              onChainMarketId={market.onChainMarketId}
              outcome={outcome}
              userPosition={userPosition}
            />
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
  const isMulti = market.marketType === "multi" && Array.isArray(market.options) && market.options.length > 0;
  const [proposeOutcome, setProposeOutcome] = useState<"yes" | "no">("yes");
  const [proposeWinningOptionId, setProposeWinningOptionId] = useState<string>(market.options?.[0]?.id ?? "");
  const [proposeTxHash, setProposeTxHash] = useState("");
  const [proposeEvidenceUrl, setProposeEvidenceUrl] = useState("");
  const [challengeReason, setChallengeReason] = useState("");
  const [finalizeOutcome, setFinalizeOutcome] = useState<"yes" | "no">("yes");
  const [finalizeWinningOptionId, setFinalizeWinningOptionId] = useState<string>(market.options?.[0]?.id ?? "");
  const [finalizeTxHash, setFinalizeTxHash] = useState("");
  const [busy, setBusy] = useState<"" | "propose" | "challenge" | "finalize">("");

  if (isMulti) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-300"
      >
        当前链上仲裁流程仅支持二元市场（YES/NO）。多选市场请勿使用链上仲裁入口。
      </motion.div>
    );
  }

  const proposals = Array.isArray(settlementData?.proposals) ? settlementData!.proposals! : [];
  const activeProposal = (proposals.find((p) => {
    const status = String(p.status || "").toLowerCase();
    return status === "proposed" || status === "challenged";
  }) || null) as Record<string, unknown> | null;

  const challengeWindowEndsAt = Number(activeProposal?.challenge_window_ends_at ?? 0);
  const challengeOpen = challengeWindowEndsAt > Date.now();
  const proposalId = String(activeProposal?.id ?? "");
  const proposalOwner = String(activeProposal?.proposed_by ?? "").toLowerCase();
  const canChallenge = Boolean(
    isAuthenticated &&
    activeProposal &&
    challengeOpen &&
    authAddress &&
    authAddress.toLowerCase() !== proposalOwner,
  );

  async function handlePropose() {
    if (!isAuthenticated) {
      toast.error("Please connect wallet first");
      return;
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(proposeTxHash.trim())) {
      toast.error("请输入有效的链上 resolve/finalize 交易哈希");
      return;
    }
    if (isMulti && !proposeWinningOptionId) {
      toast.error("请选择获胜选项");
      return;
    }

    setBusy("propose");
    try {
      await proposeSettlement(market.id, {
        outcome: isMulti ? undefined : proposeOutcome,
        winningOptionId: isMulti ? proposeWinningOptionId : undefined,
        evidenceUrl: proposeEvidenceUrl.trim() || undefined,
        resolveTxHash: proposeTxHash.trim(),
      });
      toast.success("Proposal submitted");
      setProposeTxHash("");
      setProposeEvidenceUrl("");
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit proposal");
    } finally {
      setBusy("");
    }
  }

  async function handleChallenge() {
    if (!canChallenge || !proposalId) return;
    if (challengeReason.trim().length < 10) {
      toast.error("Challenge reason must be at least 10 characters");
      return;
    }

    setBusy("challenge");
    try {
      await challengeSettlement(market.id, {
        proposalId,
        reason: challengeReason.trim(),
      });
      toast.success("Challenge submitted");
      setChallengeReason("");
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit challenge");
    } finally {
      setBusy("");
    }
  }

  async function handleFinalize() {
    if (!isAuthenticated) {
      toast.error("Please connect wallet first");
      return;
    }
    if (!proposalId) {
      toast.error("No active proposal to finalize");
      return;
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(finalizeTxHash.trim())) {
      toast.error("请输入 finalizeResolution 对应的链上交易哈希");
      return;
    }
    if (isMulti && !finalizeWinningOptionId) {
      toast.error("请选择获胜选项");
      return;
    }

    setBusy("finalize");
    try {
      await finalizeSettlement(market.id, {
        proposalId,
        outcome: isMulti ? undefined : finalizeOutcome,
        winningOptionId: isMulti ? finalizeWinningOptionId : undefined,
        resolveTxHash: finalizeTxHash.trim(),
      });
      toast.success("Market finalized");
      setFinalizeTxHash("");
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to finalize");
    } finally {
      setBusy("");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border p-6 space-y-4"
    >
      <div>
        <h3 className="text-base font-bold text-foreground">Arbitration Actions</h3>
        <p className="text-xs text-muted-foreground mt-1">
          提案、挑战、终裁。finalize 需要管理员权限，且需提交链上 finalizeResolution 交易哈希。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {!isMulti ? (
          <select
            value={proposeOutcome}
            onChange={(e) => setProposeOutcome(e.target.value as "yes" | "no")}
            className="bg-input-background border border-border text-foreground text-sm py-2 px-3"
          >
            <option value="yes">YES</option>
            <option value="no">NO</option>
          </select>
        ) : (
          <select
            value={proposeWinningOptionId}
            onChange={(e) => setProposeWinningOptionId(e.target.value)}
            className="bg-input-background border border-border text-foreground text-sm py-2 px-3"
          >
            {(market.options || []).map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        )}
        <input
          value={proposeTxHash}
          onChange={(e) => setProposeTxHash(e.target.value)}
          placeholder="resolve/finalize tx hash (0x...)"
          className="bg-input-background border border-border text-foreground text-sm py-2 px-3"
        />
        <input
          value={proposeEvidenceUrl}
          onChange={(e) => setProposeEvidenceUrl(e.target.value)}
          placeholder="Evidence URL (optional)"
          className="bg-input-background border border-border text-foreground text-sm py-2 px-3 md:col-span-2"
        />
      </div>
      <button
        onClick={handlePropose}
        disabled={busy !== "" || !isAuthenticated}
        className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold disabled:opacity-50"
      >
        {busy === "propose" ? "Submitting..." : "Submit Proposal"}
      </button>

      {activeProposal && (
        <div className="border-t border-border pt-4 space-y-3">
          <div className="text-xs text-muted-foreground">
            Active proposal: <span className="text-foreground font-mono">{proposalId}</span>
            {challengeWindowEndsAt > 0 && (
              <> | Challenge window ends: {new Date(challengeWindowEndsAt).toLocaleString()}</>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={challengeReason}
              onChange={(e) => setChallengeReason(e.target.value)}
              placeholder="Challenge reason (>=10 chars)"
              className="bg-input-background border border-border text-foreground text-sm py-2 px-3 md:col-span-2"
            />
          </div>
          <button
            onClick={handleChallenge}
            disabled={busy !== "" || !canChallenge}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold disabled:opacity-50"
          >
            {busy === "challenge" ? "Submitting..." : "Submit Challenge"}
          </button>

          {isAdmin ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {!isMulti ? (
                  <select
                    value={finalizeOutcome}
                    onChange={(e) => setFinalizeOutcome(e.target.value as "yes" | "no")}
                    className="bg-input-background border border-border text-foreground text-sm py-2 px-3"
                  >
                    <option value="yes">YES</option>
                    <option value="no">NO</option>
                  </select>
                ) : (
                  <select
                    value={finalizeWinningOptionId}
                    onChange={(e) => setFinalizeWinningOptionId(e.target.value)}
                    className="bg-input-background border border-border text-foreground text-sm py-2 px-3"
                  >
                    {(market.options || []).map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                )}
                <input
                  value={finalizeTxHash}
                  onChange={(e) => setFinalizeTxHash(e.target.value)}
                  placeholder="finalizeResolution tx hash"
                  className="bg-input-background border border-border text-foreground text-sm py-2 px-3"
                />
              </div>
              <button
                onClick={handleFinalize}
                disabled={busy !== "" || !isAuthenticated || challengeOpen}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold disabled:opacity-50"
              >
                {busy === "finalize" ? "Finalizing..." : "Finalize (Admin)"}
              </button>
            </>
          ) : (
            <div className="text-xs text-muted-foreground pt-1">
              Finalize is restricted to admin accounts.
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** Recent Activity Section */
function RecentActivitySection({ activity }: { activity: MarketActivity[] }) {
  if (activity.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="bg-card border border-border p-6 rounded-xl"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-bold text-foreground">Recent Activity</h2>
        <span className="text-xs text-muted-foreground ml-auto">{activity.length} trades</span>
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
                {item.type === "sell" ? "SELL" : "BUY"}
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
                {timeAgo(item.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/** Related Markets Section */
function RelatedMarketsSection({ markets }: { markets: MarketType[] }) {
  const navigate = useNavigate();

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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="space-y-4"
    >
      <h2 className="text-lg font-bold text-foreground">Related Markets</h2>
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
    </motion.div>
  );
}
