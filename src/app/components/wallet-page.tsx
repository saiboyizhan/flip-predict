import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect } from "react";
import { Wallet, Copy, ExternalLink, TrendingUp, ArrowUpRight, ArrowDownRight, Clock, Link2, CheckCircle2, AlertCircle, Loader2, Plus, Minus, X } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatUnits } from "viem";
import { useTranslation } from "react-i18next";
import { useUSDTBalance } from "../hooks/useUSDTBalance";
import { fetchBalance, fetchTradeHistory, fetchUserStats, depositFunds, withdrawFunds } from "../services/api";

interface Transaction {
  id: string;
  type: "bet" | "win" | "deposit" | "withdraw" | "buy" | "sell";
  amount: number;
  market?: string;
  timestamp: string;
  status: "completed" | "pending";
  txHash: string;
}

function TransactionSkeleton() {
  return (
    <div className="p-4 sm:p-6 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 flex-1">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-800 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-zinc-800 rounded w-1/3" />
            <div className="h-3 bg-zinc-800 rounded w-1/4" />
          </div>
        </div>
        <div className="h-6 bg-zinc-800 rounded w-20" />
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 sm:p-8 animate-pulse">
      <div className="h-3 bg-zinc-800 rounded w-16 mb-3" />
      <div className="h-8 bg-zinc-800 rounded w-24 mb-2" />
      <div className="h-3 bg-zinc-800 rounded w-20" />
    </div>
  );
}

