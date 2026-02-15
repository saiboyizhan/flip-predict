import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect, useRef } from "react";
import { Wallet, Copy, ExternalLink, TrendingUp, ArrowUpRight, ArrowDownRight, Clock, Link2, CheckCircle2, AlertCircle, Loader2, Plus, Minus, X, Zap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatUnits } from "viem";
import { useTranslation } from "react-i18next";
import { fetchBalance, fetchTradeHistory, fetchUserStats, depositFunds, withdrawFunds } from "../services/api";
import { useDeposit, useWithdraw, useContractBalance, useTxNotifier } from "../hooks/useContracts";
import { useAuthStore } from "../stores/useAuthStore";

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
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-1/4" />
          </div>
        </div>
        <div className="h-6 bg-muted rounded w-20" />
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="bg-gradient-to-br from-card to-secondary border border-border p-6 sm:p-8 animate-pulse">
      <div className="h-3 bg-muted rounded w-16 mb-3" />
      <div className="h-8 bg-muted rounded w-24 mb-2" />
      <div className="h-3 bg-muted rounded w-20" />
    </div>
  );
}

export function WalletPage() {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const { data: balanceData, refetch: refetchBnbBalance } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
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
  const [depositMode, setDepositMode] = useState<"contract" | "manual">("contract");
  const [withdrawMode, setWithdrawMode] = useState<"contract" | "manual">("contract");

  // On-chain contract hooks
  const contractDeposit = useDeposit();
  const contractWithdraw = useWithdraw();
  const {
    balanceBNB: contractBalanceBNB,
    isLoading: contractBalanceLoading,
    refetch: refetchContractBalance,
  } = useContractBalance(address as `0x${string}` | undefined);

  // Refs to capture values at submission time (avoids stale closures in confirm effects)
  const depositAmountRef = useRef(depositAmount);
  const withdrawAmountRef = useRef(withdrawAmount);
  const addressRef = useRef(address);

  // Tx lifecycle toast notifications
  useTxNotifier(
    contractDeposit.txHash,
    contractDeposit.isConfirming,
    contractDeposit.isConfirmed,
    contractDeposit.error as Error | null,
    "Deposit",
  );
  useTxNotifier(
    contractWithdraw.txHash,
    contractWithdraw.isConfirming,
    contractWithdraw.isConfirmed,
    contractWithdraw.error as Error | null,
    "Withdraw",
  );

  // After contract deposit confirms, notify the backend API and refresh
  useEffect(() => {
    if (contractDeposit.isConfirmed && contractDeposit.txHash) {
      const amt = parseFloat(depositAmountRef.current);
      if (amt > 0) {
        depositFunds(amt, contractDeposit.txHash)
          .then((result) => {
            if (result.success) {
              setPlatformBalance(result.balance);
            }
          })
          .catch(() => {});
      }
      refetchContractBalance();
      refetchBnbBalance();
      setDepositAmount("");
      setShowDepositForm(false);
      contractDeposit.reset();
    }
  }, [contractDeposit.isConfirmed, contractDeposit.txHash, refetchContractBalance, refetchBnbBalance, contractDeposit.reset]);

  // After contract withdraw confirms, notify backend and refresh
  useEffect(() => {
    if (contractWithdraw.isConfirmed && contractWithdraw.txHash) {
      const amt = parseFloat(withdrawAmountRef.current);
      const addr = addressRef.current;
      if (amt > 0 && addr) {
        withdrawFunds(amt, addr)
          .then((result) => {
            if (result.success) {
              setPlatformBalance(result.balance);
            }
          })
          .catch(() => {});
      }
      refetchContractBalance();
      refetchBnbBalance();
      setWithdrawAmount("");
      setShowWithdrawForm(false);
      contractWithdraw.reset();
    }
  }, [contractWithdraw.isConfirmed, contractWithdraw.txHash, refetchContractBalance, refetchBnbBalance, contractWithdraw.reset]);

  const walletAddress = address ?? "";
  const bnbBalance = balanceData?.value != null
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
    // Also clear auth store state (token, balance, address, etc.)
    useAuthStore.getState().disconnect();
    toast.success(t('wallet.disconnected'));
  };

  const refreshBalance = () => {
    if (!address) return;
    fetchBalance(address)
      .then((data) => setPlatformBalance(data))
      .catch(() => {});
    refetchContractBalance();
    refetchBnbBalance();
  };

  // Contract deposit handler
  const handleContractDeposit = () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) {
      toast.error(t('wallet.invalidAmount'));
      return;
    }
    if (amt > bnbBalance) {
      toast.error(t('wallet.insufficientBnb'));
      return;
    }
    depositAmountRef.current = depositAmount;
    contractDeposit.deposit(depositAmount);
  };

  // Contract withdraw handler
  const handleContractWithdraw = () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) {
      toast.error(t('wallet.invalidAmount'));
      return;
    }
    if (amt > parseFloat(contractBalanceBNB)) {
      toast.error(t('wallet.insufficientContractBalance'));
      return;
    }
    withdrawAmountRef.current = withdrawAmount;
    addressRef.current = address;
    contractWithdraw.withdraw(withdrawAmount);
  };

  // Legacy manual deposit handler
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

  // Legacy manual withdraw handler
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
        return <ArrowUpRight className="w-5 h-5 text-blue-400" />;
      case "withdraw":
      case "sell":
        return <ArrowUpRight className="w-5 h-5 text-muted-foreground" />;
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

  const isContractDepositBusy = contractDeposit.isWriting || contractDeposit.isConfirming;
  const isContractWithdrawBusy = contractWithdraw.isWriting || contractWithdraw.isConfirming;

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <Wallet className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400" />
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
            className="bg-card/50 border-2 border-border p-8 sm:p-16 text-center"
          >
            <div className="max-w-xl mx-auto space-y-6">
              <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-2 border-blue-500/30 flex items-center justify-center">
                <Wallet className="w-12 h-12 text-blue-400" />
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">{t('wallet.connectTitle')}</h2>
                <p className="text-muted-foreground text-base sm:text-lg">
                  {t('wallet.connectDesc')}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="p-4 bg-secondary border border-border">
                  <AlertCircle className="w-6 h-6 text-blue-400 mb-2" />
                  <div className="text-muted-foreground text-sm">{t('wallet.decentralized')}</div>
                </div>
                <div className="p-4 bg-secondary border border-border">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 mb-2" />
                  <div className="text-muted-foreground text-sm">{t('wallet.secure')}</div>
                </div>
                <div className="p-4 bg-secondary border border-border">
                  <Link2 className="w-6 h-6 text-blue-400 mb-2" />
                  <div className="text-muted-foreground text-sm">{t('wallet.instant')}</div>
                </div>
              </div>

              <button
                onClick={openConnectModal}
                className="w-full bg-blue-500 hover:bg-blue-400 text-black font-bold py-6 text-xl tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group mt-8"
              >
                <Link2 className="w-6 h-6 group-hover:scale-110 transition-transform" />
                {t('wallet.connectButton')}
              </button>

              <div className="text-muted-foreground text-sm pt-4">
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
                  className="bg-gradient-to-br from-card to-secondary border border-border p-6 sm:p-8"
                >
                  <div className="text-muted-foreground text-sm tracking-wider uppercase mb-2">{t('wallet.platformBalance')}</div>
                  <div className="text-3xl sm:text-5xl font-bold text-foreground mb-2">
                    ${platformBalance ? platformBalance.available.toLocaleString() : "0"}
                  </div>
                  {platformBalance && platformBalance.locked > 0 && (
                    <div className="text-muted-foreground text-sm">
                      {t('wallet.locked', { amount: platformBalance.locked.toLocaleString() })}
                    </div>
                  )}
                </motion.div>
              )}

              {/* On-Chain Contract Balance */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="bg-gradient-to-br from-blue-900/20 to-secondary border border-blue-500/30 p-6 sm:p-8"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-blue-400 text-sm tracking-wider uppercase">{t('wallet.contractBalanceLabel')}</div>
                  <button
                    onClick={() => refetchContractBalance()}
                    className="p-1 hover:bg-accent transition-colors rounded"
                    title={t('wallet.refreshBalance')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${contractBalanceLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <div className="text-3xl sm:text-5xl font-bold text-blue-400 mb-2">
                  {contractBalanceLoading ? "..." : `${parseFloat(contractBalanceBNB).toFixed(4)}`}
                </div>
                <div className="text-muted-foreground text-sm">BNB ({t('wallet.onChain')})</div>
              </motion.div>

              {/* BNB Balance */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-gradient-to-br from-card to-secondary border border-border p-6 sm:p-8"
              >
                <div className="text-muted-foreground text-sm tracking-wider uppercase mb-2">{t('wallet.bnbBalance')}</div>
                <div className="text-3xl sm:text-5xl font-bold text-foreground mb-2">{bnbBalance.toFixed(4)}</div>
                <div className="text-muted-foreground text-sm">{t('wallet.bscMainnet')}</div>
              </motion.div>

              {/* User Stats */}
              {loadingStats ? (
                <StatSkeleton />
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-gradient-to-br from-blue-900/20 to-secondary border border-blue-500/30 p-6 sm:p-8"
                >
                  <div className="text-blue-400 text-sm tracking-wider uppercase mb-2">{t('wallet.totalWinnings')}</div>
                  <div className="text-3xl sm:text-5xl font-bold text-blue-400 mb-2">
                    ${userStats ? userStats.totalProfit.toLocaleString() : "0"}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {userStats ? t('wallet.winsAndRate', { wins: userStats.totalWins, rate: (userStats.winRate > 1 ? userStats.winRate : userStats.winRate * 100).toFixed(1) }) : t('common.noData')}
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
                className="p-4 sm:p-6 bg-card/50 border border-border hover:border-blue-500/60 hover:bg-blue-900/10 text-foreground font-bold text-base sm:text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 group-hover:scale-110 transition-transform" />
                {t('wallet.deposit')}
              </button>
              <button
                onClick={() => { setShowWithdrawForm(true); setShowDepositForm(false); }}
                className="p-4 sm:p-6 bg-card/50 border border-border hover:border-blue-500/60 hover:bg-blue-900/10 text-foreground font-bold text-base sm:text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <Minus className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 group-hover:scale-110 transition-transform" />
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
                  <div className="bg-card/50 border border-blue-500/30 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-blue-400 tracking-wide uppercase">{t('wallet.deposit')}</h3>
                      <button onClick={() => setShowDepositForm(false)} className="p-1 hover:bg-accent transition-colors">
                        <X className="w-5 h-5 text-muted-foreground" />
                      </button>
                    </div>

                    {/* Mode Toggle: Contract vs Manual */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setDepositMode("contract")}
                        className={`py-2.5 text-sm font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-2 ${
                          depositMode === "contract"
                            ? "bg-blue-500/20 border border-blue-500/50 text-blue-400"
                            : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Zap className="w-4 h-4" />
                        {t('wallet.onChain')}
                      </button>
                      <button
                        onClick={() => setDepositMode("manual")}
                        className={`py-2.5 text-sm font-bold tracking-wider uppercase transition-colors ${
                          depositMode === "manual"
                            ? "bg-muted/30 border border-border text-muted-foreground"
                            : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t('wallet.manualTxHash')}
                      </button>
                    </div>

                    <div>
                      <label className="block text-muted-foreground text-sm mb-2">
                        {depositMode === "contract" ? t('trade.amountBnb') : t('wallet.depositAmount')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-input-background border border-border focus:border-blue-500/60 text-foreground text-lg p-3 outline-none transition-colors placeholder:text-muted-foreground"
                      />
                      {depositMode === "contract" && (
                        <div className="text-muted-foreground text-xs mt-1">
                          {t('wallet.walletBnb')}: {bnbBalance.toFixed(4)} BNB
                        </div>
                      )}
                    </div>

                    {/* Manual mode: show txHash input */}
                    {depositMode === "manual" && (
                      <div>
                        <label className="block text-muted-foreground text-sm mb-2">{t('wallet.txHash')}</label>
                        <input
                          type="text"
                          value={depositTxHash}
                          onChange={(e) => setDepositTxHash(e.target.value)}
                          placeholder={t('wallet.txHashPlaceholder')}
                          className="w-full bg-input-background border border-border focus:border-blue-500/60 text-foreground text-sm p-3 outline-none transition-colors font-mono placeholder:text-muted-foreground"
                        />
                      </div>
                    )}

                    {/* Contract deposit: show tx status */}
                    {depositMode === "contract" && contractDeposit.txHash && (
                      <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 text-sm">
                        {contractDeposit.isConfirming ? (
                          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                        ) : contractDeposit.isConfirmed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Clock className="w-4 h-4 text-blue-400" />
                        )}
                        <a
                          href={`https://bscscan.com/tx/${contractDeposit.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 font-mono text-xs underline"
                        >
                          {contractDeposit.txHash.slice(0, 16)}...{contractDeposit.txHash.slice(-8)}
                        </a>
                        <span className="text-muted-foreground text-xs ml-auto">
                          {contractDeposit.isConfirming ? t('trade.txConfirming') : contractDeposit.isConfirmed ? t('trade.txConfirmed') : t('trade.txSubmitted')}
                        </span>
                      </div>
                    )}

                    {/* Error display */}
                    {depositMode === "contract" && contractDeposit.error && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                        {(contractDeposit.error as Error).message?.includes("User rejected")
                          ? t('trade.txCancelledByUser')
                          : (contractDeposit.error as Error).message?.slice(0, 150) || t('trade.txFailed')}
                      </div>
                    )}

                    <button
                      onClick={depositMode === "contract" ? handleContractDeposit : handleDeposit}
                      disabled={depositMode === "contract" ? isContractDepositBusy : depositProcessing}
                      className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-black font-bold py-3 text-base tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      {(depositMode === "contract" ? isContractDepositBusy : depositProcessing) ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          {contractDeposit.isConfirming ? t('trade.confirmingOnChain') : t('wallet.processing')}
                        </>
                      ) : depositMode === "contract" ? (
                        <>
                          <Zap className="w-5 h-5" />
                          {t('wallet.depositToContract')}
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
                  <div className="bg-card/50 border border-blue-500/30 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-blue-400 tracking-wide uppercase">{t('wallet.withdraw')}</h3>
                      <button onClick={() => setShowWithdrawForm(false)} className="p-1 hover:bg-accent transition-colors">
                        <X className="w-5 h-5 text-muted-foreground" />
                      </button>
                    </div>

                    {/* Mode Toggle: Contract vs Manual */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setWithdrawMode("contract")}
                        className={`py-2.5 text-sm font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-2 ${
                          withdrawMode === "contract"
                            ? "bg-blue-500/20 border border-blue-500/50 text-blue-400"
                            : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Zap className="w-4 h-4" />
                        {t('wallet.onChain')}
                      </button>
                      <button
                        onClick={() => setWithdrawMode("manual")}
                        className={`py-2.5 text-sm font-bold tracking-wider uppercase transition-colors ${
                          withdrawMode === "manual"
                            ? "bg-muted/30 border border-border text-muted-foreground"
                            : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t('wallet.manualApi')}
                      </button>
                    </div>

                    <div>
                      <label className="block text-muted-foreground text-sm mb-2">
                        {withdrawMode === "contract" ? t('trade.amountBnb') : t('wallet.withdrawAmount')}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-input-background border border-border focus:border-blue-500/60 text-foreground text-lg p-3 outline-none transition-colors placeholder:text-muted-foreground"
                        />
                        <div className="text-muted-foreground text-xs mt-1">
                          {withdrawMode === "contract"
                            ? `${t('wallet.contractBalanceLabel')}: ${parseFloat(contractBalanceBNB).toFixed(4)} BNB`
                            : platformBalance
                              ? `${t('wallet.platformBalance')}: $${platformBalance.available.toLocaleString()}`
                              : ""}
                        </div>
                      </div>
                    </div>

                    {/* Manual mode: show destination address */}
                    {withdrawMode === "manual" && (
                      <div>
                        <label className="block text-muted-foreground text-sm mb-2">{t('wallet.destinationAddress')}</label>
                        <input
                          type="text"
                          value={withdrawAddress}
                          onChange={(e) => setWithdrawAddress(e.target.value)}
                          placeholder={t('wallet.destinationPlaceholder')}
                          className="w-full bg-input-background border border-border focus:border-blue-500/60 text-foreground text-sm p-3 outline-none transition-colors font-mono placeholder:text-muted-foreground"
                        />
                      </div>
                    )}

                    {/* Contract withdraw: show tx status */}
                    {withdrawMode === "contract" && contractWithdraw.txHash && (
                      <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 text-sm">
                        {contractWithdraw.isConfirming ? (
                          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                        ) : contractWithdraw.isConfirmed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Clock className="w-4 h-4 text-blue-400" />
                        )}
                        <a
                          href={`https://bscscan.com/tx/${contractWithdraw.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 font-mono text-xs underline"
                        >
                          {contractWithdraw.txHash.slice(0, 16)}...{contractWithdraw.txHash.slice(-8)}
                        </a>
                        <span className="text-muted-foreground text-xs ml-auto">
                          {contractWithdraw.isConfirming ? t('trade.txConfirming') : contractWithdraw.isConfirmed ? t('trade.txConfirmed') : t('trade.txSubmitted')}
                        </span>
                      </div>
                    )}

                    {/* Error display */}
                    {withdrawMode === "contract" && contractWithdraw.error && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                        {(contractWithdraw.error as Error).message?.includes("User rejected")
                          ? t('trade.txCancelledByUser')
                          : (contractWithdraw.error as Error).message?.slice(0, 150) || t('trade.txFailed')}
                      </div>
                    )}

                    <button
                      onClick={withdrawMode === "contract" ? handleContractWithdraw : handleWithdraw}
                      disabled={withdrawMode === "contract" ? isContractWithdrawBusy : withdrawProcessing}
                      className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-black font-bold py-3 text-base tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      {(withdrawMode === "contract" ? isContractWithdrawBusy : withdrawProcessing) ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          {contractWithdraw.isConfirming ? t('trade.confirmingOnChain') : t('wallet.processing')}
                        </>
                      ) : withdrawMode === "contract" ? (
                        <>
                          <Zap className="w-5 h-5" />
                          {t('wallet.withdrawFromContract')}
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
              className="bg-card/50 border border-border p-4 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-muted-foreground text-sm tracking-wider uppercase mb-2">{t('wallet.walletAddress')}</div>
                  <div className="text-foreground text-sm sm:text-lg font-mono truncate">{walletAddress}</div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <button
                    onClick={copyAddress}
                    aria-label="Copy wallet address"
                    className="p-3 bg-muted border border-border hover:border-border transition-colors"
                  >
                    <Copy className="w-5 h-5 text-muted-foreground" />
                  </button>
                  <a
                    href={`https://bscscan.com/address/${walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on BSCScan"
                    className="p-3 bg-muted border border-border hover:border-border transition-colors inline-flex"
                  >
                    <ExternalLink className="w-5 h-5 text-muted-foreground" />
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
                className="p-6 bg-muted border border-border hover:border-red-500 hover:bg-red-900/20 text-foreground font-bold text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
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
              className="bg-card/30 border border-border"
            >
              <div className="p-6 border-b border-border">
                <div className="flex items-center gap-3">
                  <Clock className="w-6 h-6 text-muted-foreground" />
                  <h2 className="text-2xl font-bold tracking-tight">{t('wallet.tradeHistory')}</h2>
                </div>
              </div>

              {loadingHistory ? (
                <div className="divide-y divide-border">
                  {[...Array(4)].map((_, i) => (
                    <TransactionSkeleton key={i} />
                  ))}
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-16 text-center">
                  <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">{t('wallet.noTrades')}</p>
                  <p className="text-muted-foreground text-xs mt-1">{t('wallet.noTradesDesc')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {transactions.map((tx, index) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + index * 0.05 }}
                      className="p-4 sm:p-6 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted border border-border flex items-center justify-center shrink-0">
                            {getTransactionIcon(tx.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
                              <span className="text-foreground font-semibold text-sm sm:text-base">{getTransactionLabel(tx.type)}</span>
                              {tx.market && (
                                <span className="text-muted-foreground text-xs sm:text-sm truncate">
                                  {tx.market}
                                </span>
                              )}
                              {tx.status === "pending" && (
                                <span className="px-2 py-0.5 sm:py-1 bg-blue-500/20 border border-blue-500/40 text-blue-400 text-xs tracking-wider uppercase flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  {t('wallet.txPending')}
                                </span>
                              )}
                            </div>
                            <div className="text-muted-foreground text-xs sm:text-sm">{tx.timestamp}</div>
                            {tx.txHash && (
                              <a
                                href={`https://bscscan.com/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-blue-400 text-xs font-mono mt-1 hidden sm:inline-flex items-center gap-1 transition-colors"
                              >
                                {tx.txHash.slice(0, 16)}...{tx.txHash.slice(-14)}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-lg sm:text-2xl font-bold ${
                            tx.amount > 0 ? "text-emerald-400" : "text-foreground"
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
