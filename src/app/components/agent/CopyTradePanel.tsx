import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  startCopyTrading,
  stopCopyTrading,
  updateCopySettings,
  getCopyStatus,
} from "@/app/services/api";

interface CopyTradePanelProps {
  agentId: string;
  isOwner: boolean;
}

export function CopyTradePanel({ agentId, isOwner }: CopyTradePanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [follower, setFollower] = useState<any>(null);
  const [copyPercentage, setCopyPercentage] = useState(50);
  const [maxPerTrade, setMaxPerTrade] = useState("50");
  const [dailyLimit, setDailyLimit] = useState("500");

  const isActive = follower?.status === "active";

  useEffect(() => {
    getCopyStatus(agentId)
      .then((data) => {
        if (data.follower) {
          setFollower(data.follower);
          setCopyPercentage(data.follower.copy_percentage || 50);
          setMaxPerTrade(String(data.follower.max_per_trade || 50));
          setDailyLimit(String(data.follower.daily_limit || 500));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const data = await startCopyTrading({
        agentId,
        copyPercentage,
        maxPerTrade: Number(maxPerTrade),
        dailyLimit: Number(dailyLimit),
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
      });
      setFollower(data.follower);
      toast.success(t("copyTrade.settingsSaved"));
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setActionLoading(false);
    }
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
    </div>
  );
}