export function WalletPage() {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { formatted: usdtFormatted, isLoading: usdtLoading } = useUSDTBalance(address);

  const [platformBalance, setPlatformBalance] = useState<{ available: number; locked: number; total: number } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userStats, setUserStats] = useState<{ totalTrades: number; winRate: number; totalProfit: number; totalWins: number } | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

  // Deposit / Withdraw state
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositTxHash, setDepositTxHash] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [depositProcessing, setDepositProcessing] = useState(false);
  const [withdrawProcessing, setWithdrawProcessing] = useState(false);

  const walletAddress = address ?? "";
  const bnbBalance = balanceData
    ? parseFloat(formatUnits(balanceData.value, balanceData.decimals))
    : 0;

  // Fetch real data when connected
  useEffect(() => {
    if (!isConnected || !address) return;

    setLoadingBalance(true);
    fetchBalance(address)
      .then((data) => setPlatformBalance(data))
      .catch(() => setPlatformBalance(null))
      .finally(() => setLoadingBalance(false));

    setLoadingHistory(true);
    fetchTradeHistory(address)
      .then((data) => {
        const trades = data.trades ?? [];
        const normalized: Transaction[] = trades.map((tx: any) => {
          const type = tx.type as Transaction["type"];
          const rawAmount = Number(tx.amount) || 0;
          return {
            id: String(tx.id),
            type,
            amount: type === "buy" ? -Math.abs(rawAmount) : rawAmount,
            market: tx.market ?? tx.market_title ?? undefined,
            timestamp: tx.timestamp
              ? String(tx.timestamp)
              : new Date(Number(tx.created_at) || Date.now()).toLocaleString(),
            status: tx.status === "pending" ? "pending" : "completed",
            txHash: tx.txHash ?? tx.tx_hash ?? "",
          };
        });
        setTransactions(normalized);
      })
      .catch(() => setTransactions([]))
      .finally(() => setLoadingHistory(false));

    setLoadingStats(true);
    fetchUserStats(address)
      .then((data) => setUserStats(data))
      .catch(() => setUserStats(null))
      .finally(() => setLoadingStats(false));
  }, [isConnected, address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    toast.success(t('wallet.addressCopied'));
  };

  const disconnectWallet = () => {
    disconnect();
    toast.success(t('wallet.disconnected'));
  };

  const refreshBalance = () => {
    if (!address) return;
    fetchBalance(address)
      .then((data) => setPlatformBalance(data))
      .catch(() => {});
  };

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) {
      toast.error(t('wallet.invalidAmount'));
      return;
    }
    if (!depositTxHash.trim()) {
      toast.error(t('wallet.txHash'));
      return;
    }

    setDepositProcessing(true);
    try {
      const result = await depositFunds(amt, depositTxHash.trim());
      if (result.success) {
        setPlatformBalance(result.balance);
        toast.success(t('wallet.depositSuccess'));
        setShowDepositForm(false);
        setDepositAmount("");
        setDepositTxHash("");
      }
    } catch (err: any) {
      toast.error(err.message || t('common.error'));
    } finally {
      setDepositProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) {
      toast.error(t('wallet.invalidAmount'));
      return;
    }
    if (platformBalance && amt > platformBalance.available) {
      toast.error(t('wallet.insufficientBalance'));
      return;
    }
    if (!withdrawAddress.trim()) {
      toast.error(t('wallet.destinationAddress'));
      return;
    }

    setWithdrawProcessing(true);
    try {
      const result = await withdrawFunds(amt, withdrawAddress.trim());
      if (result.success) {
        setPlatformBalance(result.balance);
        toast.success(t('wallet.withdrawSuccess'));
        setShowWithdrawForm(false);
        setWithdrawAmount("");
        setWithdrawAddress("");
      }
    } catch (err: any) {
      toast.error(err.message || t('common.error'));
    } finally {
      setWithdrawProcessing(false);
    }
  };

  const getTransactionIcon = (type: Transaction["type"]) => {
    switch (type) {
      case "win":
        return <ArrowDownRight className="w-5 h-5 text-emerald-400" />;
      case "deposit":
        return <ArrowDownRight className="w-5 h-5 text-blue-400" />;
      case "bet":
      case "buy":
        return <ArrowUpRight className="w-5 h-5 text-amber-400" />;
      case "withdraw":
      case "sell":
        return <ArrowUpRight className="w-5 h-5 text-zinc-400" />;
    }
  };

  const getTransactionLabel = (type: Transaction["type"]) => {
    switch (type) {
      case "win":
        return t('wallet.txWin');
      case "deposit":
        return t('wallet.txDeposit');
      case "bet":
      case "buy":
        return t('wallet.txBet');
      case "withdraw":
      case "sell":
        return t('wallet.txWithdraw');
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <Wallet className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{t('wallet.title')}</h1>
          </div>

          {/* 连接状态 */}
          {isConnected && (
            <div className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-emerald-500/20 border border-emerald-500/40">
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              <span className="text-emerald-400 text-xs sm:text-sm tracking-wider uppercase">{t('wallet.connected')}</span>
            </div>
          )}
        </div>

        {/* 未连接状态 */}
        {!isConnected ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900/50 border-2 border-zinc-800 p-8 sm:p-16 text-center"
          >
            <div className="max-w-xl mx-auto space-y-6">
              <div className="w-24 h-24 mx-auto bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-2 border-amber-500/30 flex items-center justify-center">
                <Wallet className="w-12 h-12 text-amber-400" />
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('wallet.connectTitle')}</h2>
                <p className="text-zinc-400 text-base sm:text-lg">
                  {t('wallet.connectDesc')}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="p-4 bg-zinc-950 border border-zinc-800">
                  <AlertCircle className="w-6 h-6 text-amber-400 mb-2" />
                  <div className="text-zinc-400 text-sm">{t('wallet.decentralized')}</div>
                </div>
                <div className="p-4 bg-zinc-950 border border-zinc-800">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 mb-2" />
                  <div className="text-zinc-400 text-sm">{t('wallet.secure')}</div>
                </div>
                <div className="p-4 bg-zinc-950 border border-zinc-800">
                  <Link2 className="w-6 h-6 text-blue-400 mb-2" />
                  <div className="text-zinc-400 text-sm">{t('wallet.instant')}</div>
                </div>
              </div>

              <button
                onClick={openConnectModal}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-6 text-xl tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group mt-8"
              >
                <Link2 className="w-6 h-6 group-hover:scale-110 transition-transform" />
                {t('wallet.connectButton')}
              </button>

              <div className="text-zinc-500 text-sm pt-4">
                {t('wallet.supportedWallets')}
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {/* 已连接状态 - 显示余额和功能 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {/* Platform Balance */}
              {loadingBalance ? (
                <StatSkeleton />
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 sm:p-8"
                >
                  <div className="text-zinc-500 text-sm tracking-wider uppercase mb-2">{t('wallet.platformBalance')}</div>
                  <div className="text-3xl sm:text-5xl font-bold text-white mb-2">
                    ${platformBalance ? platformBalance.available.toLocaleString() : "0"}
                  </div>
                  {platformBalance && platformBalance.locked > 0 && (
                    <div className="text-zinc-500 text-sm">
                      {t('wallet.locked', { amount: platformBalance.locked.toLocaleString() })}
                    </div>
                  )}
                </motion.div>
              )}

              {/* BNB Balance */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 sm:p-8"
              >
                <div className="text-zinc-500 text-sm tracking-wider uppercase mb-2">{t('wallet.bnbBalance')}</div>
                <div className="text-3xl sm:text-5xl font-bold text-white mb-2">{bnbBalance.toFixed(4)}</div>
                <div className="text-zinc-500 text-sm">{t('wallet.bscMainnet')}</div>
              </motion.div>

              {/* USDT Balance */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 sm:p-8"
              >
                <div className="text-zinc-500 text-sm tracking-wider uppercase mb-2">{t('wallet.usdtBalance')}</div>
                <div className="text-3xl sm:text-5xl font-bold text-white mb-2">
                  {usdtLoading ? "..." : usdtFormatted}
                </div>
                <div className="text-zinc-500 text-sm">{t('wallet.bscBep20')}</div>
              </motion.div>

              {/* User Stats */}
              {loadingStats ? (
                <StatSkeleton />
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-gradient-to-br from-amber-900/20 to-zinc-950 border border-amber-500/30 p-6 sm:p-8"
                >
                  <div className="text-amber-400 text-sm tracking-wider uppercase mb-2">{t('wallet.totalWinnings')}</div>
                  <div className="text-3xl sm:text-5xl font-bold text-amber-400 mb-2">
                    ${userStats ? userStats.totalProfit.toLocaleString() : "0"}
                  </div>
                  <div className="text-zinc-500 text-sm">
                    {userStats ? t('wallet.winsAndRate', { wins: userStats.totalWins, rate: (userStats.winRate * 100).toFixed(1) }) : t('common.noData')}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Deposit / Withdraw Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="grid grid-cols-2 gap-4"
            >
              <button
                onClick={() => { setShowDepositForm(true); setShowWithdrawForm(false); }}
                className="p-4 sm:p-6 bg-zinc-900/50 border border-zinc-800 hover:border-amber-500/60 hover:bg-amber-900/10 text-white font-bold text-base sm:text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400 group-hover:scale-110 transition-transform" />
                {t('wallet.deposit')}
              </button>
              <button
                onClick={() => { setShowWithdrawForm(true); setShowDepositForm(false); }}
                className="p-4 sm:p-6 bg-zinc-900/50 border border-zinc-800 hover:border-amber-500/60 hover:bg-amber-900/10 text-white font-bold text-base sm:text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <Minus className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400 group-hover:scale-110 transition-transform" />
                {t('wallet.withdraw')}
              </button>
            </motion.div>

            {/* Deposit Form */}
            <AnimatePresence>
              {showDepositForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-zinc-900/50 border border-amber-500/30 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-amber-400 tracking-wide uppercase">{t('wallet.deposit')}</h3>
                      <button onClick={() => setShowDepositForm(false)} className="p-1 hover:bg-zinc-800 transition-colors">
                        <X className="w-5 h-5 text-zinc-400" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-zinc-400 text-sm mb-2">{t('wallet.depositAmount')}</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 text-white text-lg p-3 outline-none transition-colors placeholder:text-zinc-600"
                      />
                    </div>

                    <div>
                      <label className="block text-zinc-400 text-sm mb-2">{t('wallet.txHash')}</label>
                      <input
                        type="text"
                        value={depositTxHash}
                        onChange={(e) => setDepositTxHash(e.target.value)}
                        placeholder={t('wallet.txHashPlaceholder')}
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 text-white text-sm p-3 outline-none transition-colors font-mono placeholder:text-zinc-600"
                      />
                    </div>

                    <button
                      onClick={handleDeposit}
                      disabled={depositProcessing}
                      className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 disabled:cursor-not-allowed text-black font-bold py-3 text-base tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      {depositProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          {t('wallet.processing')}
                        </>
                      ) : (
                        t('wallet.deposit')
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Withdraw Form */}
            <AnimatePresence>
              {showWithdrawForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-zinc-900/50 border border-amber-500/30 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-amber-400 tracking-wide uppercase">{t('wallet.withdraw')}</h3>
                      <button onClick={() => setShowWithdrawForm(false)} className="p-1 hover:bg-zinc-800 transition-colors">
                        <X className="w-5 h-5 text-zinc-400" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-zinc-400 text-sm mb-2">{t('wallet.withdrawAmount')}</label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 text-white text-lg p-3 outline-none transition-colors placeholder:text-zinc-600"
                        />
                        {platformBalance && (
                          <div className="text-zinc-500 text-xs mt-1">
                            {t('wallet.platformBalance')}: ${platformBalance.available.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-zinc-400 text-sm mb-2">{t('wallet.destinationAddress')}</label>
                      <input
                        type="text"
                        value={withdrawAddress}
                        onChange={(e) => setWithdrawAddress(e.target.value)}
                        placeholder={t('wallet.destinationPlaceholder')}
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 text-white text-sm p-3 outline-none transition-colors font-mono placeholder:text-zinc-600"
                      />
                    </div>

                    <button
                      onClick={handleWithdraw}
                      disabled={withdrawProcessing}
                      className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 disabled:cursor-not-allowed text-black font-bold py-3 text-base tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      {withdrawProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          {t('wallet.processing')}
                        </>
                      ) : (
                        t('wallet.withdraw')
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Wallet Address */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-zinc-900/50 border border-zinc-800 p-4 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-500 text-sm tracking-wider uppercase mb-2">{t('wallet.walletAddress')}</div>
                  <div className="text-white text-sm sm:text-lg font-mono truncate">{walletAddress}</div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <button
                    onClick={copyAddress}
                    className="p-3 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 transition-colors"
                  >
                    <Copy className="w-5 h-5 text-zinc-400" />
                  </button>
                  <a
                    href={`https://bscscan.com/address/${walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 transition-colors inline-flex"
                  >
                    <ExternalLink className="w-5 h-5 text-zinc-400" />
                  </a>
                </div>
              </div>
            </motion.div>

            {/* Quick Actions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="grid grid-cols-1 gap-4"
            >
              <button
                onClick={disconnectWallet}
                className="p-6 bg-zinc-800 border border-zinc-700 hover:border-red-500 hover:bg-red-900/20 text-white font-bold text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <Link2 className="w-6 h-6 group-hover:scale-110 transition-transform" />
                {t('wallet.disconnect')}
              </button>
            </motion.div>

            {/* Transaction History */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-zinc-900/30 border border-zinc-800"
            >
              <div className="p-6 border-b border-zinc-800">
                <div className="flex items-center gap-3">
                  <Clock className="w-6 h-6 text-zinc-400" />
                  <h2 className="text-2xl font-bold tracking-tight">{t('wallet.tradeHistory')}</h2>
                </div>
              </div>

              {loadingHistory ? (
                <div className="divide-y divide-zinc-800">
                  {[...Array(4)].map((_, i) => (
                    <TransactionSkeleton key={i} />
                  ))}
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-16 text-center">
                  <Clock className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500 text-sm">{t('wallet.noTrades')}</p>
                  <p className="text-zinc-600 text-xs mt-1">{t('wallet.noTradesDesc')}</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {transactions.map((tx, index) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + index * 0.05 }}
                      className="p-4 sm:p-6 hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                            {getTransactionIcon(tx.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
                              <span className="text-white font-semibold text-sm sm:text-base">{getTransactionLabel(tx.type)}</span>
                              {tx.market && (
                                <span className="text-zinc-500 text-xs sm:text-sm truncate">
                                  {tx.market}
                                </span>
                              )}
                              {tx.status === "pending" && (
                                <span className="px-2 py-0.5 sm:py-1 bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs tracking-wider uppercase flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  {t('wallet.txPending')}
                                </span>
                              )}
                            </div>
                            <div className="text-zinc-500 text-xs sm:text-sm">{tx.timestamp}</div>
                            {tx.txHash && (
                              <a
                                href={`https://bscscan.com/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-zinc-600 hover:text-amber-400 text-xs font-mono mt-1 hidden sm:inline-flex items-center gap-1 transition-colors"
                              >
                                {tx.txHash.slice(0, 16)}...{tx.txHash.slice(-14)}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-lg sm:text-2xl font-bold ${
                            tx.amount > 0 ? "text-emerald-400" : "text-white"
                          }`}>
                            {tx.amount > 0 ? "+" : ""}${Math.abs(tx.amount).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
