import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Brain, Lightbulb, Zap, TrendingUp, Target, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  recordPrediction,
  getAgentPredictions,
  generateSuggestion,
  executeSuggestion,
  authorizeAutoTrade,
  revokeAutoTrade,
  getAutoTradeAuth,
} from "@/app/services/api";

interface AgentInteractionProps {
  agentId: string;
  isOwner: boolean;
  markets: Array<{ id: string; title: string; yes_price?: number; yesPrice?: number; status: string }>;
}

export function AgentInteraction({ agentId, isOwner, markets }: AgentInteractionProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'predict' | 'suggest' | 'auto'>('predict');

  // Prediction tab state
  const [selectedMarket, setSelectedMarket] = useState('');
  const [prediction, setPrediction] = useState<'yes' | 'no'>('yes');
  const [confidence, setConfidence] = useState(0.6);
  const [reasoning, setReasoning] = useState('');
  const [predictions, setPredictions] = useState<any[]>([]);
  const [predLoading, setPredLoading] = useState(false);

  // Suggestion tab state
  const [sugMarket, setSugMarket] = useState('');
  const [suggestion, setSuggestion] = useState<any>(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [showRiskDialog, setShowRiskDialog] = useState(false);

  // Auto trade tab state
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [maxPerTrade, setMaxPerTrade] = useState('50');
  const [maxDaily, setMaxDaily] = useState('200');
  const [duration, setDuration] = useState('24');
  const [autoLoading, setAutoLoading] = useState(false);

  useEffect(() => {
    // Load predictions on mount
    loadPredictions();
    loadAutoTradeState();
  }, [agentId]);

  const loadPredictions = async () => {
    try {
      const data = await getAgentPredictions(agentId);
      setPredictions(data);
    } catch { /* ignore */ }
  };

  const loadAutoTradeState = async () => {
    try {
      const agent = await getAutoTradeAuth(agentId);
      if (!agent) return;

      const expiresAt = Number(agent.auto_trade_expires) || 0;
      const enabled = Boolean(agent.auto_trade_enabled) && (expiresAt === 0 || expiresAt > Date.now());
      setAutoEnabled(enabled);

      if (agent.max_per_trade != null) {
        setMaxPerTrade(String(agent.max_per_trade));
      }
      if (agent.max_daily_amount != null) {
        setMaxDaily(String(agent.max_daily_amount));
      }
      if (expiresAt > Date.now()) {
        const hoursLeft = Math.max(1, Math.ceil((expiresAt - Date.now()) / 3600000));
        setDuration(String(hoursLeft));
      }
    } catch {
      // ignore initialization errors
    }
  };

  const handlePredict = async () => {
    if (!selectedMarket) { toast.error(t('agentInteraction.selectMarketError')); return; }
    setPredLoading(true);
    try {
      await recordPrediction(agentId, {
        marketId: selectedMarket,
        prediction,
        confidence,
        reasoning,
      });
      toast.success(t('agentInteraction.predictionRecorded'));
      setReasoning('');
      loadPredictions();
    } catch (err: any) {
      toast.error(err.message || t('agentInteraction.recordFailed'));
    } finally {
      setPredLoading(false);
    }
  };

  const handleSuggest = async () => {
    if (!sugMarket) { toast.error(t('agentInteraction.selectMarketError')); return; }
    setSugLoading(true);
    try {
      const data = await generateSuggestion(agentId, sugMarket);
      setSuggestion(data);
    } catch (err: any) {
      toast.error(err.message || t('agentInteraction.adviceFailed'));
    } finally {
      setSugLoading(false);
    }
  };

  const handleAcceptSuggestion = async () => {
    if (!suggestion) return;
    try {
      await executeSuggestion(agentId, suggestion.id, true);
      toast.success(t('agentInteraction.adviceAccepted'));
      setSuggestion(null);
    } catch (err: any) {
      toast.error(err.message || t('agentInteraction.executionFailed'));
    }
  };

  const handleAuthorize = async () => {
    setAutoLoading(true);
    try {
      await authorizeAutoTrade(agentId, {
        maxPerTrade: Number(maxPerTrade),
        maxDailyAmount: Number(maxDaily),
        durationHours: Number(duration),
      });
      setAutoEnabled(true);
      toast.success(t('agentInteraction.autoAuthorized'));
    } catch (err: any) {
      toast.error(err.message || t('agentInteraction.authorizationFailed'));
    } finally {
      setAutoLoading(false);
    }
  };

  const handleRevoke = async () => {
    setAutoLoading(true);
    try {
      await revokeAutoTrade(agentId);
      setAutoEnabled(false);
      toast.success(t('agentInteraction.autoRevoked'));
    } catch (err: any) {
      toast.error(err.message || t('agentInteraction.revokeFailed'));
    } finally {
      setAutoLoading(false);
    }
  };

  if (!isOwner) return null;

  const TABS = [
    { id: 'predict' as const, label: t('agentInteraction.tabPredict'), icon: Brain },
    { id: 'suggest' as const, label: t('agentInteraction.tabSuggest'), icon: Lightbulb },
    { id: 'auto' as const, label: t('agentInteraction.tabAuto'), icon: Zap },
  ];

  const activeMarkets = markets.filter(m => m.status === 'active');

  const RISK_COLORS: Record<string, string> = {
    low: 'text-emerald-400 bg-emerald-500/20',
    medium: 'text-amber-400 bg-amber-500/20',
    high: 'text-orange-400 bg-orange-500/20',
    extreme: 'text-red-400 bg-red-500/20',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-950 border border-zinc-800"
    >
      {/* Tab Header */}
      <div className="flex border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-amber-400 border-b-2 border-amber-500 bg-amber-500/5'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {/* Tab 1: 预测记录 */}
        {activeTab === 'predict' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.selectMarket')}</label>
                <select
                  value={selectedMarket}
                  onChange={(e) => setSelectedMarket(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2.5 px-3 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">{t('agentInteraction.selectMarketPlaceholder')}</option>
                  {activeMarkets.map((m) => (
                    <option key={m.id} value={m.id}>{m.title.slice(0, 40)}...</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.predDirection')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPrediction('yes')}
                    className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                      prediction === 'yes'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-emerald-400'
                    }`}
                  >
                    YES
                  </button>
                  <button
                    onClick={() => setPrediction('no')}
                    className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                      prediction === 'no'
                        ? 'bg-red-500 text-white'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-red-400'
                    }`}
                  >
                    NO
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-2">
                {t('agentInteraction.confidence', { pct: (confidence * 100).toFixed(0) })}
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.reason')}</label>
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder={t('agentInteraction.reasonPlaceholder')}
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2 px-3 focus:outline-none focus:border-amber-500/50 resize-none placeholder:text-zinc-600"
              />
            </div>

            <button
              onClick={handlePredict}
              disabled={predLoading || !selectedMarket}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Target className="w-4 h-4" />
              {predLoading ? t('agentInteraction.recording') : t('agentInteraction.recordPrediction')}
            </button>

            {/* Prediction History */}
            {predictions.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm text-zinc-400 mb-3">{t('agentInteraction.recentPredictions')}</h4>
                <div className="space-y-2">
                  {predictions.slice(0, 10).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 bg-zinc-900/50 border border-zinc-800 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-bold ${
                          p.prediction === 'yes' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {p.prediction.toUpperCase()}
                        </span>
                        <span className="text-zinc-300 truncate max-w-[200px]">#{p.market_id.slice(0, 8)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500 font-mono">{(p.confidence * 100).toFixed(0)}%</span>
                        {p.is_correct === 1 && <span className="text-emerald-400 text-xs font-bold">&#10003;</span>}
                        {p.is_correct === 0 && <span className="text-red-400 text-xs font-bold">&#10007;</span>}
                        {p.is_correct === null && <span className="text-zinc-600 text-xs">{t('agentInteraction.pending')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: 交易建议 */}
        {activeTab === 'suggest' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.getAgentAdvice')}</label>
              <div className="flex gap-2">
                <select
                  value={sugMarket}
                  onChange={(e) => setSugMarket(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 text-white text-sm py-2.5 px-3 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">{t('agentInteraction.selectMarketPlaceholder')}</option>
                  {activeMarkets.map((m) => (
                    <option key={m.id} value={m.id}>{m.title.slice(0, 40)}...</option>
                  ))}
                </select>
                <button
                  onClick={handleSuggest}
                  disabled={sugLoading || !sugMarket}
                  className="px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm transition-colors"
                >
                  {sugLoading ? '...' : t('agentInteraction.getAdvice')}
                </button>
              </div>
            </div>

            {suggestion && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-amber-400" />
                    <span className="text-white font-semibold">{t('agentInteraction.agentAdvice')}</span>
                  </div>
                  <span className={`px-2 py-1 text-xs font-bold ${RISK_COLORS[suggestion.riskLevel] || RISK_COLORS.medium}`}>
                    {suggestion.riskLevel.toUpperCase()}
                  </span>
                </div>

                <div className="flex gap-4">
                  <div>
                    <div className="text-zinc-500 text-xs">{t('agentInteraction.sugDirection')}</div>
                    <div className={`text-lg font-bold ${suggestion.suggestedSide === 'yes' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {suggestion.suggestedSide.toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-xs">{t('agentInteraction.sugConfidence')}</div>
                    <div className="text-lg font-bold text-amber-400 font-mono">{(suggestion.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-xs">{t('agentInteraction.sugPotentialGain')}</div>
                    <div className="text-lg font-bold text-emerald-400 font-mono">+${suggestion.potentialProfit}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-xs">{t('agentInteraction.sugMaxLoss')}</div>
                    <div className="text-lg font-bold text-red-400 font-mono">-${suggestion.potentialLoss}</div>
                  </div>
                </div>

                <p className="text-zinc-400 text-sm">{suggestion.reasoning}</p>

                <div className="flex gap-2">
                  <button
                    onClick={handleAcceptSuggestion}
                    className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-colors"
                  >
                    {t('agentInteraction.acceptAdvice')}
                  </button>
                  <button
                    onClick={() => setSuggestion(null)}
                    className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors"
                  >
                    {t('agentInteraction.rejectAdvice')}
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Tab 3: 自动交易 */}
        {activeTab === 'auto' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{t('agentInteraction.autoTradeWarning')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.maxPerTrade')}</label>
                <input
                  type="number"
                  value={maxPerTrade}
                  onChange={(e) => setMaxPerTrade(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2.5 px-3 focus:outline-none focus:border-amber-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.dailyLimit')}</label>
                <input
                  type="number"
                  value={maxDaily}
                  onChange={(e) => setMaxDaily(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2.5 px-3 focus:outline-none focus:border-amber-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">{t('agentInteraction.authDuration')}</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2.5 px-3 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="1">{t('agentInteraction.hours1')}</option>
                  <option value="6">{t('agentInteraction.hours6')}</option>
                  <option value="12">{t('agentInteraction.hours12')}</option>
                  <option value="24">{t('agentInteraction.hours24')}</option>
                  <option value="72">{t('agentInteraction.days3')}</option>
                  <option value="168">{t('agentInteraction.weeks1')}</option>
                  <option value="720">{t('agentInteraction.days30')}</option>
                </select>
              </div>
            </div>

            {!autoEnabled ? (
              <button
                onClick={handleAuthorize}
                disabled={autoLoading}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {autoLoading ? t('agentInteraction.authorizing') : t('agentInteraction.authorizeAuto')}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  {t('agentInteraction.autoEnabled')}
                </div>
                <button
                  onClick={handleRevoke}
                  disabled={autoLoading}
                  className="w-full py-3 bg-red-500/20 border border-red-500/50 hover:bg-red-500/30 text-red-400 font-bold text-sm transition-colors"
                >
                  {autoLoading ? t('agentInteraction.revoking') : t('agentInteraction.revokeAuth')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
