import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getAgentEarnings, claimEarnings } from "@/app/services/api";

interface EarningsDashboardProps {
  agentId: string;
}

export function EarningsDashboard({ agentId }: EarningsDashboardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [unclaimed, setUnclaimed] = useState(0);
  const [earnings, setEarnings] = useState<any[]>([]);

  const loadEarnings = () => {
    setLoading(true);
    getAgentEarnings(agentId)
      .then((data) => {
        setTotalEarnings(data.totalEarnings);
        setUnclaimed(data.unclaimed);
        setEarnings(data.earnings);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEarnings();
  }, [agentId]);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const result = await claimEarnings(agentId);
      if (result.success) {
        toast.success(t("earnings.claimSuccess", { amount: result.amount.toFixed(2) }));
        loadEarnings();
      }
    } catch (err: any) {
      toast.error(err.message || t("earnings.claimFailed"));
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-secondary border border-border p-6">
        <div className="text-muted-foreground text-center">{t("common.loading")}</div>
      </div>
    );
  }

  const claimed = totalEarnings - unclaimed;

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-secondary border border-border p-4">
          <div className="text-muted-foreground text-sm mb-1">{t("earnings.totalEarnings")}</div>
          <div className="text-xl font-bold font-mono text-emerald-400">
            ${totalEarnings.toFixed(2)}
          </div>
        </div>
        <div className="bg-secondary border border-border p-4">
          <div className="text-muted-foreground text-sm mb-1">{t("earnings.unclaimed")}</div>
          <div className="text-xl font-bold font-mono text-blue-400">${unclaimed.toFixed(2)}</div>
        </div>
        <div className="bg-secondary border border-border p-4">
          <div className="text-muted-foreground text-sm mb-1">{t("earnings.claimed")}</div>
          <div className="text-xl font-bold font-mono text-muted-foreground">
            ${claimed.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Claim button */}
      {unclaimed >= 0.01 && (
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="w-full py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold transition-colors"
        >
          {claiming ? t("earnings.claiming") : t("earnings.claim")} (${unclaimed.toFixed(2)})
        </button>
      )}

      {/* Earnings history */}
      <div className="bg-secondary border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="font-bold">{t("earnings.title")}</h3>
        </div>
        {earnings.length > 0 ? (
          <div className="divide-y divide-border">
            {earnings.map((earning: any) => (
              <div
                key={earning.id}
                className="flex items-center justify-between p-4 hover:bg-accent transition-colors"
              >
                <div>
                  <div className="text-sm text-foreground">
                    {t("earnings.source")}: {t("earnings.copyTrading")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(Number(earning.created_at)).toLocaleString("zh-CN")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold font-mono text-emerald-400">
                    +${Number(earning.amount).toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {earning.claimed ? t("earnings.claimed") : t("earnings.unclaimed")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-muted-foreground">{t("earnings.noEarnings")}</div>
        )}
      </div>
    </div>
  );
}
