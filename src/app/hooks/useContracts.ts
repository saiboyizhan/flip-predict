/**
 * Custom hooks for PredictionMarket v2 smart contract interactions.
 * Non-custodial: buy/sell/addLiquidity/removeLiquidity directly on-chain.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  useChainId,
} from 'wagmi';
import { decodeEventLog, parseUnits, formatUnits } from 'viem';
import {
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
  LIMIT_ORDER_BOOK_ABI,
  LIMIT_ORDER_BOOK_ADDRESS,
  USDT_ADDRESS,
  ERC20_ABI,
  MOCK_USDT_MINT_ABI,
} from '@/app/config/contracts';
import { toast } from 'sonner';

// ----------------------------------------------------------------
// useBuy  --  calls contract.buy(marketId, buyYes, amount)
// ----------------------------------------------------------------

export function useBuy() {
  const chainId = useChainId();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const buy = useCallback(
    (marketId: bigint, buyYes: boolean, amountUSDT: string) => {
      if (chainId !== 97) { toast.error('Please switch to BSC Testnet'); return; }
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'buy',
        args: [marketId, buyYes, parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset, chainId],
  );

  return {
    buy,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useSell  --  calls contract.sell(marketId, sellYes, shares)
// ----------------------------------------------------------------

export function useSell() {
  const chainId = useChainId();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const sell = useCallback(
    (marketId: bigint, sellYes: boolean, sharesWei: bigint) => {
      if (chainId !== 97) { toast.error('Please switch to BSC Testnet'); return; }
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'sell',
        args: [marketId, sellYes, sharesWei],
      });
    },
    [writeContract, reset, chainId],
  );

  return {
    sell,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useAddLiquidity  --  calls contract.addLiquidity(marketId, amount)
// ----------------------------------------------------------------

export function useAddLiquidity() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const addLiquidity = useCallback(
    (marketId: bigint, amountUSDT: string) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'addLiquidity',
        args: [marketId, parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    addLiquidity,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useRemoveLiquidity  --  calls contract.removeLiquidity(marketId, shares)
// ----------------------------------------------------------------

export function useRemoveLiquidity() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const removeLiquidity = useCallback(
    (marketId: bigint, sharesWei: bigint) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'removeLiquidity',
        args: [marketId, sharesWei],
      });
    },
    [writeContract, reset],
  );

  return {
    removeLiquidity,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useClaimWinnings  --  calls contract.claimWinnings(marketId)
// ----------------------------------------------------------------

export function useClaimWinnings() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const claimWinnings = useCallback(
    (marketId: bigint) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'claimWinnings',
        args: [marketId],
      });
    },
    [writeContract, reset],
  );

  return {
    claimWinnings,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useCreateUserMarket  --  calls contract.createUserMarket(...)
// ----------------------------------------------------------------

export function useCreateUserMarket() {
  const chainId = useChainId();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const [createdMarketId, setCreatedMarketId] = useState<bigint | null>(null);

  useEffect(() => {
    if (!receipt) return;
    let parsedMarketId: bigint | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== PREDICTION_MARKET_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: PREDICTION_MARKET_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'UserMarketCreated') {
          const eventMarketId = (decoded.args as { marketId?: bigint }).marketId;
          if (typeof eventMarketId === 'bigint') {
            parsedMarketId = eventMarketId;
            break;
          }
        }
      } catch (e) {
        console.warn('[useCreateUserMarket] Non-matching log:', e);
      }
    }

    setCreatedMarketId(parsedMarketId);
  }, [receipt]);

  const createUserMarket = useCallback(
    (
      title: string,
      endTimeUnix: bigint,
      initialLiquidityWei: bigint,
    ) => {
      if (chainId !== 97) { toast.error('Please switch to BSC Testnet'); return; }
      reset();
      setCreatedMarketId(null);
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'createUserMarket',
        args: [title, endTimeUnix, initialLiquidityWei],
      });
    },
    [writeContract, reset, chainId],
  );

  return {
    createUserMarket,
    createdMarketId,
    receipt,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useMarketCreationFee  --  reads marketCreationFee from contract
// ----------------------------------------------------------------

export function useMarketCreationFee() {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'marketCreationFee',
  });

  const feeWei = (data as bigint) ?? 0n;
  const feeUSDT = formatUnits(feeWei, 18);

  return {
    feeWei,
    feeUSDT,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// useContractBalance  --  reads USDT balanceOf(address) from wallet
// ----------------------------------------------------------------

export function useContractBalance(address?: `0x${string}`) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const balanceUSDT = data != null ? formatUnits(data as bigint, 18) : '0';

  return {
    balanceRaw: (data as bigint) ?? 0n,
    balanceUSDT,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// useUsdtAllowance  --  reads USDT allowance(owner, spender)
// ----------------------------------------------------------------

export function useUsdtAllowance(owner?: `0x${string}`, spender?: `0x${string}`) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner && spender ? [owner, spender] : undefined,
    query: {
      enabled: !!owner && !!spender,
    },
  });

  return {
    allowanceRaw: (data as bigint) ?? 0n,
    allowance: data != null ? formatUnits(data as bigint, 18) : '0',
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// useUsdtApprove  --  calls USDT.approve(spender, amount)
// ----------------------------------------------------------------

export function useUsdtApprove() {
  const chainId = useChainId();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const approve = useCallback(
    (spender: `0x${string}`, amountWei: bigint) => {
      if (chainId !== 97) { toast.error('Please switch to BSC Testnet'); return; }
      if (amountWei <= 0n) { console.warn('Invalid approve amount'); return; }
      reset();
      writeContract({
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, amountWei],
      });
    },
    [writeContract, reset, chainId],
  );

  return {
    approve,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useContractMarket  --  reads getMarket(id) from contract
// ----------------------------------------------------------------

export function useContractMarket(marketId?: bigint) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'getMarket',
    args: marketId != null ? [marketId] : undefined,
    query: {
      enabled: marketId != null,
    },
  });

  type MarketTuple = readonly [string, bigint, bigint, bigint, boolean, boolean, boolean, boolean, `0x${string}`, bigint, number, bigint];
  const d = data as MarketTuple | undefined;
  const market = d
    ? {
        title: d[0],
        endTime: d[1],
        totalYes: d[2],
        totalNo: d[3],
        resolved: d[4],
        outcome: d[5],
        cancelled: d[6],
        oracleEnabled: d[7],
        priceFeed: d[8],
        targetPrice: d[9],
        resolutionType: d[10],
        resolvedPrice: d[11],
      }
    : null;

  return { market, isLoading, error, refetch };
}

// ----------------------------------------------------------------
// useContractPrice  --  reads getPrice(marketId) from contract
// ----------------------------------------------------------------

export function useContractPrice(marketId?: bigint) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'getPrice',
    args: marketId != null ? [marketId] : undefined,
    query: {
      enabled: marketId != null,
    },
  });

  type PriceTuple = readonly [bigint, bigint];
  const d = data as PriceTuple | undefined;

  return {
    yesPrice: d ? Number(formatUnits(d[0], 18)) : 0.5,
    noPrice: d ? Number(formatUnits(d[1], 18)) : 0.5,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// useContractLpInfo  --  reads getLpInfo(marketId, user) from contract
// ----------------------------------------------------------------

export function useContractLpInfo(marketId?: bigint, user?: `0x${string}`) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'getLpInfo',
    args: marketId != null && user ? [marketId, user] : undefined,
    query: {
      enabled: marketId != null && !!user,
    },
  });

  type LpTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  const d = data as LpTuple | undefined;

  return {
    totalShares: d ? d[0] : 0n,
    userLpShares: d ? d[1] : 0n,
    poolValue: d ? d[2] : 0n,
    userValue: d ? d[3] : 0n,
    yesReserve: d ? d[4] : 0n,
    noReserve: d ? d[5] : 0n,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// useContractPosition  --  reads getPosition(marketId, address)
// ----------------------------------------------------------------

export function useContractPosition(marketId?: bigint, address?: `0x${string}`) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'getPosition',
    args: marketId != null && address ? [marketId, address] : undefined,
    query: {
      enabled: marketId != null && !!address,
    },
  });

  type PositionTuple = readonly [bigint, bigint, boolean];
  const pd = data as PositionTuple | undefined;
  const position = pd
    ? {
        yesAmount: pd[0],
        noAmount: pd[1],
        claimed: pd[2],
      }
    : null;

  return { position, isLoading, error, refetch };
}

// ----------------------------------------------------------------
// useSplitPosition  --  calls contract.splitPosition(marketId, amount)
// ----------------------------------------------------------------

export function useSplitPosition() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const splitPosition = useCallback(
    (marketId: bigint, amountUSDT: string) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'splitPosition',
        args: [marketId, parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    splitPosition,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useMergePositions  --  calls contract.mergePositions(marketId, amount)
// ----------------------------------------------------------------

export function useMergePositions() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const mergePositions = useCallback(
    (marketId: bigint, amountUSDT: string) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'mergePositions',
        args: [marketId, parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    mergePositions,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useTransferPosition  --  calls contract.safeTransferFrom(...)
// ----------------------------------------------------------------

export function useTransferPosition() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const transferPosition = useCallback(
    (from: `0x${string}`, to: `0x${string}`, tokenId: bigint, amount: bigint) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'safeTransferFrom',
        args: [from, to, tokenId, amount, '0x'],
      });
    },
    [writeContract, reset],
  );

  return {
    transferPosition,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useTokenBalance  --  reads balanceOf(account, tokenId) (ERC1155)
// ----------------------------------------------------------------

export function useTokenBalance(account?: `0x${string}`, tokenId?: bigint) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'balanceOf',
    args: account && tokenId != null ? [account, tokenId] : undefined,
    query: {
      enabled: !!account && tokenId != null,
    },
  });

  return {
    balanceRaw: (data as bigint) ?? 0n,
    balanceUSDT: data != null ? formatUnits(data as bigint, 18) : '0',
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// Helper: getBscScanUrl
// ----------------------------------------------------------------

export function getBscScanUrl(chainId?: number): string {
  return chainId === 97
    ? 'https://testnet.bscscan.com'
    : 'https://bscscan.com';
}

// ----------------------------------------------------------------
// useTxNotifier  --  watches a txHash and fires toasts
// ----------------------------------------------------------------

export function useTxNotifier(
  txHash: `0x${string}` | undefined,
  isConfirming: boolean,
  isConfirmed: boolean,
  error: Error | null,
  label: string,
) {
  const { t } = useTranslation();
  const chainId = useChainId();
  const [toasted, setToasted] = useState<string | null>(null);

  useEffect(() => {
    if (txHash && txHash !== toasted && !isConfirming && !isConfirmed && !error) {
      toast.info(`${label}: ${t('trade.txSubmitted')}`, {
        description: `${txHash.slice(0, 10)}...${txHash.slice(-8)}`,
      });
    }
  }, [txHash, toasted, isConfirming, isConfirmed, error, label, t]);

  useEffect(() => {
    if (isConfirmed && txHash && txHash !== toasted) {
      setToasted(txHash);
      const scanUrl = getBscScanUrl(chainId);
      toast.success(`${label}: ${t('trade.txConfirmed')}`, {
        action: {
          label: t('trade.viewOnBscScan'),
          onClick: () => window.open(`${scanUrl}/tx/${txHash}`, '_blank'),
        },
      });
    }
  }, [isConfirmed, txHash, toasted, label, chainId, t]);

  useEffect(() => {
    if (error) {
      const msg = error.message?.includes('User rejected')
        ? t('trade.txCancelledByUser')
        : error.message?.slice(0, 120) || t('trade.txFailed');
      toast.error(`${label}: ${msg}`);
    }
  }, [error, label, t]);
}

// ----------------------------------------------------------------
// usePlaceLimitOrder  --  calls contract.placeLimitOrder(...)
// ----------------------------------------------------------------

export function usePlaceLimitOrder() {
  const chainId = useChainId();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const placeLimitOrder = useCallback(
    (marketId: bigint, orderSide: number, priceWei: bigint, amountWei: bigint) => {
      if (chainId !== 97) { toast.error('Please switch to BSC Testnet'); return; }
      reset();
      writeContract({
        address: LIMIT_ORDER_BOOK_ADDRESS,
        abi: LIMIT_ORDER_BOOK_ABI,
        functionName: 'placeLimitOrder',
        args: [marketId, orderSide, priceWei, amountWei],
      });
    },
    [writeContract, reset, chainId],
  );

  return {
    placeLimitOrder,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useFillLimitOrder  --  calls contract.fillLimitOrder(...)
// ----------------------------------------------------------------

export function useFillLimitOrder() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const fillLimitOrder = useCallback(
    (orderId: bigint, fillAmountWei: bigint) => {
      reset();
      writeContract({
        address: LIMIT_ORDER_BOOK_ADDRESS,
        abi: LIMIT_ORDER_BOOK_ABI,
        functionName: 'fillLimitOrder',
        args: [orderId, fillAmountWei],
      });
    },
    [writeContract, reset],
  );

  return {
    fillLimitOrder,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useCancelLimitOrder  --  calls contract.cancelLimitOrder(...)
// ----------------------------------------------------------------

export function useCancelLimitOrder() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const cancelLimitOrder = useCallback(
    (orderId: bigint) => {
      reset();
      writeContract({
        address: LIMIT_ORDER_BOOK_ADDRESS,
        abi: LIMIT_ORDER_BOOK_ABI,
        functionName: 'cancelLimitOrder',
        args: [orderId],
      });
    },
    [writeContract, reset],
  );

  return {
    cancelLimitOrder,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useErc1155Approval  --  calls setApprovalForAll for limit sell orders
// ----------------------------------------------------------------

export function useErc1155Approval() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const setApprovalForAll = useCallback(
    (operator: `0x${string}`, approved: boolean) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'setApprovalForAll',
        args: [operator, approved],
      });
    },
    [writeContract, reset],
  );

  return {
    setApprovalForAll,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

export function useIsApprovedForAll(account?: `0x${string}`, operator?: `0x${string}`) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'isApprovedForAll',
    args: account && operator ? [account, operator] : undefined,
    query: {
      enabled: !!account && !!operator,
    },
  });

  return {
    isApproved: (data as boolean) ?? false,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// useMintTestUSDT  --  mint test USDT on testnet (MockUSDT)
// ----------------------------------------------------------------

export function useMintTestUSDT() {
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const mint = useCallback(
    (to: `0x${string}`, amount: string = '10000') => {
      reset();
      writeContract({
        address: USDT_ADDRESS,
        abi: MOCK_USDT_MINT_ABI,
        functionName: 'mint',
        args: [to, parseUnits(amount, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    mint,
    txHash,
    isLoading: isWriting || isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}
