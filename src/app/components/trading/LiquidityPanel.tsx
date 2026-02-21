"use client";

import { useState, useEffect, useCallback } from "react";
import { Droplets, Plus, Minus, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getLpInfo, addLiquidity, removeLiquidity } from "@/app/services/api";
import type { LpInfo } from "@/app/services/api";
import { useAuthStore } from "@/app/stores/useAuthStore";

interface LiquidityPanelProps {
  marketId: string;
  status: string;
  onLiquidityChange?: () => void;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function LiquidityPanel({ marketId, status, onLiquidityChange }: LiquidityPanelProps) {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [lpInfo, setLpInfo] = useState<LpInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [expanded, setExpanded] = useState(false);

  const fetchLp = useCallback(() => {
    setLoading(true);
    getLpInfo(marketId)
      .then(setLpInfo)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [marketId]);

  useEffect(() => { fetchLp(); }, [fetchLp]);

  const isActive = status === "active";

  const handleSubmit = async () => {
    const val = Number(amount);
    if (!val || val <= 0) return;
    setSubmitting(true);
    try {
      if (mode === "add") {
        const res = await addLiquidity(marketId, val);
        toast.success(t('lp.addSuccess', `Added liquidity, received ${res.lpShares.toFixed(2)} LP shares`));
      } else {
        const res = await removeLiquidity(marketId, val);
        toast.success(t('lp.removeSuccess', `Removed ${res.sharesRemoved.toFixed(2)} shares, received $${res.usdtOut.toFixed(2)}`));
      }
      setAmount("");
      fetchLp();
      onLiquidityChange?.();
    } catch (err: any) {
      toast.error(err.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-card border border-white/[0.08] rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Droplets className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold">{t('lp.title', 'Liquidity Pool')}</span>
        </div>
        <div className="flex items-center gap-2">
          {lpInfo && (
            <span className="text-xs text-muted-foreground font-mono">
              {formatUsd(lpInfo.poolValue)}
            </span>
          )}
          <span className="text-muted-foreground text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {loading && !lpInfo ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : lpInfo ? (
            <>
              {/* Pool Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">{t('lp.poolValue', 'Pool Value')}</div>
                  <div className="font-mono font-semibold">{formatUsd(lpInfo.poolValue)}</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">{t('lp.lpProviders', 'LP Providers')}</div>
                  <div className="font-mono font-semibold">{lpInfo.providers.length}</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">YES Reserve</div>
                  <div className="font-mono font-semibold text-emerald-400">{formatUsd(lpInfo.yesReserve)}</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">NO Reserve</div>
                  <div className="font-mono font-semibold text-red-400">{formatUsd(lpInfo.noReserve)}</div>
                </div>
              </div>

              {/* User LP Position */}
              {lpInfo.userShares > 0 && (
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{t('lp.yourShares', 'Your LP Shares')}</span>
                    <span className="font-mono font-semibold">{lpInfo.userShares.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground">{t('lp.yourValue', 'Your Value')}</span>
                    <span className="font-mono font-semibold text-blue-400">{formatUsd(lpInfo.userValue)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground">{t('lp.poolShare', 'Pool Share')}</span>
                    <span className="font-mono font-semibold">{(lpInfo.shareOfPool * 100).toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {/* Fee Info */}
              <div className="text-xs text-muted-foreground bg-white/[0.02] rounded-lg px-3 py-2">
                {t('lp.feeInfo', 'LP providers earn 80% of trading fees proportional to their share.')}
              </div>

              {/* Add/Remove Form */}
              {isActive && isAuthenticated && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setMode("add")}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        mode === "add"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.06]"
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      {t('lp.add', 'Add')}
                    </button>
                    <button
                      onClick={() => setMode("remove")}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        mode === "remove"
                          ? "bg-red-500/15 text-red-400 border border-red-500/30"
                          : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.06]"
                      }`}
                    >
                      <Minus className="w-3 h-3" />
                      {t('lp.remove', 'Remove')}
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={mode === "add" ? "USDT amount" : "LP shares"}
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500/40"
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !amount || Number(amount) <= 0}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm', 'Confirm')}
                    </button>
                  </div>

                  {mode === "remove" && lpInfo.userShares > 0 && (
                    <button
                      onClick={() => setAmount(lpInfo.userShares.toFixed(4))}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {t('lp.removeAll', 'Remove all')} ({lpInfo.userShares.toFixed(2)} shares)
                    </button>
                  )}
                </div>
              )}

              {/* Top Providers */}
              {lpInfo.providers.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">{t('lp.topProviders', 'Top Providers')}</div>
                  <div className="space-y-1">
                    {lpInfo.providers.slice(0, 5).map((p) => (
                      <div key={p.address} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground">
                          {p.address.slice(0, 6)}...{p.address.slice(-4)}
                        </span>
                        <span className="font-mono">
                          {formatUsd(p.value)} <span className="text-muted-foreground">({(p.shareOfPool * 100).toFixed(1)}%)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground py-2">{t('lp.unavailable', 'LP info unavailable')}</div>
          )}
        </div>
      )}
    </div>
  );
}
