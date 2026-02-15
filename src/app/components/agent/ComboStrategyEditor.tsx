import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { setComboStrategy, getAgent } from "@/app/services/api";

interface ComboStrategyEditorProps {
  agentId: string;
}

const STRATEGIES = ["conservative", "aggressive", "contrarian", "momentum", "random"] as const;

export function ComboStrategyEditor({ agentId }: ComboStrategyEditorProps) {
  const { t } = useTranslation();
  const [weights, setWeights] = useState<Record<string, number>>({
    conservative: 20,
    aggressive: 20,
    contrarian: 20,
    momentum: 20,
    random: 20,
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAgent(agentId)
      .then((agent: any) => {
        if (agent.combo_weights) {
          try {
            const parsed =
              typeof agent.combo_weights === "string"
                ? JSON.parse(agent.combo_weights)
                : agent.combo_weights;
            if (parsed && typeof parsed === "object") {
              setWeights((prev) => ({ ...prev, ...parsed }));
            }
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [agentId]);

  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const handleChange = (key: string, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, value)) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await setComboStrategy(agentId, weights);
      if (result.weights) {
        setWeights(result.weights);
      }
      toast.success(t("comboStrategy.saved"));
    } catch (err: any) {
      toast.error(err.message || t("comboStrategy.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="bg-secondary border border-border p-6">
        <div className="text-muted-foreground text-center">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="bg-secondary border border-border p-6 space-y-4">
      <div>
        <h3 className="text-lg font-bold">{t("comboStrategy.title")}</h3>
        <p className="text-muted-foreground text-sm mt-1">{t("comboStrategy.subtitle")}</p>
      </div>

      <div className="space-y-3">
        {STRATEGIES.map((strat) => (
          <div key={strat} className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-foreground">
                {t(`comboStrategy.${strat}`)}
              </label>
              <span className="text-sm font-mono text-muted-foreground">{weights[strat]}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weights[strat]}
              onChange={(e) => handleChange(strat, Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
        ))}
      </div>

      {/* Total bar */}
      <div className="flex items-center justify-between p-3 bg-muted/50 border border-border">
        <span className="text-sm text-muted-foreground">{t("comboStrategy.total")}</span>
        <span
          className={`text-sm font-bold font-mono ${
            total === 100 ? "text-emerald-400" : total === 0 ? "text-muted-foreground" : "text-blue-400"
          }`}
        >
          {total}%
          {total !== 100 && total > 0 && (
            <span className="text-xs text-muted-foreground ml-1">(auto-normalize)</span>
          )}
        </span>
      </div>

      {/* Visual breakdown */}
      <div className="flex h-3 overflow-hidden bg-muted/30 border border-border">
        {total > 0 &&
          STRATEGIES.map((strat) => {
            const pct = (weights[strat] / total) * 100;
            if (pct <= 0) return null;
            const colors: Record<string, string> = {
              conservative: "bg-blue-500",
              aggressive: "bg-red-500",
              contrarian: "bg-purple-500",
              momentum: "bg-emerald-500",
              random: "bg-zinc-500",
            };
            return (
              <div
                key={strat}
                className={`${colors[strat]} transition-all duration-300`}
                style={{ width: `${pct}%` }}
                title={`${t(`comboStrategy.${strat}`)}: ${Math.round(pct)}%`}
              />
            );
          })}
      </div>

      <button
        onClick={handleSave}
        disabled={saving || total === 0}
        className="w-full py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
      >
        {saving ? t("common.loading") : t("comboStrategy.save")}
      </button>
    </div>
  );
}
