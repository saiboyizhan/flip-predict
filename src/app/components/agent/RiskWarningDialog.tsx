import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { AlertTriangle, Shield, TrendingUp, TrendingDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface RiskWarningDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  suggestedSide: string;
  confidence: number;
  potentialProfit: number;
  potentialLoss: number;
  riskScore?: number;
  warnings?: string[];
  agentAccuracy?: number;
}

const RISK_CONFIG = {
  low: { color: 'emerald', labelKey: 'riskWarning.low', barWidth: '25%', bgColor: 'bg-emerald-500/20', textColor: 'text-emerald-400', borderColor: 'border-emerald-500/30' },
  medium: { color: 'amber', labelKey: 'riskWarning.medium', barWidth: '50%', bgColor: 'bg-amber-500/20', textColor: 'text-amber-400', borderColor: 'border-amber-500/30' },
  high: { color: 'orange', labelKey: 'riskWarning.high', barWidth: '75%', bgColor: 'bg-orange-500/20', textColor: 'text-orange-400', borderColor: 'border-orange-500/30' },
  extreme: { color: 'red', labelKey: 'riskWarning.extreme', barWidth: '100%', bgColor: 'bg-red-500/20', textColor: 'text-red-400', borderColor: 'border-red-500/30' },
};

export function RiskWarningDialog({
  open,
  onClose,
  onConfirm,
  riskLevel,
  suggestedSide,
  confidence,
  potentialProfit,
  potentialLoss,
  riskScore = 50,
  warnings = [],
  agentAccuracy,
}: RiskWarningDialogProps) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const config = RISK_CONFIG[riskLevel];
  const riskRewardRatio = potentialLoss > 0 ? (potentialProfit / potentialLoss) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-zinc-950 border border-zinc-800 overflow-hidden"
          >
            {/* Header */}
            <div className={`p-4 ${config.bgColor} border-b ${config.borderColor} flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-5 h-5 ${config.textColor}`} />
                <span className={`font-bold ${config.textColor}`}>{t('riskWarning.title')}</span>
              </div>
              <button onClick={onClose} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Risk Level Bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-500">{t('riskWarning.riskLevel')}</span>
                  <span className={config.textColor}>{t(config.labelKey)}</span>
                </div>
                <div className="h-2 bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      riskLevel === 'low' ? 'bg-emerald-500' :
                      riskLevel === 'medium' ? 'bg-amber-500' :
                      riskLevel === 'high' ? 'bg-orange-500' : 'bg-red-500'
                    }`}
                    style={{ width: config.barWidth }}
                  />
                </div>
              </div>

              {/* Trade Details */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-900 p-3 border border-zinc-800">
                  <div className="text-zinc-500 text-xs mb-1">{t('riskWarning.sugDirection')}</div>
                  <div className={`text-lg font-bold ${suggestedSide === 'yes' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {suggestedSide.toUpperCase()}
                  </div>
                </div>
                <div className="bg-zinc-900 p-3 border border-zinc-800">
                  <div className="text-zinc-500 text-xs mb-1">{t('riskWarning.agentConfidence')}</div>
                  <div className="text-lg font-bold text-amber-400 font-mono">{(confidence * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-zinc-900 p-3 border border-zinc-800">
                  <div className="text-zinc-500 text-xs mb-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-emerald-400" /> {t('riskWarning.potentialGain')}
                  </div>
                  <div className="text-lg font-bold text-emerald-400 font-mono">+${potentialProfit.toFixed(2)}</div>
                </div>
                <div className="bg-zinc-900 p-3 border border-zinc-800">
                  <div className="text-zinc-500 text-xs mb-1 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3 text-red-400" /> {t('riskWarning.maxLoss')}
                  </div>
                  <div className="text-lg font-bold text-red-400 font-mono">-${potentialLoss.toFixed(2)}</div>
                </div>
              </div>

              {/* Risk Reward Ratio */}
              <div className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-sm">{t('riskWarning.riskRewardRatio')}</span>
                <span className={`font-bold font-mono ${riskRewardRatio >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {riskRewardRatio.toFixed(2)}
                </span>
              </div>

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 text-amber-400 text-xs">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Agent History */}
              {agentAccuracy !== undefined && (
                <div className="flex items-center gap-2 p-3 bg-zinc-900 border border-zinc-800">
                  <Shield className="w-4 h-4 text-zinc-500" />
                  <span className="text-zinc-500 text-sm">{t('riskWarning.agentAccuracy')}</span>
                  <span className={`font-bold font-mono ${agentAccuracy >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(agentAccuracy * 100).toFixed(1)}%
                  </span>
                </div>
              )}

              {/* Agreement Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-1 accent-amber-500"
                />
                <span className="text-zinc-400 text-sm">
                  {t('riskWarning.disclaimer', { loss: potentialLoss.toFixed(2) })}
                </span>
              </label>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => { onConfirm(); setAgreed(false); }}
                  disabled={!agreed}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-black font-bold text-sm transition-colors"
                >
                  {t('riskWarning.confirmTrade')}
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors"
                >
                  {t('riskWarning.cancel')}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
