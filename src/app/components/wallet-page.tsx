import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { Wallet, Copy, ExternalLink, ArrowUpRight, ArrowDownRight, Clock, Link2, CheckCircle2, AlertCircle, Loader2, Zap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useBalance, useDisconnect, useChainId } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { formatUnits } from "viem";
import { useTranslation } from "react-i18next";
import { fetchTradeHistory, fetchUserStats } from "../services/api";
import { useContractBalance, useTxNotifier, useMintTestUSDT, getBscScanUrl } from "../hooks/useContracts";
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
    <div className="bg-card border border-border rounded-lg p-4 animate-pulse">
      <div className="h-3 bg-muted rounded w-16 mb-2" />
      <div className="h-6 bg-muted rounded w-24 mb-1.5" />
      <div className="h-3 bg-muted rounded w-20" />
    </div>
  );
}

export function WalletPage() {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const { data: balanceData, refetch: refetchBnbBalance } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { open: openConnectModal } = useAppKit();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userStats, setUserStats] = useState<{ totalTrades: number; winRate: number; totalProfit: number; totalWins: number } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authToken = useAuthStore((s) => s.token);

  // On-chain USDT balance (v2: non-custodial — user holds USDT in own wallet)
  const {
    balanceUSDT: walletUsdtBalance,
    refetch: refetchWalletUsdtBalance,
  } = useContractBalance(address as `0x${string}` | undefined);

  // Testnet faucet (mint test USDT on-chain)
  const mintTestUSDT = useMintTestUSDT();
  useTxNotifier(
    mintTestUSDT.txHash,
    mintTestUSDT.isLoading && !mintTestUSDT.isConfirmed,
    mintTestUSDT.isConfirmed,
    mintTestUSDT.error as Error | null,
    "Mint Test USDT",
  );
  useEffect(() => {
    if (mintTestUSDT.isConfirmed) {
      refetchWalletUsdtBalance();
      mintTestUSDT.reset();
    }
  }, [mintTestUSDT.isConfirmed, refetchWalletUsdtBalance, mintTestUSDT.reset]);

  const walletAddress = address ?? "";
  const bnbBalance = balanceData?.value != null
    ? parseFloat(formatUnits(balanceData.value, balanceData.decimals))
    : 0;

  // Fetch trade history and user stats when connected
  useEffect(() => {
    if (!isConnected || !address || !isAuthenticated) return;

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
              : new Date(Number(tx.created_at) || Date.now()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
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
  }, [isConnected, address, isAuthenticated, authToken]);

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    toast.success(t('wallet.addressCopied'));
  };

  const disconnectWallet = () => {
    disconnect();
    useAuthStore.getState().disconnect();
    toast.success(t('wallet.disconnected'));
  };

  const refreshBalance = () => {
    if (!address) return;
    refetchWalletUsdtBalance();
    refetchBnbBalance();
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

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">{t('wallet.title')}</h1>
          </div>

          {isConnected && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-md">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500 text-xs font-medium">{t('wallet.connected')}</span>
            </div>
          )}
        </div>

        {/* Not connected */}
        {!isConnected ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/50 border-2 border-border p-6 sm:p-10 text-center"
          >
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-2 border-blue-500/30 flex items-center justify-center">
                <Wallet className="w-10 h-10 text-blue-400" />
              </div>

              <div>
                <h2 className="text-lg sm:text-xl font-bold text-foreground mb-2">{t('wallet.connectTitle')}</h2>
                <p className="text-muted-foreground text-sm sm:text-base">
                  {t('wallet.connectDesc')}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 sm:p-4 bg-secondary border border-border">
                  <AlertCircle className="w-5 h-5 text-blue-400 mb-1.5" />
                  <div className="text-muted-foreground text-xs sm:text-sm">{t('wallet.decentralized')}</div>
                </div>
                <div className="p-3 sm:p-4 bg-secondary border border-border">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-1.5" />
                  <div className="text-muted-foreground text-xs sm:text-sm">{t('wallet.secure')}</div>
                </div>
                <div className="p-3 sm:p-4 bg-secondary border border-border">
                  <Link2 className="w-5 h-5 text-blue-400 mb-1.5" />
                  <div className="text-muted-foreground text-xs sm:text-sm">{t('wallet.instant')}</div>
                </div>
              </div>

              <button
                onClick={openConnectModal}
                className="w-full bg-blue-500 hover:bg-blue-400 text-black font-bold py-4 text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <Link2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                {t('wallet.connectButton')}
              </button>

              <div className="text-muted-foreground text-xs sm:text-sm">
                {t('wallet.supportedWallets')}
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {/* Balance Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Wallet USDT Balance */}
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-blue-500 text-xs font-medium">{t('wallet.walletUsdt', { defaultValue: 'Wallet USDT' })}</div>
                  <button
                    onClick={refreshBalance}
                    className="p-0.5 hover:bg-accent transition-colors rounded"
                    title={t('wallet.refreshBalance')}
                  >
                    <RefreshCw className="w-3 h-3 text-blue-400" />
                  </button>
                </div>
                <div className="text-xl sm:text-2xl font-semibold text-blue-500">
                  {parseFloat(walletUsdtBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-muted-foreground text-xs mt-1">{t('wallet.availableToTrade', { defaultValue: 'Available to trade' })}</div>
              </div>

              {/* Native BNB Balance (for gas) */}
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="text-muted-foreground text-xs font-medium mb-1">{t('wallet.bnbBalance')}</div>
                <div className="text-xl sm:text-2xl font-semibold text-foreground">{bnbBalance.toFixed(4)}</div>
                <div className="text-muted-foreground text-xs mt-1">{t('wallet.bscMainnet')}</div>
              </div>

              {/* User Stats */}
              {loadingStats ? (
                <StatSkeleton />
              ) : (
                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="text-blue-500 text-xs font-medium mb-1">{t('wallet.totalWinnings')}</div>
                  <div className="text-xl sm:text-2xl font-semibold text-blue-500">
                    ${userStats ? userStats.totalProfit.toLocaleString() : "0"}
                  </div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {userStats ? t('wallet.winsAndRate', { wins: userStats.totalWins, rate: (userStats.winRate > 1 ? userStats.winRate : userStats.winRate * 100).toFixed(1) }) : t('common.noData')}
                  </div>
                </div>
              )}
            </div>

            {/* Testnet Faucet */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => address && mintTestUSDT.mint(address as `0x${string}`, '10000')}
                disabled={mintTestUSDT.isLoading || !address}
                className="py-2.5 px-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:border-emerald-500/50 hover:bg-emerald-500/15 text-emerald-500 font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mintTestUSDT.isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                {mintTestUSDT.isLoading ? t('common.loading') : t('wallet.faucet', { defaultValue: 'Mint 10K Test USDT' })}
              </button>
            </div>

            {/* Non-custodial info */}
            <div className="text-xs text-muted-foreground bg-white/[0.02] border border-white/[0.06] rounded-lg px-4 py-3">
              {t('wallet.nonCustodialInfo', { defaultValue: 'Non-custodial: Your USDT stays in your wallet. Trades interact directly with the on-chain smart contract. No deposit or withdrawal needed.' })}
            </div>

            {/* Wallet Address */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-muted-foreground text-xs font-medium mb-1">{t('wallet.walletAddress')}</div>
                  <div className="text-foreground text-xs sm:text-sm font-mono truncate">{walletAddress}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={copyAddress}
                    aria-label="Copy wallet address"
                    className="p-2 hover:bg-accent rounded-md transition-colors"
                  >
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <a
                    href={`${getBscScanUrl(chainId)}/address/${walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on BSCScan"
                    className="p-2 hover:bg-accent rounded-md transition-colors inline-flex"
                  >
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                </div>
              </div>
            </div>

            {/* Disconnect */}
            <button
              onClick={disconnectWallet}
              className="w-full py-2.5 bg-card border border-border rounded-lg hover:border-red-500/50 hover:bg-red-500/5 text-muted-foreground hover:text-red-500 font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Link2 className="w-4 h-4" />
              {t('wallet.disconnect')}
            </button>

            {/* Transaction History */}
            <div className="bg-card border border-border rounded-lg">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{t('wallet.tradeHistory')}</h2>
                </div>
              </div>

              {loadingHistory ? (
                <div className="divide-y divide-border">
                  {[...Array(3)].map((_, i) => (
                    <TransactionSkeleton key={i} />
                  ))}
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-10 text-center">
                  <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">{t('wallet.noTrades')}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{t('wallet.noTradesDesc')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="px-4 py-3 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-8 h-8 bg-muted border border-border rounded-md flex items-center justify-center shrink-0">
                            {getTransactionIcon(tx.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                              <span className="text-foreground font-medium text-sm">{getTransactionLabel(tx.type)}</span>
                              {tx.market && (
                                <span className="text-muted-foreground text-xs truncate">
                                  {tx.market}
                                </span>
                              )}
                              {tx.status === "pending" && (
                                <span className="px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] rounded flex items-center gap-1">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  {t('wallet.txPending')}
                                </span>
                              )}
                            </div>
                            <div className="text-muted-foreground text-xs">{tx.timestamp}</div>
                            {tx.txHash && (
                              <a
                                href={`${getBscScanUrl(chainId)}/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-blue-400 text-[10px] font-mono mt-0.5 hidden sm:inline-flex items-center gap-1 transition-colors"
                              >
                                {tx.txHash.slice(0, 16)}...{tx.txHash.slice(-14)}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-semibold ${
                            tx.amount > 0 ? "text-emerald-500" : "text-foreground"
                          }`}>
                            {tx.amount > 0 ? "+" : ""}${Math.abs(tx.amount).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
