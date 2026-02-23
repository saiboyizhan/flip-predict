import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Brain, Lightbulb, Target, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import {
  recordPrediction,
  getAgentPredictions,
  generateSuggestion,
} from "@/app/services/api";
import { NFA_CONTRACT_ADDRESS, NFA_ABI } from "@/app/config/nfaContracts";

interface AgentInteractionProps {
  agentId: string;
  isOwner: boolean;
  tokenId?: number | null;
  markets: Array<{ id: string; title: string; yes_price?: number; yesPrice?: number; status: string }>;
}

export function AgentInteraction({ agentId, isOwner, tokenId, markets }: AgentInteractionProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'predict' | 'suggest'>('predict');

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
  const [executeAmount, setExecuteAmount] = useState('');
  const [executeLoading, setExecuteLoading] = useState(false);

  // wagmi write contract hook for on-chain execution
  const { writeContract, data: txHash, isPending: isTxPending, reset: resetTx } = useWriteContract();
  const { isSuccess: isTxConfirmed, isLoading: isTxWaiting } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    loadPredictions();
  }, [agentId]);

  // When on-chain tx confirms, show success
  useEffect(() => {
    if (isTxConfirmed && txHash) {
      setExecuteLoading(false);
      toast.success(t('agentInteraction.executeSuccess', 'Trade executed on-chain!'));
      setSuggestion(null);
      setExecuteAmount('');
      resetTx();
    }
  }, [isTxConfirmed, txHash]);

  const loadPredictions = async () => {
    try {
      const data = await getAgentPredictions(agentId);
      setPredictions(data);
    } catch { /* ignore */ }
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
    setSuggestion(null);
    setExecuteAmount('');
    try {
      const data = await generateSuggestion(agentId, sugMarket);
      setSuggestion(data);
      // Pre-fill suggested amount
      if (data.suggestedAmount) {
        setExecuteAmount(String(data.suggestedAmount));
      }
    } catch (err: any) {
      toast.error(err.message || t('agentInteraction.adviceFailed'));
    } finally {
      setSugLoading(false);
    }
  };

  const handleExecuteOnChain = () => {
    if (!suggestion || tokenId == null) return;
    if (suggestion.onChainMarketId == null) {
      toast.error(t('agentInteraction.noOnChainMarket', 'This market has no on-chain ID'));
      return;
    }
    const amount = Number(executeAmount);
    if (!amount || amount <= 0) {
      toast.error(t('agentInteraction.invalidAmount', 'Please enter a valid amount'));
      return;
    }

    setExecuteLoading(true);
    try {
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'agentPredictionTakePosition',
        args: [
          BigInt(tokenId),
          BigInt(suggestion.onChainMarketId),
          suggestion.suggestedSide === 'yes',
          parseUnits(String(amount), 18),
        ],
      });
    } catch (err: any) {
      setExecuteLoading(false);
      toast.error(err?.shortMessage || err?.message || 'Transaction failed');
    }
  };

  if (!isOwner) return null;

  const TABS = [
    { id: 'predict' as const, label: t('agentInteraction.tabPredict'), icon: Brain },
    { id: 'suggest' as const, label: t('agentInteraction.tabSuggest'), icon: Lightbulb },
  ];

  const activeMarkets = markets.filter(m => m.status === 'active');

  const RISK_COLORS: Record<string, string> = {
    low: 'text-emerald-400 bg-emerald-500/20',
    medium: 'text-blue-400 bg-blue-500/20',
    high: 'text-orange-400 bg-orange-500/20',
    extreme: 'text-red-400 bg-red-500/20',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-secondary border border-border"
    >
      {/* Tab Header */}
      <div className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {/* Tab 1: Predict */}
        {activeTab === 'predict' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-2">{t('agentInteraction.selectMarket')}</label>
                <select
                  value={selectedMarket}
                  onChange={(e) => setSelectedMarket(e.target.value)}
                  className="w-full bg-input-background border border-border text-foreground text-sm py-2.5 px-3 focus:outline-none focus:border-blue-500/50"
                >
                  <option value="">{t('agentInteraction.selectMarketPlaceholder')}</option>
                  {activeMarkets.map((m) => (
                    <option key={m.id} value={m.id}>{m.title.slice(0, 40)}...</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">{t('agentInteraction.predDirection')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPrediction('yes')}
                    className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                      prediction === 'yes'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-card border border-border text-muted-foreground hover:text-emerald-400'
                    }`}
                  >
                    YES
                  </button>
                  <button
                    onClick={() => setPrediction('no')}
                    className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                      prediction === 'no'
                        ? 'bg-red-500 text-white'
                        : 'bg-card border border-border text-muted-foreground hover:text-red-400'
                    }`}
                  >
                    NO
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                {t('agentInteraction.confidence', { pct: (confidence * 100).toFixed(0) })}
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-2">{t('agentInteraction.reason')}</label>
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder={t('agentInteraction.reasonPlaceholder')}
                rows={2}
                className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 resize-none placeholder:text-muted-foreground"
              />
            </div>

            <button
              onClick={handlePredict}
              disabled={predLoading || !selectedMarket}
              className="w-full py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Target className="w-4 h-4" />
              {predLoading ? t('agentInteraction.recording') : t('agentInteraction.recordPrediction')}
            </button>

            {/* Prediction History */}
            {predictions.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm text-muted-foreground mb-3">{t('agentInteraction.recentPredictions')}</h4>
                <div className="space-y-2">
                  {predictions.slice(0, 10).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 bg-muted/50 border border-border text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-bold ${
                          p.prediction === 'yes' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {p.prediction.toUpperCase()}
                        </span>
                        <span className="text-muted-foreground truncate max-w-[200px]">#{p.market_id.slice(0, 8)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground font-mono">{(p.confidence * 100).toFixed(0)}%</span>
                        {p.is_correct === 1 && <span className="text-emerald-400 text-xs font-bold">&#10003;</span>}
                        {p.is_correct === 0 && <span className="text-red-400 text-xs font-bold">&#10007;</span>}
                        {p.is_correct === null && <span className="text-muted-foreground text-xs">{t('agentInteraction.pending')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Suggest + Execute On-chain */}
        {activeTab === 'suggest' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">{t('agentInteraction.getAgentAdvice')}</label>
              <div className="flex gap-2">
                <select
                  value={sugMarket}
                  onChange={(e) => setSugMarket(e.target.value)}
                  className="flex-1 bg-input-background border border-border text-foreground text-sm py-2.5 px-3 focus:outline-none focus:border-blue-500/50"
                >
                  <option value="">{t('agentInteraction.selectMarketPlaceholder')}</option>
                  {activeMarkets.map((m) => (
                    <option key={m.id} value={m.id}>{m.title.slice(0, 40)}...</option>
                  ))}
                </select>
                <button
                  onClick={handleSuggest}
                  disabled={sugLoading || !sugMarket}
                  className="px-4 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold text-sm transition-colors"
                >
                  {sugLoading ? '...' : t('agentInteraction.getAdvice')}
                </button>
              </div>
            </div>

            {suggestion && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border border-border p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-blue-400" />
                    <span className="text-foreground font-semibold">{t('agentInteraction.agentAdvice')}</span>
                  </div>
                  <span className={`px-2 py-1 text-xs font-bold ${RISK_COLORS[suggestion.riskLevel] || RISK_COLORS.medium}`}>
                    {suggestion.riskLevel.toUpperCase()}
                  </span>
                </div>

                <div className="flex gap-4">
                  <div>
                    <div className="text-muted-foreground text-xs">{t('agentInteraction.sugDirection')}</div>
                    <div className={`text-lg font-bold ${suggestion.suggestedSide === 'yes' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {suggestion.suggestedSide.toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">{t('agentInteraction.sugConfidence')}</div>
                    <div className="text-lg font-bold text-blue-400 font-mono">{(suggestion.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">{t('agentInteraction.sugPotentialGain')}</div>
                    <div className="text-lg font-bold text-emerald-400 font-mono">+${suggestion.potentialProfit}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">{t('agentInteraction.sugMaxLoss')}</div>
                    <div className="text-lg font-bold text-red-400 font-mono">-${suggestion.potentialLoss}</div>
                  </div>
                </div>

                <p className="text-muted-foreground text-sm">{suggestion.reasoning}</p>

                {/* Amount input + Execute button */}
                <div className="border-t border-border pt-3 space-y-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t('agentInteraction.tradeAmount', 'Trade Amount (USDT)')}
                    </label>
                    <input
                      type="number"
                      value={executeAmount}
                      onChange={(e) => setExecuteAmount(e.target.value)}
                      min="0.01"
                      step="0.01"
                      placeholder={String(suggestion.suggestedAmount || '50')}
                      className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleExecuteOnChain}
                      disabled={executeLoading || isTxPending || isTxWaiting || !executeAmount || tokenId == null}
                      className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {executeLoading || isTxPending
                        ? t('agentInteraction.signing', 'Signing...')
                        : isTxWaiting
                        ? t('agentInteraction.confirming', 'Confirming...')
                        : t('agentInteraction.executeOnChain', 'Execute On-chain')}
                    </button>
                    <button
                      onClick={() => { setSuggestion(null); setExecuteAmount(''); }}
                      className="flex-1 py-2.5 bg-muted hover:bg-accent text-muted-foreground font-bold text-sm transition-colors"
                    >
                      {t('agentInteraction.rejectAdvice')}
                    </button>
                  </div>

                  {tokenId == null && (
                    <p className="text-xs text-yellow-400">
                      {t('agentInteraction.needMintFirst', 'Agent must be minted on-chain (NFA) to execute trades')}
                    </p>
                  )}
                  {suggestion.onChainMarketId == null && (
                    <p className="text-xs text-yellow-400">
                      {t('agentInteraction.noOnChainMarketWarning', 'This market does not have an on-chain ID. Cannot execute.')}
                    </p>
                  )}
                </div>

                {/* Show tx hash if available */}
                {txHash && (
                  <div className="text-xs text-muted-foreground font-mono break-all">
                    Tx: {txHash}
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
