import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, TrendingUp, Percent, DollarSign, Wallet, Settings, Tag, XCircle, Star, Target, Link2, Shield, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getAgent,
  updateAgent,
  listAgentForSale,
  listAgentForRent,
  buyAgent,
  rentAgent,
  delistAgent,
  fetchMarkets,
  updateAgentVault,
  fundAgentPlatform,
  withdrawAgentPlatform,
} from "@/app/services/api";
import type { AgentDetail as AgentDetailType, AgentTrade } from "@/app/services/api";
import { useAccount } from "wagmi";
import { AgentInteraction } from "./AgentInteraction";
import { PredictionStyleDashboard } from "./PredictionStyleDashboard";
import { CopyTradePanel } from "./CopyTradePanel";
import { CopyTradeHistory } from "./CopyTradeHistory";
import { ComboStrategyEditor } from "./ComboStrategyEditor";
import { EarningsDashboard } from "./EarningsDashboard";
import { LlmConfigPanel } from "./LlmConfigPanel";
import {
  useAgentState,
  useAgentBalance,
  useFundAgent,
  useWithdrawFromAgent,
  usePauseAgent,
  useUnpauseAgent,
  useTerminateAgent,
  useTransferAgent,
  useAgentLearning,
  useUpdateLearning,
  useAgentModule,
  useRegisterModule,
  useDeactivateModule,
  useVaultPermission,
  useDelegateAccess,
  useRevokeAccess,
} from "../../hooks/useNFAContracts";

