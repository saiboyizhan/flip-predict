import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
} from "@/app/services/api";
import type { AgentDetail as AgentDetailType, AgentTrade } from "@/app/services/api";
import { useAccount } from "wagmi";
import { AgentInteraction } from "./AgentInteraction";
import { PredictionStyleDashboard } from "./PredictionStyleDashboard";

const STRATEGY_MAP: Record<string, { labelKey: string; color: string }> = {
  conservative: { labelKey: "agent.strategies.conservative", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  aggressive: { labelKey: "agent.strategies.aggressive", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  contrarian: { labelKey: "agent.strategies.contrarian", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  momentum: { labelKey: "agent.strategies.momentum", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  random: { labelKey: "agent.strategies.random", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
};

const GRADIENT_PAIRS = [
  ["from-amber-500", "to-purple-600"],
  ["from-emerald-500", "to-blue-600"],
  ["from-red-500", "to-amber-600"],
  ["from-blue-500", "to-emerald-600"],
  ["from-purple-500", "to-red-600"],
  ["from-pink-500", "to-amber-600"],
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
  const navigate = useNavigate();
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
  const [activeDetailTab, setActiveDetailTab] = useState<'trades' | 'predictions' | 'suggestions' | 'style' | 'auto'>('trades');
  const [markets, setMarkets] = useState<any[]>([]);
  const [showBuyConfirm, setShowBuyConfirm] = useState(false);
  const [showRentConfirm, setShowRentConfirm] = useState(false);

  const isOwner = address && agent && agent.owner_address.toLowerCase() === address.toLowerCase();

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
    fetchMarkets().then((data) => setMarkets(data)).catch(() => {});
  }, []);

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
    if (!id) return;
    setActionLoading(true);
    try {
      await buyAgent(id);
      toast.success(t('agentDetail.purchaseSuccess'));
      navigate("/agents");
    } catch (err: any) {
      toast.error(err.message || t('agentDetail.purchaseFailed'));
    } finally {
      setActionLoading(false);
    }
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
        <div className="text-zinc-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <p className="text-zinc-400">{t('agentDetail.notFound')}</p>
        <button onClick={() => navigate("/agents")} className="text-amber-400 hover:text-amber-300 text-sm mt-2">
          {t('agentDetail.backToList')}
        </button>
      </div>
    );
  }

  const strategy = STRATEGY_MAP[agent.strategy] || STRATEGY_MAP.random;
  const gradientIndex = Math.abs(hashCode(agent.name)) % GRADIENT_PAIRS.length;
  const [from, to] = GRADIENT_PAIRS[gradientIndex];

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('agentDetail.back')}
        </button>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-950 border border-zinc-800 p-6"
        >
          <div className="flex items-start gap-4">
            <div className={`w-16 h-16 bg-gradient-to-br ${from} ${to} flex items-center justify-center shrink-0`}>
              <span className="text-white font-bold text-2xl">{agent.name.charAt(0)}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-2xl font-bold">{agent.name}</h1>
                <span className="px-2 py-0.5 bg-amber-500 text-black text-sm font-bold">Lv.{agent.level}</span>
                <span className={`px-2 py-0.5 text-xs border ${strategy.color}`}>{t(strategy.labelKey)}</span>
                <span className={`px-2 py-0.5 text-xs border ${
                  agent.status === "active" ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400" : "border-zinc-700 bg-zinc-800 text-zinc-400"
                }`}>
                  {agent.status === "active" ? t('agentDetail.statusActive') : agent.status === "idle" ? t('agentDetail.statusIdle') : agent.status}
                </span>
              </div>
              {agent.description && <p className="text-zinc-400 text-sm">{agent.description}</p>}
              <p className="text-zinc-600 text-xs font-mono mt-1">
                Owner: {agent.owner_address.slice(0, 6)}...{agent.owner_address.slice(-4)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 sm:grid-cols-6 gap-4"
        >
          <div className="bg-zinc-950 border border-zinc-800 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
              <DollarSign className="w-4 h-4" />
              {t('agentDetail.totalProfit')}
            </div>
            <div className={`text-xl font-bold font-mono ${agent.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {agent.total_profit >= 0 ? "+" : ""}${agent.total_profit.toFixed(2)}
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
              <Percent className="w-4 h-4" />
              {t('agentDetail.winRate')}
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {agent.win_rate.toFixed(1)}%
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
              <TrendingUp className="w-4 h-4" />
              ROI
            </div>
            <div className={`text-xl font-bold font-mono ${agent.roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {agent.roi >= 0 ? "+" : ""}{agent.roi.toFixed(1)}%
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
              <Wallet className="w-4 h-4" />
              {t('agentDetail.balance')}
            </div>
            <div className="text-xl font-bold font-mono text-amber-400">
              ${agent.wallet_balance.toFixed(2)}
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
              <Target className="w-4 h-4" />
              {t('agentDetail.predAccuracy')}
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {(agent as any).reputation_score ? `${(agent as any).reputation_score}%` : "-"}
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-sm mb-2">
              <Star className="w-4 h-4" />
              {t('agentDetail.reputation')}
            </div>
            <div className="text-xl font-bold font-mono text-amber-400">
              {(agent as any).reputation_score || 0}
            </div>
          </div>
        </motion.div>

        {/* Vault Info */}
        {(agent.vault_uri || isOwner) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="bg-zinc-950 border border-zinc-800 p-6"
          >
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-amber-400" />
              {t('agentDetail.vaultStorage')}
            </h3>
            {agent.vault_uri ? (
              <div className="space-y-3">
                <div>
                  <div className="text-zinc-500 text-xs mb-1">Vault URI</div>
                  <a
                    href={agent.vault_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300 text-sm font-mono flex items-center gap-1 break-all"
                  >
                    <Link2 className="w-3 h-3 shrink-0" />
                    {agent.vault_uri}
                  </a>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs mb-1">Vault Hash</div>
                  <div className="text-white text-sm font-mono break-all">
                    {agent.vault_hash || "-"}
                  </div>
                </div>
              </div>
            ) : isOwner ? (
              <p className="text-zinc-500 text-sm">
                {t('agentDetail.vaultNotConfigured')}
              </p>
            ) : null}
          </motion.div>
        )}

        {/* Owner Actions */}
        {isOwner && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-zinc-950 border border-zinc-800 p-6 space-y-4"
          >
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Settings className="w-5 h-5 text-amber-400" />
              {t('agentDetail.manage')}
            </h3>

            {/* Strategy Change */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-zinc-400">{t('agentDetail.changeStrategy')}</span>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-white text-sm py-1.5 px-3 focus:outline-none focus:border-amber-500/50"
              >
                {Object.entries(STRATEGY_MAP).map(([key, val]) => (
                  <option key={key} value={key}>{t(val.labelKey)}</option>
                ))}
              </select>
              <button
                onClick={handleUpdateStrategy}
                disabled={actionLoading || selectedStrategy === agent.strategy}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
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
                    className="flex items-center gap-2 px-4 py-2 border border-zinc-700 hover:border-amber-500 text-sm text-zinc-300 hover:text-amber-400 transition-colors"
                  >
                    <Tag className="w-4 h-4" />
                    {t('agentDetail.listForSale')}
                  </button>
                  <button
                    onClick={() => setShowRentInput(!showRentInput)}
                    className="flex items-center gap-2 px-4 py-2 border border-zinc-700 hover:border-amber-500 text-sm text-zinc-300 hover:text-amber-400 transition-colors"
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
                  className="bg-zinc-900 border border-zinc-800 text-white text-sm py-2 px-3 w-40 focus:outline-none focus:border-amber-500/50"
                />
                <button
                  onClick={handleListSale}
                  disabled={actionLoading || !salePrice}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
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
                  className="bg-zinc-900 border border-zinc-800 text-white text-sm py-2 px-3 w-40 focus:outline-none focus:border-amber-500/50"
                />
                <button
                  onClick={handleListRent}
                  disabled={actionLoading || !rentPrice}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                >
                  {t('common.confirm')}
                </button>
              </div>
            )}

            {/* Vault Update */}
            <div className="border-t border-zinc-800 pt-4">
              <button
                onClick={() => setShowVaultInput(!showVaultInput)}
                className="flex items-center gap-2 px-4 py-2 border border-zinc-700 hover:border-amber-500 text-sm text-zinc-300 hover:text-amber-400 transition-colors"
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
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2 px-3 focus:outline-none focus:border-amber-500/50"
                />
                <input
                  type="text"
                  value={vaultHashInput}
                  onChange={(e) => setVaultHashInput(e.target.value)}
                  placeholder="Vault Hash"
                  className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-2 px-3 focus:outline-none focus:border-amber-500/50"
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
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                >
                  {t('common.confirm')}
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Buy / Rent buttons (non-owner) */}
        {!isOwner && agent.is_for_sale && (
          <button
            onClick={() => setShowBuyConfirm(true)}
            disabled={actionLoading}
            className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-lg transition-colors"
          >
            {t('agentDetail.buyAgent', { price: agent.sale_price?.toLocaleString() })}
          </button>
        )}
        {!isOwner && agent.is_for_rent && !agent.is_for_sale && (
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={rentDays}
              onChange={(e) => setRentDays(e.target.value)}
              min={1}
              className="bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 w-32 focus:outline-none focus:border-amber-500/50"
            />
            <span className="text-zinc-400 text-sm">{t('agentDetail.days')}</span>
            <button
              onClick={() => setShowRentConfirm(true)}
              disabled={actionLoading}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-lg transition-colors"
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
                className="bg-zinc-900 border border-zinc-700 p-6 max-w-md w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                  <h3 className="text-xl font-bold text-white">{t('agentDetail.confirmPurchase')}</h3>
                </div>
                <p className="text-zinc-400 text-sm">
                  {t('agentDetail.confirmPurchaseDesc', { name: agent.name, price: agent.sale_price?.toLocaleString() })}
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowBuyConfirm(false)}
                    className="flex-1 py-3 border border-zinc-700 text-zinc-300 hover:text-white font-semibold transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => {
                      setShowBuyConfirm(false);
                      handleBuy();
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold transition-colors"
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
                className="bg-zinc-900 border border-zinc-700 p-6 max-w-md w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                  <h3 className="text-xl font-bold text-white">{t('agentDetail.confirmRental')}</h3>
                </div>
                <p className="text-zinc-400 text-sm">
                  {t('agentDetail.confirmRentalDesc', { name: agent.name, days: rentDays, price: (Number(agent.rent_price) * Number(rentDays)).toLocaleString() })}
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowRentConfirm(false)}
                    className="flex-1 py-3 border border-zinc-700 text-zinc-300 hover:text-white font-semibold transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => {
                      setShowRentConfirm(false);
                      handleRent();
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold transition-colors"
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
          <div className="flex border-b border-zinc-800 mb-4">
            {(isOwner
              ? [
                  { id: 'trades', label: t('agentDetail.tabTrades') },
                  { id: 'predictions', label: t('agentDetail.tabPredictions') },
                  { id: 'suggestions', label: t('agentDetail.tabSuggestions') },
                  { id: 'style', label: t('agentDetail.tabStyle') },
                  { id: 'auto', label: t('agentDetail.tabAuto') },
                ]
              : [
                  { id: 'trades', label: t('agentDetail.tabTrades') },
                  { id: 'predictions', label: t('agentDetail.tabPredictions') },
                  { id: 'style', label: t('agentDetail.tabStyle') },
                ]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveDetailTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeDetailTab === tab.id
                    ? 'text-amber-400 border-b-2 border-amber-500'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeDetailTab === 'trades' && (
            <div className="bg-zinc-950 border border-zinc-800">
              <div className="p-6 border-b border-zinc-800">
                <h2 className="text-xl font-bold">{t('agentDetail.tabTrades')}</h2>
              </div>
              {agent.agent_trades && agent.agent_trades.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-zinc-900/50 border-b border-zinc-800">
                      <tr>
                        <th className="text-left p-3 text-zinc-500 text-xs uppercase tracking-wider">{t('agentDetail.thTime')}</th>
                        <th className="text-left p-3 text-zinc-500 text-xs uppercase tracking-wider">{t('agentDetail.thMarket')}</th>
                        <th className="text-center p-3 text-zinc-500 text-xs uppercase tracking-wider">{t('agentDetail.thDirection')}</th>
                        <th className="text-right p-3 text-zinc-500 text-xs uppercase tracking-wider">{t('agentDetail.thAmount')}</th>
                        <th className="text-center p-3 text-zinc-500 text-xs uppercase tracking-wider">{t('agentDetail.thResult')}</th>
                        <th className="text-right p-3 text-zinc-500 text-xs uppercase tracking-wider">{t('agentDetail.thPnl')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {agent.agent_trades.map((trade: AgentTrade) => (
                        <tr key={trade.id} className="hover:bg-zinc-900/50 transition-colors">
                          <td className="p-3 text-zinc-400 text-sm">
                            {new Date(trade.created_at).toLocaleDateString("zh-CN")}
                          </td>
                          <td className="p-3 text-white text-sm font-mono">
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
                          <td className="p-3 text-right text-white text-sm font-mono">
                            ${trade.amount.toFixed(2)}
                          </td>
                          <td className="p-3 text-center">
                            {trade.outcome === "win" ? (
                              <span className="text-emerald-400 font-bold text-sm">{t('agentDetail.resultWin')}</span>
                            ) : trade.outcome === "loss" ? (
                              <span className="text-red-400 font-bold text-sm">{t('agentDetail.resultLoss')}</span>
                            ) : (
                              <span className="text-zinc-500 text-sm">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {trade.profit !== null ? (
                              <span className={`font-mono text-sm font-bold ${trade.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-zinc-500 text-sm">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-12 text-center text-zinc-600">{t('agentDetail.noTradeHistory')}</div>
              )}
            </div>
          )}

          {(activeDetailTab === 'predictions' || activeDetailTab === 'suggestions' || activeDetailTab === 'auto') && (
            <AgentInteraction agentId={agent.id} isOwner={!!isOwner} markets={markets} />
          )}

          {activeDetailTab === 'style' && (
            <PredictionStyleDashboard agentId={agent.id} />
          )}
        </motion.div>
      </div>
    </div>
  );
}
