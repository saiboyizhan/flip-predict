import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  startCopyTrading,
  stopCopyTrading,
  updateCopySettings,
  getCopyStatus,
  getPendingOnChainTrades,
  confirmOnChainTrade,
} from "@/app/services/api";
import { useAgentTakePosition } from "@/app/hooks/useNFAContracts";

interface CopyTradePanelProps {
  agentId: string;
  isOwner: boolean;
  agentTokenId?: bigint;
}

export function CopyTradePanel({ agentId, isOwner, agentTokenId }: CopyTradePanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [follower, setFollower] = useState<any>(null);
  const [copyPercentage, setCopyPercentage] = useState(50);
  const [maxPerTrade, setMaxPerTrade] = useState("50");
  const [dailyLimit, setDailyLimit] = useState("500");
  const [onChain, setOnChain] = useState(false);
  const [pendingTrades, setPendingTrades] = useState<any[]>([]);

  const { takePosition, txHash, isPending, isConfirming, isConfirmed, error: txError, reset: resetTx } = useAgentTakePosition();

  const isActive = follower?.status === "active";

  useEffect(() => {
    getCopyStatus(agentId)
      .then((data) => {
        if (data.follower) {
          setFollower(data.follower);
          setCopyPercentage(data.follower.copy_percentage || 50);
          setMaxPerTrade(String(data.follower.max_per_trade || 50));
          setDailyLimit(String(data.follower.daily_limit || 500));
          setOnChain(data.follower.on_chain === 1);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  // Load pending on-chain trades
  useEffect(() => {
    if (isActive && onChain) {
      getPendingOnChainTrades()
        .then((data) => setPendingTrades(data.trades || []))
        .catch(() => {});
    }
  }, [isActive, onChain]);

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed && txHash && pendingTrades.length > 0) {
      const currentTrade = pendingTrades[0];
      confirmOnChainTrade(currentTrade.id, txHash)
        .then(() => {
          toast.success("On-chain trade confirmed");
          setPendingTrades((prev) => prev.slice(1));
          resetTx();
        })
        .catch((err) => {
          toast.error(err.message || "Failed to confirm trade");
        });
    }
  }, [isConfirmed, txHash, pendingTrades, resetTx]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const data = await startCopyTrading({
        agentId,
        copyPercentage,
        maxPerTrade: Number(maxPerTrade),
        dailyLimit: Number(dailyLimit),
        onChain,
      });
      setFollower(data.follower);
      toast.success(t("copyTrade.started"));
    } catch (err: any) {
      toast.error(err.message || t("copyTrade.startFailed"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      const data = await stopCopyTrading(agentId);
      setFollower(data.follower);
      toast.success(t("copyTrade.stopped"));
    } catch (err: any) {
      toast.error(err.message || "Failed to stop");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setActionLoading(true);
    try {
      const data = await updateCopySettings({
        agentId,
        copyPercentage,
        maxPerTrade: Number(maxPerTrade),
        dailyLimit: Number(dailyLimit),
        onChain,
      });
      setFollower(data.follower);
      toast.success(t("copyTrade.settingsSaved"));
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setActionLoading(false);
    }
  };

  const handleExecutePendingTrade = () => {
    if (!agentTokenId || pendingTrades.length === 0) return;

    const trade = pendingTrades[0];
    const marketId = BigInt(trade.on_chain_market_id || 0);
    const side = trade.side === "yes" ? 0 : 1;
    const amount = String(trade.amount);

    takePosition(agentTokenId, marketId, side as 0 | 1, amount);
  };

  if (loading) {
    return (
      <div className="bg-secondary border border-border p-6">
        <div className="text-muted-foreground text-center">{t("common.loading")}</div>
      </div>
    );
  }

  // Owner can't copy their own agent
  if (isOwner) {
    return (
      <div className="bg-secondary border border-border p-6">
        <h3 className="text-lg font-bold mb-2">{t("copyTrade.title")}</h3>
        <p className="text-muted-foreground text-sm">{t("copyTrade.revenueShare")}</p>
      </div>
    );
  }

  return (
    <div className="bg-secondary border border-border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">{t("copyTrade.title")}</h3>
        <span
          className={`px-2 py-0.5 text-xs font-bold ${
            isActive
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30"
          }`}
        >
          {isActive ? t("copyTrade.active") : t("copyTrade.stopped")}
        </span>
      </div>

      {/* On-Chain Mode Toggle */}
      {!isActive && (
        <div className="flex items-center justify-between p-3 bg-zinc-900/50 border border-border">
          <div>
            <div className="text-sm font-medium">On-Chain Mode</div>
            <div className="text-xs text-muted-foreground">Execute trades on blockchain</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={onChain}
              onChange={(e) => setOnChain(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
          </label>
        </div>
      )}

      {/* Pending On-Chain Trades */}
      {isActive && onChain && pendingTrades.length > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30">
          <div className="text-sm font-medium text-amber-400 mb-2">
            Pending On-Chain Trade ({pendingTrades.length})
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            {pendingTrades[0].market_title} - {pendingTrades[0].side.toUpperCase()} {pendingTrades[0].amount} USDT
          </div>
          <button
            onClick={handleExecutePendingTrade}
            disabled={isPending || isConfirming || !agentTokenId}
            className="w-full py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
          >
            {isPending ? "Signing..." : isConfirming ? "Confirming..." : "Execute Trade"}
          </button>
          {txError && (
            <div className="mt-2 text-xs text-red-400">
              Error: {(txError as Error).message}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      <div className="space-y-3">
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            {t("copyTrade.copyPercentage")}: {copyPercentage}%
          </label>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={copyPercentage}
            onChange={(e) => setCopyPercentage(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>10%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              {t("copyTrade.maxPerTrade")}
            </label>
            <input
              type="number"
              value={maxPerTrade}
              onChange={(e) => setMaxPerTrade(e.target.value)}
              className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              {t("copyTrade.dailyLimit")}
            </label>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {isActive ? (
          <>
            <button
              onClick={handleSaveSettings}
              disabled={actionLoading}
              className="flex-1 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
            >
              {t("copyTrade.saveSettings")}
            </button>
            <button
              onClick={handleStop}
              disabled={actionLoading}
              className="px-4 py-2 border border-red-500/30 hover:border-red-500 text-red-400 text-sm transition-colors"
            >
              {t("copyTrade.stopCopy")}
            </button>
          </>
        ) : (
          <button
            onClick={handleStart}
            disabled={actionLoading}
            className="w-full py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
          >
            {t("copyTrade.startCopy")}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground border-t border-border pt-3">
        {t("copyTrade.buyHoldDisclaimer")}
      </p>
    </div>
  );
}