const STRATEGY_MAP: Record<string, { labelKey: string; color: string }> = {
  conservative: { labelKey: "agent.strategies.conservative", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  aggressive: { labelKey: "agent.strategies.aggressive", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  contrarian: { labelKey: "agent.strategies.contrarian", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  momentum: { labelKey: "agent.strategies.momentum", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  random: { labelKey: "agent.strategies.random", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
};

const GRADIENT_PAIRS = [
  ["from-blue-500", "to-purple-600"],
  ["from-emerald-500", "to-blue-600"],
  ["from-red-500", "to-blue-600"],
  ["from-blue-500", "to-emerald-600"],
  ["from-purple-500", "to-red-600"],
  ["from-pink-500", "to-blue-600"],
  ["from-cyan-500", "to-purple-600"],
  ["from-orange-500", "to-emerald-600"],
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

export function AgentDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { navigate } = useTransitionNavigate();
  const { address } = useAccount();
  const [agent, setAgent] = useState<AgentDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [salePrice, setSalePrice] = useState("");
  const [rentPrice, setRentPrice] = useState("");
  const [rentDays, setRentDays] = useState("1");
  const [showSaleInput, setShowSaleInput] = useState(false);
  const [showRentInput, setShowRentInput] = useState(false);
  const [showVaultInput, setShowVaultInput] = useState(false);
  const [vaultURIInput, setVaultURIInput] = useState("");
  const [vaultHashInput, setVaultHashInput] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<'trades' | 'predictions' | 'suggestions' | 'style' | 'llm' | 'copyTrading' | 'earnings' | 'onchain'>('trades');
  const [markets, setMarkets] = useState<any[]>([]);
  const [showBuyConfirm, setShowBuyConfirm] = useState(false);
  const [showRentConfirm, setShowRentConfirm] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [platformFundAmount, setPlatformFundAmount] = useState("");
  const [platformWithdrawAmount, setPlatformWithdrawAmount] = useState("");
  const [platformFundLoading, setPlatformFundLoading] = useState(false);
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);

  // On-chain management state
  const [learningRoot, setLearningRoot] = useState("");
  const [learningProof, setLearningProof] = useState("");
  const [moduleAddress, setModuleAddress] = useState("");
  const [moduleMetadata, setModuleMetadata] = useState("");
  const [queryModuleAddress, setQueryModuleAddress] = useState("");
  const [delegateAddress, setDelegateAddress] = useState("");
  const [delegateLevel, setDelegateLevel] = useState("1");
  const [delegateDuration, setDelegateDuration] = useState("24");
  const [checkPermissionAddress, setCheckPermissionAddress] = useState("");

  const isOwner = address && agent && agent.owner_address.toLowerCase() === address.toLowerCase();

  // NFA Contract hooks
  const tokenId = agent?.token_id ? BigInt(agent.token_id) : undefined;
  const { stateValue, stateName, refetch: refetchState, isLoading: stateLoading } = useAgentState(tokenId);
  const { balanceUSDT, refetch: refetchBalance, isLoading: balanceLoading } = useAgentBalance(tokenId);
  const { fundAgent, isPending: isFunding, isSuccess: fundSuccess, error: fundError, approveNeeded, isApproving } = useFundAgent();
  const { withdraw, isPending: isWithdrawing, isSuccess: withdrawSuccess, error: withdrawError } = useWithdrawFromAgent();
  const { pauseAgent, isPending: isPausing, isSuccess: pauseSuccess, error: pauseError } = usePauseAgent();
  const { unpauseAgent, isPending: isUnpausing, isSuccess: unpauseSuccess, error: unpauseError } = useUnpauseAgent();
  const { terminateAgent, isPending: isTerminating, isSuccess: terminateSuccess, error: terminateError } = useTerminateAgent();

  // On-chain hooks
  const { metrics: learningMetrics, refetch: refetchLearning } = useAgentLearning(tokenId);
  const { updateLearning, isPending: isUpdatingLearning, isSuccess: updateLearningSuccess } = useUpdateLearning();
  const { module: queriedModule, refetch: refetchModule } = useAgentModule(
    tokenId,
    queryModuleAddress ? (queryModuleAddress as `0x${string}`) : undefined
  );
  const { registerModule, isPending: isRegisteringModule, isSuccess: registerModuleSuccess } = useRegisterModule();
  const { deactivateModule, isPending: isDeactivatingModule, isSuccess: deactivateModuleSuccess } = useDeactivateModule();
  const { permission: checkedPermission, refetch: refetchPermission } = useVaultPermission(
    tokenId,
    checkPermissionAddress ? (checkPermissionAddress as `0x${string}`) : undefined
  );
  const { delegateAccess, isPending: isDelegating, isSuccess: delegateSuccess } = useDelegateAccess();
  const { revokeAccess, isPending: isRevoking, isSuccess: revokeSuccess } = useRevokeAccess();
  const { transferAgent, txHash: transferTxHash, isWriting: isTransferring, isConfirming: isTransferConfirming, isConfirmed: transferConfirmed, error: transferError, reset: resetTransfer } = useTransferAgent();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getAgent(id)
      .then((data) => {
        setAgent(data);
        setSelectedStrategy(data.strategy);
      })
      .catch(() => toast.error(t('agentDetail.loadFailed')))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchMarkets().then((data) => setMarkets(data)).catch((e) => { console.warn('[AgentDetail] Failed to load markets:', e.message) });
  }, []);

  // Handle fund success
  useEffect(() => {
    if (fundSuccess) {
      refetchBalance();
      setFundAmount("");
      toast.success(t('agentDetail.fundSuccess'));
    }
  }, [fundSuccess, t]);

  // Handle withdraw success
  useEffect(() => {
    if (withdrawSuccess) {
      refetchBalance();
      setWithdrawAmount("");
      toast.success(t('agentDetail.withdrawSuccess'));
    }
  }, [withdrawSuccess, t]);

  // Handle pause success
  useEffect(() => {
    if (pauseSuccess) {
      refetchState();
      toast.success(t('agentDetail.pauseSuccess'));
    }
  }, [pauseSuccess, t]);

  // Handle unpause success
  useEffect(() => {
    if (unpauseSuccess) {
      refetchState();
      toast.success(t('agentDetail.resumeSuccess'));
    }
  }, [unpauseSuccess, t]);

  // Handle terminate success
  useEffect(() => {
    if (terminateSuccess) {
      refetchState();
      toast.success(t('agentDetail.terminateSuccess'));
    }
  }, [terminateSuccess, t]);

  // Handle transfer success - complete purchase on backend
  useEffect(() => {
    if (transferConfirmed && transferTxHash && id) {
      setActionLoading(true);
      buyAgent(id, transferTxHash)
        .then(() => {
          toast.success(t('agentDetail.purchaseSuccess'));
          resetTransfer();
          navigate("/agents");
        })
        .catch((err: any) => {
          toast.error(err.message || t('agentDetail.purchaseFailed'));
          resetTransfer();
        })
        .finally(() => {
          setActionLoading(false);
        });
    }
  }, [transferConfirmed, transferTxHash, id, resetTransfer, navigate, t]);

  // Handle errors
  useEffect(() => {
    if (fundError) toast.error(fundError.message || t('agentDetail.fundFailed'));
  }, [fundError, t]);

  useEffect(() => {
    if (withdrawError) toast.error(withdrawError.message || t('agentDetail.withdrawFailed'));
  }, [withdrawError, t]);

  useEffect(() => {
    if (pauseError) toast.error(pauseError.message || t('agentDetail.pauseFailed'));
  }, [pauseError, t]);

  useEffect(() => {
    if (unpauseError) toast.error(unpauseError.message || t('agentDetail.unpauseFailed'));
  }, [unpauseError, t]);

  useEffect(() => {
    if (terminateError) toast.error(terminateError.message || t('agentDetail.terminateFailed'));
  }, [terminateError, t]);

  // On-chain success handlers
  useEffect(() => {
    if (updateLearningSuccess) {
      refetchLearning();
      setLearningRoot("");
      setLearningProof("");
      toast.success(t('agentDetail.learningUpdated'));
    }
  }, [updateLearningSuccess, t]);

  useEffect(() => {
    if (registerModuleSuccess) {
      setModuleAddress("");
      setModuleMetadata("");
      toast.success(t('agentDetail.moduleRegistered'));
    }
  }, [registerModuleSuccess, t]);

  useEffect(() => {
    if (deactivateModuleSuccess) {
      toast.success(t('agentDetail.moduleDeactivated'));
    }
  }, [deactivateModuleSuccess, t]);

  useEffect(() => {
    if (delegateSuccess) {
      setDelegateAddress("");
      toast.success(t('agentDetail.accessDelegated'));
    }
  }, [delegateSuccess, t]);

  useEffect(() => {
    if (revokeSuccess) {
      toast.success(t('agentDetail.accessRevoked'));
    }
  }, [revokeSuccess, t]);

  useEffect(() => {
    if (transferError) toast.error(transferError.message || "Transfer failed");
  }, [transferError]);

  const handleUpdateStrategy = async () => {
    if (!id || !selectedStrategy || selectedStrategy === agent?.strategy) return;
    setActionLoading(true);
    try {
      const updated = await updateAgent(id, { strategy: selectedStrategy });
      setAgent((prev) => prev ? { ...prev, ...updated } : prev);
      toast.success(t('agentDetail.strategyUpdated'));
    } catch (err: any) {
      toast.error(err.message || t('agentDetail.updateFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleListSale = async () => {
    if (!id || !salePrice) return;
    setActionLoading(true);
    try {
      await listAgentForSale(id, Number(salePrice));
      setAgent((prev) => prev ? { ...prev, is_for_sale: true, sale_price: Number(salePrice) } : prev);
      setShowSaleInput(false);
      toast.success(t('agentDetail.listedForSale'));
    } catch (err: any) {
      toast.error(err.message || t('agentDetail.listFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleListRent = async () => {
    if (!id || !rentPrice) return;
    setActionLoading(true);
    try {
      await listAgentForRent(id, Number(rentPrice));
      setAgent((prev) => prev ? { ...prev, is_for_rent: true, rent_price: Number(rentPrice) } : prev);
      setShowRentInput(false);
      toast.success(t('agentDetail.listedForRent'));
    } catch (err: any) {
      toast.error(err.message || t('agentDetail.listFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelist = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      await delistAgent(id);
      setAgent((prev) => prev ? { ...prev, is_for_sale: false, sale_price: null, is_for_rent: false, rent_price: null } : prev);
      toast.success(t('agentDetail.delisted'));
    } catch (err: any) {
      toast.error(err.message || t('agentDetail.delistFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!agent || !address) return;

    // If agent is not minted on-chain, fallback to database-only purchase
    if (!tokenId) {
      setActionLoading(true);
      try {
        await buyAgent(agent.id);
        toast.success(t('agentDetail.purchaseSuccess'));
        navigate("/agents");
      } catch (err: any) {
        toast.error(err.message || t('agentDetail.purchaseFailed'));
      } finally {
        setActionLoading(false);
      }
      return;
    }

    // On-chain purchase: initiate NFT transfer
    // Transfer requires seller to have approved buyer first
    // In a real marketplace, seller would approve the marketplace contract
    toast.info("Initiating on-chain transfer...");
    transferAgent(agent.owner_address as `0x${string}`, address as `0x${string}`, tokenId);
  };

  const handleRent = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      await rentAgent(id, Number(rentDays));
      toast.success(t('agentDetail.rentalSuccess'));
      navigate("/agents");
    } catch (err: any) {
      toast.error(err.message || t('agentDetail.rentalFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen p-4 sm:p-8 flex items-center justify-center">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <p className="text-muted-foreground">{t('agentDetail.notFound')}</p>
        <button onClick={() => navigate("/agents")} className="text-blue-400 hover:text-blue-300 text-sm mt-2">
          {t('agentDetail.backToList')}
        </button>
      </div>
    );
  }

  const strategy = STRATEGY_MAP[agent.strategy] || STRATEGY_MAP.random;
  const gradientIndex = Math.abs(hashCode(agent.name)) % GRADIENT_PAIRS.length;
  const [from, to] = GRADIENT_PAIRS[gradientIndex];

  return (
    <div className="min-h-screen p-3 sm:p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('agentDetail.back')}
        </button>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-secondary border border-border p-6"
        >
          <div className="flex items-start gap-4">
            <div className={`w-16 h-16 bg-gradient-to-br ${from} ${to} flex items-center justify-center shrink-0`}>
              <span className="text-white font-bold text-2xl">{agent.name.charAt(0)}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-2xl font-bold">{agent.name}</h1>
                <span className="px-2 py-0.5 bg-blue-500 text-black text-sm font-bold">Lv.{agent.level}</span>
                <span className={`px-2 py-0.5 text-xs border ${strategy.color}`}>{t(strategy.labelKey)}</span>
                <span className={`px-2 py-0.5 text-xs border ${
                  agent.status === "active" ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400" : "border-border bg-muted text-muted-foreground"
                }`}>
                  {agent.status === "active" ? t('agentDetail.statusActive') : agent.status === "idle" ? t('agentDetail.statusIdle') : agent.status}
                </span>
              </div>
              {agent.description && <p className="text-muted-foreground text-sm">{agent.description}</p>}
              <p className="text-muted-foreground text-xs font-mono mt-1">
                {t('agentDetail.owner')}: {agent.owner_address.slice(0, 6)}...{agent.owner_address.slice(-4)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4"
        >
          <div className="bg-secondary border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs sm:text-sm mb-2">
              <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="truncate">{t('agentDetail.totalProfit')}</span>
            </div>
            <div className={`text-lg sm:text-xl font-bold font-mono ${agent.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {agent.total_profit >= 0 ? "+" : ""}${agent.total_profit.toFixed(2)}
            </div>
          </div>
          <div className="bg-secondary border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs sm:text-sm mb-2">
              <Percent className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="truncate">{t('agentDetail.winRate')}</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-foreground">
              {agent.win_rate.toFixed(1)}%
            </div>
          </div>
          <div className="bg-secondary border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs sm:text-sm mb-2">
              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="truncate">ROI</span>
            </div>
            <div className={`text-lg sm:text-xl font-bold font-mono ${agent.roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {agent.roi >= 0 ? "+" : ""}{agent.roi.toFixed(1)}%
            </div>
          </div>
          <div className="bg-secondary border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs sm:text-sm mb-2">
              <Wallet className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="truncate">{t('agentDetail.balance')}</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-blue-400">
              ${agent.wallet_balance.toFixed(2)}
            </div>
          </div>
          <div className="bg-secondary border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs sm:text-sm mb-2">
              <Target className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="truncate">{t('agentDetail.predAccuracy')}</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-foreground">
              {agent?.reputation_score ? `${agent.reputation_score}%` : "-"}
            </div>
          </div>
          <div className="bg-secondary border border-border p-3 sm:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs sm:text-sm mb-2">
              <Star className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="truncate">{t('agentDetail.reputation')}</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-blue-400">
              {agent?.reputation_score ?? 0}
            </div>
          </div>
        </motion.div>

        {/* Platform Funding (Owner Only) -- transfers between user balance and agent balance */}
        {isOwner && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="bg-secondary border border-border p-6"
          >
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Wallet className="w-5 h-5 text-blue-400" />
              {t('agentDetail.platformFunding', { defaultValue: 'Agent Funding' })}
            </h3>
            <p className="text-muted-foreground text-xs mb-4">
              {t('agentDetail.platformFundingDesc', { defaultValue: 'Transfer between your platform balance and agent trading balance. Agent uses this balance for auto-trading.' })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Fund Agent */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">{t('agentDetail.fundToAgent', { defaultValue: 'Fund Agent' })}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={platformFundAmount}
                    onChange={(e) => setPlatformFundAmount(e.target.value)}
                    min="0.01"
                    step="0.01"
                    placeholder="USDT"
                    className="flex-1 bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                  />
                  <button
                    onClick={async () => {
                      if (!id || !platformFundAmount) return;
                      setPlatformFundLoading(true);
                      try {
                        const res = await fundAgentPlatform(id, Number(platformFundAmount));
                        setAgent((prev) => prev ? { ...prev, wallet_balance: res.agentBalance } : prev);
                        setPlatformFundAmount("");
                        toast.success(t('agentDetail.fundSuccess'));
                      } catch (err: any) {
                        toast.error(err.message || t('agentDetail.fundFailed'));
                      } finally {
                        setPlatformFundLoading(false);
                      }
                    }}
                    disabled={platformFundLoading || !platformFundAmount}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                  >
                    {platformFundLoading ? '...' : t('agentDetail.fund', { defaultValue: 'Fund' })}
                  </button>
                </div>
              </div>
              {/* Withdraw from Agent */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">{t('agentDetail.withdrawFromAgent', { defaultValue: 'Withdraw from Agent' })}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={platformWithdrawAmount}
                    onChange={(e) => setPlatformWithdrawAmount(e.target.value)}
                    min="0.01"
                    step="0.01"
                    placeholder="USDT"
                    className="flex-1 bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                  />
                  <button
                    onClick={async () => {
                      if (!id || !platformWithdrawAmount) return;
                      setPlatformFundLoading(true);
                      try {
                        const res = await withdrawAgentPlatform(id, Number(platformWithdrawAmount));
                        setAgent((prev) => prev ? { ...prev, wallet_balance: res.agentBalance } : prev);
                        setPlatformWithdrawAmount("");
                        toast.success(t('agentDetail.withdrawSuccess'));
                      } catch (err: any) {
                        toast.error(err.message || t('agentDetail.withdrawFailed'));
                      } finally {
                        setPlatformFundLoading(false);
                      }
                    }}
                    disabled={platformFundLoading || !platformWithdrawAmount}
                    className="px-4 py-2 bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed text-foreground text-sm font-semibold transition-colors"
                  >
                    {platformFundLoading ? '...' : t('agentDetail.withdraw', { defaultValue: 'Withdraw' })}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              {t('agentDetail.currentAgentBalance', { defaultValue: 'Agent balance:' })} <span className="text-blue-400 font-mono font-semibold">${agent.wallet_balance.toFixed(2)}</span>
            </div>
          </motion.div>
        )}

        {/* Vault Info */}
        {(agent.vault_uri || isOwner) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="bg-secondary border border-border p-6"
          >
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-blue-400" />
              {t('agentDetail.vaultStorage')}
            </h3>
            {agent.vault_uri ? (
              <div className="space-y-3">
                <div>
                  <div className="text-muted-foreground text-xs mb-1">{t('agentDetail.vaultUriLabel')}</div>
                  <a
                    href={agent.vault_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-sm font-mono flex items-center gap-1 break-all"
                  >
                    <Link2 className="w-3 h-3 shrink-0" />
                    {agent.vault_uri}
                  </a>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">{t('agentDetail.vaultHashLabel')}</div>
                  <div className="text-foreground text-sm font-mono break-all">
                    {agent.vault_hash || "-"}
                  </div>
                </div>
              </div>
            ) : isOwner ? (
              <p className="text-muted-foreground text-sm">
                {t('agentDetail.vaultNotConfigured')}
              </p>
            ) : null}
          </motion.div>
        )}

        {/* Chain Status Bar (All Users) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.13 }}
          className="bg-card border border-border p-6"
        >
          <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
            {t("agentDetail.chainStatus", { defaultValue: "Chain Status" })}
          </h3>
          {!tokenId ? (
            <div className="text-muted-foreground text-sm">{t("agentDetail.notMinted", { defaultValue: "Not minted on-chain" })}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.chainState", { defaultValue: "Chain State" })}</div>
                <div className="flex items-center gap-2">
                  {stateLoading ? (
                    <span className="text-muted-foreground text-sm">{t("common.loading", { defaultValue: "Loading..." })}</span>
                  ) : (
                    <>
                      <div className={`w-2 h-2 rounded-full ${
                        stateValue === 0 ? 'bg-green-500' :
                        stateValue === 1 ? 'bg-yellow-500' :
                        'bg-red-500'
                      }`} />
                      <span className={`font-mono text-sm font-semibold ${
                        stateValue === 0 ? 'text-green-400' :
                        stateValue === 1 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {stateName}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.chainBalance", { defaultValue: "Chain Balance" })}</div>
                <div className="font-mono text-sm text-foreground">
                  {balanceLoading ? t("common.loading", { defaultValue: "Loading..." }) : `${balanceUSDT} USDT`}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.dbBalance", { defaultValue: "DB Balance" })} <span className="text-muted-foreground/70">{t("agentDetail.simulated", { defaultValue: "(Simulated)" })}</span></div>
                <div className="font-mono text-sm text-muted-foreground">
                  ${agent.wallet_balance.toFixed(2)} USDT
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Fund / Withdraw Panel (Owner Only) */}
        {isOwner && tokenId && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 }}
            className="bg-card border border-border p-6"
          >
            <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
              {t("agentDetail.agentFunding", { defaultValue: "Agent Funding" })}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="text-muted-foreground text-sm mb-2">{t("agentDetail.balanceLabel", { defaultValue: "Balance:" })} {balanceLoading ? t("common.loading", { defaultValue: "Loading..." }) : `${balanceUSDT} USDT`}</div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={fundAmount || withdrawAmount}
                  onChange={(e) => {
                    setFundAmount(e.target.value);
                    setWithdrawAmount(e.target.value);
                  }}
                  min="0.01"
                  step="0.01"
                  placeholder={t("agentDetail.amountPlaceholder", { defaultValue: "Amount" })}
                  className="flex-1 bg-secondary border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                />
                <button
                  onClick={() => {
                    if (!tokenId || !fundAmount) return;
                    fundAgent(tokenId, fundAmount);
                  }}
                  disabled={isFunding || isApproving || !fundAmount}
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                  style={{ fontFamily: 'DM Sans, sans-serif' }}
                >
                  {isApproving ? t("agentDetail.approving", { defaultValue: "Approving..." }) : isFunding ? t("agentDetail.funding", { defaultValue: "Funding..." }) : approveNeeded ? t("agentDetail.approveAndFund", { defaultValue: "Approve & Fund" }) : t("agentDetail.fund", { defaultValue: "Fund" })}
                </button>
                <button
                  onClick={() => {
                    if (!tokenId || !withdrawAmount) return;
                    withdraw(tokenId, withdrawAmount);
                  }}
                  disabled={isWithdrawing || !withdrawAmount}
                  className="px-6 py-2 bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed text-foreground text-sm font-semibold transition-colors"
                  style={{ fontFamily: 'DM Sans, sans-serif' }}
                >
                  {isWithdrawing ? t("agentDetail.withdrawing", { defaultValue: "Withdrawing..." }) : t("agentDetail.withdraw", { defaultValue: "Withdraw" })}
                </button>
              </div>
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                <span>{t("agentDetail.fundingApprovalNote", { defaultValue: "Funding requires USDT approval first" })}</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Lifecycle Controls (Owner Only) */}
        {isOwner && tokenId && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.145 }}
            className="bg-card border border-border p-6"
          >
            <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
              {t("agentDetail.agentLifecycle", { defaultValue: "Agent Lifecycle" })}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="text-muted-foreground text-sm mb-2">
                  {t("agentDetail.stateLabel", { defaultValue: "State:" })} <span className={`font-mono font-semibold ${
                    stateValue === 0 ? 'text-green-400' :
                    stateValue === 1 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>{stateLoading ? t("common.loading", { defaultValue: "Loading..." }) : stateName}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {stateValue === 0 && (
                  <button
                    onClick={() => {
                      if (!tokenId) return;
                      pauseAgent(tokenId);
                    }}
                    disabled={isPausing}
                    className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    {isPausing ? t("agentDetail.pausing", { defaultValue: "Pausing..." }) : t("agentDetail.pauseAgent", { defaultValue: "Pause Agent" })}
                  </button>
                )}
                {stateValue === 1 && (
                  <button
                    onClick={() => {
                      if (!tokenId) return;
                      unpauseAgent(tokenId);
                    }}
                    disabled={isUnpausing}
                    className="px-6 py-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    {isUnpausing ? t("agentDetail.resuming", { defaultValue: "Resuming..." }) : t("agentDetail.resumeAgent", { defaultValue: "Resume Agent" })}
                  </button>
                )}
                {stateValue !== 2 && (
                  <button
                    onClick={() => setShowTerminateConfirm(true)}
                    disabled={isTerminating}
                    className="px-6 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    {t("agentDetail.terminateAgent", { defaultValue: "Terminate Agent" })}
                  </button>
                )}
                {stateValue === 2 && (
                  <button
                    disabled
                    className="px-6 py-2 bg-muted text-muted-foreground/70 text-sm font-semibold cursor-not-allowed"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    {t("agentDetail.terminated", { defaultValue: "Terminated" })}
                  </button>
                )}
              </div>
              <div className="text-yellow-400 text-xs flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{t("agentDetail.terminationIrreversible", { defaultValue: "Termination is irreversible" })}</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Terminate Confirmation Dialog */}
        <AnimatePresence>
          {showTerminateConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setShowTerminateConfirm(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-card border border-red-500/30 p-6 max-w-md w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                  <h3 className="text-xl font-bold text-foreground" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                    {t("agentDetail.confirmTermination", { defaultValue: "Confirm Termination" })}
                  </h3>
                </div>
                <p className="text-muted-foreground text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {t("agentDetail.confirmTerminationDesc", { defaultValue: "This action will permanently terminate the agent and cannot be undone. The agent will no longer be able to operate or be resumed." })}
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowTerminateConfirm(false)}
                    className="flex-1 py-3 border border-border text-muted-foreground hover:text-foreground font-semibold transition-colors"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </button>
                  <button
                    onClick={() => {
                      if (!tokenId) return;
                      terminateAgent(tokenId);
                      setShowTerminateConfirm(false);
                    }}
                    disabled={isTerminating}
                    className="flex-1 py-3 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-black font-bold transition-colors"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    {isTerminating ? t("agentDetail.terminating", { defaultValue: "Terminating..." }) : t("agentDetail.terminate", { defaultValue: "Terminate" })}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Owner Actions */}
        {isOwner && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-secondary border border-border p-6 space-y-4"
          >
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-400" />
              {t('agentDetail.manage')}
            </h3>

            {/* Strategy Change */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-muted-foreground">{t('agentDetail.changeStrategy')}</span>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="bg-input-background border border-border text-foreground text-sm py-1.5 px-3 focus:outline-none focus:border-blue-500/50"
              >
                {Object.entries(STRATEGY_MAP).map(([key, val]) => (
                  <option key={key} value={key}>{t(val.labelKey)}</option>
                ))}
              </select>
              <button
                onClick={handleUpdateStrategy}
                disabled={actionLoading || selectedStrategy === agent.strategy}
                className="px-4 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
              >
                {t('agentDetail.save')}
              </button>
            </div>

            {/* Sale / Rent / Delist */}
            <div className="flex flex-wrap gap-3">
              {!agent.is_for_sale && !agent.is_for_rent && (
                <>
                  <button
                    onClick={() => setShowSaleInput(!showSaleInput)}
                    className="flex items-center gap-2 px-4 py-2 border border-border hover:border-blue-500 text-sm text-muted-foreground hover:text-blue-400 transition-colors"
                  >
                    <Tag className="w-4 h-4" />
                    {t('agentDetail.listForSale')}
                  </button>
                  <button
                    onClick={() => setShowRentInput(!showRentInput)}
                    className="flex items-center gap-2 px-4 py-2 border border-border hover:border-blue-500 text-sm text-muted-foreground hover:text-blue-400 transition-colors"
                  >
                    <Tag className="w-4 h-4" />
                    {t('agentDetail.listForRent')}
                  </button>
                </>
              )}
              {(agent.is_for_sale || agent.is_for_rent) && (
                <button
                  onClick={handleDelist}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-4 py-2 border border-red-500/30 hover:border-red-500 text-sm text-red-400 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  {t('agentDetail.delist')}
                </button>
              )}
            </div>

            {/* Sale Input */}
            {showSaleInput && (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder={t('agentDetail.salePricePlaceholder')}
                  className="bg-input-background border border-border text-foreground text-sm py-2 px-3 w-40 focus:outline-none focus:border-blue-500/50"
                />
                <button
                  onClick={handleListSale}
                  disabled={actionLoading || !salePrice}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                >
                  {t('common.confirm')}
                </button>
              </div>
            )}

            {/* Rent Input */}
            {showRentInput && (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={rentPrice}
                  onChange={(e) => setRentPrice(e.target.value)}
                  placeholder={t('agentDetail.rentPricePlaceholder')}
                  className="bg-input-background border border-border text-foreground text-sm py-2 px-3 w-40 focus:outline-none focus:border-blue-500/50"
                />
                <button
                  onClick={handleListRent}
                  disabled={actionLoading || !rentPrice}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                >
                  {t('common.confirm')}
                </button>
              </div>
            )}

            {/* Vault Update */}
            <div className="border-t border-border pt-4">
              <button
                onClick={() => setShowVaultInput(!showVaultInput)}
                className="flex items-center gap-2 px-4 py-2 border border-border hover:border-blue-500 text-sm text-muted-foreground hover:text-blue-400 transition-colors"
              >
                <Shield className="w-4 h-4" />
                {agent.vault_uri ? t('agentDetail.updateVault') : t('agentDetail.setVault')}
              </button>
            </div>
            {showVaultInput && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={vaultURIInput}
                  onChange={(e) => setVaultURIInput(e.target.value)}
                  placeholder={t('agentDetail.vaultPlaceholder')}
                  className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
                />
                <input
                  type="text"
                  value={vaultHashInput}
                  onChange={(e) => setVaultHashInput(e.target.value)}
                  placeholder={t('agentDetail.vaultHashPlaceholder')}
                  className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
                />
                <button
                  onClick={async () => {
                    if (!id || !vaultURIInput) return;
                    setActionLoading(true);
                    try {
                      await updateAgentVault(id, { vaultURI: vaultURIInput, vaultHash: vaultHashInput });
                      setAgent((prev) => prev ? { ...prev, vault_uri: vaultURIInput, vault_hash: vaultHashInput } : prev);
                      setShowVaultInput(false);
                      toast.success(t('agentDetail.vaultUpdated'));
                    } catch (err: any) {
                      toast.error(err.message || t('agentDetail.vaultUpdateFailed'));
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  disabled={actionLoading || !vaultURIInput}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                >
                  {t('common.confirm')}
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Combo Strategy Editor (owner only) */}
        {isOwner && (
          <ComboStrategyEditor agentId={agent.id} />
        )}

        {/* Buy / Rent buttons (non-owner) */}
        {!isOwner && agent.is_for_sale && (
          <div className="space-y-3">
            {tokenId && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-yellow-400 text-sm">
                <AlertTriangle className="w-4 h-4 inline mr-2" />
                {t('agentDetail.onChainPurchaseNote', { defaultValue: 'This agent is minted on-chain. Purchase requires NFT transfer. Seller must approve your address first.' })}
              </div>
            )}
            <button
              onClick={() => setShowBuyConfirm(true)}
              disabled={actionLoading || isTransferring || isTransferConfirming}
              className="w-full py-4 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold text-lg transition-colors"
            >
              {isTransferring ? t('agentDetail.transferring', { defaultValue: 'Transferring...' }) :
               isTransferConfirming ? t('agentDetail.confirmingTransfer', { defaultValue: 'Confirming...' }) :
               t('agentDetail.buyAgent', { price: agent.sale_price?.toLocaleString() })}
            </button>
          </div>
        )}
        {!isOwner && agent.is_for_rent && !agent.is_for_sale && (
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={rentDays}
              onChange={(e) => setRentDays(e.target.value)}
              min={1}
              className="bg-input-background border border-border text-foreground text-sm py-3 px-4 w-32 focus:outline-none focus:border-blue-500/50"
            />
            <span className="text-muted-foreground text-sm">{t('agentDetail.days')}</span>
            <button
              onClick={() => setShowRentConfirm(true)}
              disabled={actionLoading}
              className="flex-1 py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold text-lg transition-colors"
            >
              {t('agentDetail.rentAgent', { price: agent.rent_price })}
            </button>
          </div>
        )}

        {/* Buy Confirmation Dialog */}
        <AnimatePresence>
          {showBuyConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setShowBuyConfirm(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-card border border-border p-6 max-w-md w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-blue-400" />
                  <h3 className="text-xl font-bold text-foreground">{t('agentDetail.confirmPurchase')}</h3>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t('agentDetail.confirmPurchaseDesc', { name: agent.name, price: agent.sale_price?.toLocaleString() })}
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowBuyConfirm(false)}
                    className="flex-1 py-3 border border-border text-muted-foreground hover:text-foreground font-semibold transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => {
                      setShowBuyConfirm(false);
                      handleBuy();
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold transition-colors"
                  >
                    {t('agentDetail.confirmPurchaseBtn')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rent Confirmation Dialog */}
        <AnimatePresence>
          {showRentConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setShowRentConfirm(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-card border border-border p-6 max-w-md w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-blue-400" />
                  <h3 className="text-xl font-bold text-foreground">{t('agentDetail.confirmRental')}</h3>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t('agentDetail.confirmRentalDesc', { name: agent.name, days: rentDays, price: (Number(agent.rent_price) * Number(rentDays)).toLocaleString() })}
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowRentConfirm(false)}
                    className="flex-1 py-3 border border-border text-muted-foreground hover:text-foreground font-semibold transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => {
                      setShowRentConfirm(false);
                      handleRent();
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold transition-colors"
                  >
                    {t('agentDetail.confirmRentalBtn')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Detail Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
          <div className="flex border-b border-border mb-4 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 scrollbar-hide">
            <div className="flex min-w-max">
              {(isOwner
                ? [
                    { id: 'trades', label: t('agentDetail.tabTrades') },
                    { id: 'predictions', label: t('agentDetail.tabPredictions') },
                    { id: 'suggestions', label: t('agentDetail.tabSuggestions') },
                    { id: 'style', label: t('agentDetail.tabStyle') },
                    { id: 'llm', label: t('agentDetail.tabLlm') },
                    { id: 'copyTrading', label: t('copyTrade.title') },
                    { id: 'earnings', label: t('earnings.title') },
                    { id: 'onchain', label: t('agentDetail.tabOnchain') },
                  ]
                : [
                    { id: 'trades', label: t('agentDetail.tabTrades') },
                    { id: 'predictions', label: t('agentDetail.tabPredictions') },
                    { id: 'style', label: t('agentDetail.tabStyle') },
                    { id: 'copyTrading', label: t('copyTrade.title') },
                  ]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveDetailTab(tab.id as any)}
                  className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeDetailTab === tab.id
                      ? 'text-blue-400 border-b-2 border-blue-500'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeDetailTab === 'trades' && (
            <div className="bg-secondary border border-border">
              <div className="p-4 sm:p-6 border-b border-border">
                <h2 className="text-lg sm:text-xl font-bold">{t('agentDetail.tabTrades')}</h2>
              </div>
              {agent.agent_trades && agent.agent_trades.length > 0 ? (
                <div className="overflow-x-auto -mx-3 sm:mx-0">
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">{t('agentDetail.thTime')}</th>
                        <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">{t('agentDetail.thMarket')}</th>
                        <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">{t('agentDetail.thDirection')}</th>
                        <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">{t('agentDetail.thAmount')}</th>
                        <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">{t('agentDetail.thResult')}</th>
                        <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">{t('agentDetail.thPnl')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {agent.agent_trades.map((trade: AgentTrade) => (
                        <tr key={trade.id} className="hover:bg-accent transition-colors">
                          <td className="p-3 text-muted-foreground text-sm">
                            {new Date(trade.created_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
                          </td>
                          <td className="p-3 text-foreground text-sm font-mono">
                            #{trade.market_id.slice(0, 8)}
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 text-xs font-bold ${
                              trade.side === "yes"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-red-500/20 text-red-400"
                            }`}>
                              {trade.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-3 text-right text-foreground text-sm font-mono">
                            ${trade.amount.toFixed(2)}
                          </td>
                          <td className="p-3 text-center">
                            {trade.outcome === "win" ? (
                              <span className="text-emerald-400 font-bold text-sm">{t('agentDetail.resultWin')}</span>
                            ) : trade.outcome === "loss" ? (
                              <span className="text-red-400 font-bold text-sm">{t('agentDetail.resultLoss')}</span>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {trade.profit !== null ? (
                              <span className={`font-mono text-sm font-bold ${trade.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-12 text-center text-muted-foreground">{t('agentDetail.noTradeHistory')}</div>
              )}
            </div>
          )}

          {(activeDetailTab === 'predictions' || activeDetailTab === 'suggestions') && (
            <AgentInteraction agentId={agent.id} isOwner={!!isOwner} tokenId={agent.token_id} markets={markets} />
          )}

          {activeDetailTab === 'style' && (
            <PredictionStyleDashboard agentId={agent.id} />
          )}

          {activeDetailTab === 'llm' && isOwner && (
            <LlmConfigPanel agentId={agent.id} />
          )}

          {activeDetailTab === 'copyTrading' && (
            <div className="space-y-4">
              <CopyTradePanel
                agentId={agent.id}
                isOwner={!!isOwner}
                agentTokenId={agent.token_id ? BigInt(agent.token_id) : undefined}
              />
              <CopyTradeHistory />
            </div>
          )}

          {activeDetailTab === 'earnings' && isOwner && (
            <EarningsDashboard agentId={agent.id} />
          )}

          {activeDetailTab === 'onchain' && isOwner && tokenId && (
            <div className="space-y-6">
              <div className="bg-secondary border border-border p-6">
                <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                  {t("agentDetail.learningMetrics", { defaultValue: "Learning Metrics" })}
                </h3>
                {learningMetrics ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.totalInteractions", { defaultValue: "Total Interactions" })}</div>
                        <div className="text-foreground font-mono">{learningMetrics.totalInteractions}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.successfulOutcomes", { defaultValue: "Successful Outcomes" })}</div>
                        <div className="text-foreground font-mono">{learningMetrics.successfulOutcomes}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.learningRoot", { defaultValue: "Learning Root" })}</div>
                        <div className="text-foreground font-mono text-sm break-all">
                          {learningMetrics.learningRoot}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.lastUpdated", { defaultValue: "Last Updated" })}</div>
                        <div className="text-foreground font-mono text-sm">
                          {learningMetrics.lastUpdated > 0
                            ? new Date(learningMetrics.lastUpdated * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                            : t("agentDetail.never", { defaultValue: "Never" })}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-border pt-4 mt-4">
                      <div className="text-muted-foreground text-sm mb-3">{t("agentDetail.updateLearningRoot", { defaultValue: "Update Learning Root" })}</div>
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={learningRoot}
                          onChange={(e) => setLearningRoot(e.target.value)}
                          placeholder="0x..."
                          className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                        />
                        <input
                          type="text"
                          value={learningProof}
                          onChange={(e) => setLearningProof(e.target.value)}
                          placeholder={t("agentDetail.proofPlaceholder", { defaultValue: "Proof (0x...)" })}
                          className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                        />
                        <button
                          onClick={() => {
                            if (!tokenId || !learningRoot || !learningProof) return;
                            updateLearning(tokenId, learningRoot as `0x${string}`, learningProof as `0x${string}`);
                          }}
                          disabled={isUpdatingLearning || !learningRoot || !learningProof}
                          className="px-6 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                        >
                          {isUpdatingLearning ? t("agentDetail.updating", { defaultValue: "Updating..." }) : t("agentDetail.updateRoot", { defaultValue: "Update Root" })}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">{t("agentDetail.loadingMetrics", { defaultValue: "Loading metrics..." })}</div>
                )}
              </div>

              <div className="bg-secondary border border-border p-6">
                <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                  {t("agentDetail.memoryModules", { defaultValue: "Memory Modules" })}
                </h3>
                <div className="space-y-4">
                  <div className="border border-border p-4">
                    <div className="text-muted-foreground text-sm mb-3">{t("agentDetail.queryModule", { defaultValue: "Query Module" })}</div>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={queryModuleAddress}
                        onChange={(e) => setQueryModuleAddress(e.target.value)}
                        placeholder={t("agentDetail.moduleAddressPlaceholder", { defaultValue: "Module Address (0x...)" })}
                        className="flex-1 bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                      />
                      <button
                        onClick={() => refetchModule()}
                        disabled={!queryModuleAddress}
                        className="px-6 py-2 bg-muted hover:bg-muted/80 disabled:opacity-50 text-foreground text-sm font-semibold transition-colors"
                      >
                        {t("agentDetail.query", { defaultValue: "Query" })}
                      </button>
                    </div>
                    {queriedModule && (
                      <div className="mt-4 space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.address", { defaultValue: "Address:" })}</span>{' '}
                          <span className="text-foreground font-mono">{queriedModule.moduleAddress}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.metadata", { defaultValue: "Metadata:" })}</span>{' '}
                          <span className="text-foreground">{queriedModule.metadata}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.hash", { defaultValue: "Hash:" })}</span>{' '}
                          <span className="text-foreground font-mono text-xs break-all">{queriedModule.metadataHash}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.status", { defaultValue: "Status:" })}</span>{' '}
                          <span className={queriedModule.isActive ? 'text-green-400' : 'text-red-400'}>
                            {queriedModule.isActive ? t("agentDetail.active", { defaultValue: "Active" }) : t("agentDetail.inactive", { defaultValue: "Inactive" })}
                          </span>
                        </div>
                        {queriedModule.isActive && (
                          <button
                            onClick={() => {
                              if (!tokenId || !queryModuleAddress) return;
                              deactivateModule(tokenId, queryModuleAddress as `0x${string}`);
                            }}
                            disabled={isDeactivatingModule}
                            className="mt-2 px-4 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                          >
                            {isDeactivatingModule ? t("agentDetail.deactivating", { defaultValue: "Deactivating..." }) : t("agentDetail.deactivate", { defaultValue: "Deactivate" })}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border border-border p-4">
                    <div className="text-muted-foreground text-sm mb-3">{t("agentDetail.registerNewModule", { defaultValue: "Register New Module" })}</div>
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={moduleAddress}
                        onChange={(e) => setModuleAddress(e.target.value)}
                        placeholder={t("agentDetail.moduleAddressPlaceholder", { defaultValue: "Module Address (0x...)" })}
                        className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                      />
                      <input
                        type="text"
                        value={moduleMetadata}
                        onChange={(e) => setModuleMetadata(e.target.value)}
                        placeholder={t("agentDetail.metadataPlaceholder", { defaultValue: "Metadata (e.g., reasoning, memory, etc.)" })}
                        className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
                      />
                      <button
                        onClick={() => {
                          if (!tokenId || !moduleAddress || !moduleMetadata) return;
                          registerModule(tokenId, moduleAddress as `0x${string}`, moduleMetadata);
                        }}
                        disabled={isRegisteringModule || !moduleAddress || !moduleMetadata}
                        className="px-6 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                      >
                        {isRegisteringModule ? t("agentDetail.registering", { defaultValue: "Registering..." }) : t("agentDetail.register", { defaultValue: "Register" })}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-secondary border border-border p-6">
                <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                  {t("agentDetail.vaultAccessControl", { defaultValue: "Vault Access Control" })}
                </h3>
                <div className="space-y-4">
                  <div className="border border-border p-4">
                    <div className="text-muted-foreground text-sm mb-3">{t("agentDetail.delegateAccess", { defaultValue: "Delegate Access" })}</div>
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={delegateAddress}
                        onChange={(e) => setDelegateAddress(e.target.value)}
                        placeholder={t("agentDetail.delegateAddressPlaceholder", { defaultValue: "Delegate Address (0x...)" })}
                        className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.permissionLevel", { defaultValue: "Permission Level" })}</div>
                          <select
                            value={delegateLevel}
                            onChange={(e) => setDelegateLevel(e.target.value)}
                            className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50"
                          >
                            <option value="1">{t("agentDetail.levelRead", { defaultValue: "Level 1 (Read)" })}</option>
                            <option value="2">{t("agentDetail.levelWrite", { defaultValue: "Level 2 (Write)" })}</option>
                            <option value="3">{t("agentDetail.levelAdmin", { defaultValue: "Level 3 (Admin)" })}</option>
                          </select>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs mb-1">{t("agentDetail.durationHours", { defaultValue: "Duration (hours)" })}</div>
                          <input
                            type="number"
                            value={delegateDuration}
                            onChange={(e) => setDelegateDuration(e.target.value)}
                            min="1"
                            className="w-full bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (!tokenId || !delegateAddress || !delegateDuration) return;
                          const expiryTime = BigInt(Math.floor(Date.now() / 1000) + Number(delegateDuration) * 3600);
                          delegateAccess(tokenId, delegateAddress as `0x${string}`, Number(delegateLevel), expiryTime);
                        }}
                        disabled={isDelegating || !delegateAddress || !delegateDuration}
                        className="px-6 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                      >
                        {isDelegating ? t("agentDetail.delegating", { defaultValue: "Delegating..." }) : t("agentDetail.grantAccess", { defaultValue: "Grant Access" })}
                      </button>
                    </div>
                  </div>

                  <div className="border border-border p-4">
                    <div className="text-muted-foreground text-sm mb-3">{t("agentDetail.checkPermission", { defaultValue: "Check Permission" })}</div>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={checkPermissionAddress}
                        onChange={(e) => setCheckPermissionAddress(e.target.value)}
                        placeholder={t("agentDetail.addressPlaceholder", { defaultValue: "Address (0x...)" })}
                        className="flex-1 bg-card border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 font-mono"
                      />
                      <button
                        onClick={() => refetchPermission()}
                        disabled={!checkPermissionAddress}
                        className="px-6 py-2 bg-muted hover:bg-muted/80 disabled:opacity-50 text-foreground text-sm font-semibold transition-colors"
                      >
                        {t("agentDetail.check", { defaultValue: "Check" })}
                      </button>
                    </div>
                    {checkedPermission && (
                      <div className="mt-4 space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.level", { defaultValue: "Level:" })}</span>{' '}
                          <span className="text-foreground">
                            {checkedPermission.level === 1 ? t("agentDetail.read", { defaultValue: "Read" }) : checkedPermission.level === 2 ? t("agentDetail.write", { defaultValue: "Write" }) : t("agentDetail.admin", { defaultValue: "Admin" })}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.expiry", { defaultValue: "Expiry:" })}</span>{' '}
                          <span className="text-foreground">
                            {checkedPermission.expiryTime > 0
                              ? new Date(checkedPermission.expiryTime * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                              : t("agentDetail.never", { defaultValue: "Never" })}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("agentDetail.status", { defaultValue: "Status:" })}</span>{' '}
                          <span className={checkedPermission.isActive ? 'text-green-400' : 'text-red-400'}>
                            {checkedPermission.isActive ? t("agentDetail.active", { defaultValue: "Active" }) : t("agentDetail.inactive", { defaultValue: "Inactive" })}
                          </span>
                        </div>
                        {checkedPermission.isActive && (
                          <button
                            onClick={() => {
                              if (!tokenId || !checkPermissionAddress) return;
                              revokeAccess(tokenId, checkPermissionAddress as `0x${string}`);
                            }}
                            disabled={isRevoking}
                            className="mt-2 px-4 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                          >
                            {isRevoking ? t("agentDetail.revoking", { defaultValue: "Revoking..." }) : t("agentDetail.revokeAccess", { defaultValue: "Revoke Access" })}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
