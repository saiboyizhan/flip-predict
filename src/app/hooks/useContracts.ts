/**
 * Custom hooks for PredictionMarket smart contract interactions.
 *
 * Each hook wraps wagmi's useWriteContract / useReadContract and provides
 * a simple interface with loading, error, and txHash state.
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
  USDT_ADDRESS,
  ERC20_ABI,
  MOCK_USDT_MINT_ABI,
} from '@/app/config/contracts';

// ----------------------------------------------------------------
// useDeposit  --  calls contract.deposit() with USDT amount
// ----------------------------------------------------------------

export function useDeposit() {
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

  const deposit = useCallback(
    (amountUSDT: string) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'deposit',
        args: [parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    deposit,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useWithdraw  --  calls contract.withdraw(amount)
// ----------------------------------------------------------------

export function useWithdraw() {
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

  const withdraw = useCallback(
    (amountUSDT: string) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'withdraw',
        args: [parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    withdraw,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useWithdrawWithPermit  --  calls contract.withdrawWithPermit(amount, nonce, deadline, sig)
//   One-step instant withdrawal: backend signs permit, user calls contract, USDT arrives immediately.
// ----------------------------------------------------------------

export function useWithdrawWithPermit() {
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

  const withdrawWithPermit = useCallback(
    (amountWei: bigint, nonce: bigint, deadline: bigint, signature: `0x${string}`) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'withdrawWithPermit',
        args: [amountWei, nonce, deadline, signature],
      });
    },
    [writeContract, reset],
  );

  return {
    withdrawWithPermit,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// useTakePosition  --  calls contract.takePosition(marketId, isYes, amount)
// ----------------------------------------------------------------

export function useTakePosition() {
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

  const takePosition = useCallback(
    (marketId: bigint, isYes: boolean, amountUSDT: string) => {
      reset();
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'takePosition',
        args: [marketId, isYes, parseUnits(amountUSDT, 18)],
      });
    },
    [writeContract, reset],
  );

  return {
    takePosition,
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
      } catch {
        // Ignore non-matching logs
      }
    }

    setCreatedMarketId(parsedMarketId);
  }, [receipt]);

  const createUserMarket = useCallback(
    (
      title: string,
      endTimeUnix: bigint,
      initialLiquidityWei: bigint = 0n,
    ) => {
      reset();
      setCreatedMarketId(null);
      writeContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'createUserMarket',
        args: [title, endTimeUnix, initialLiquidityWei],
      });
    },
    [writeContract, reset],
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
// useContractBalance  --  reads USDT balanceOf(address) from ERC-20
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
    /** Raw balance in wei (bigint) */
    balanceRaw: (data as bigint) ?? 0n,
    /** Formatted balance in USDT (string) */
    balanceUSDT,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// usePredictionMarketBalance  --  reads PredictionMarket.balances(user)
// ----------------------------------------------------------------

export function usePredictionMarketBalance(address?: `0x${string}`) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'balances',
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
      reset();
      writeContract({
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, amountWei],
      });
    },
    [writeContract, reset],
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

  // data is a tuple: [title, endTime, totalYes, totalNo, resolved, outcome, ...]
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
    /** Raw token balance in wei (bigint) */
    balanceRaw: (data as bigint) ?? 0n,
    /** Formatted token balance (string) */
    balanceUSDT: data != null ? formatUnits(data as bigint, 18) : '0',
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// Helper: useTxToast  --  shows toast on tx lifecycle (optional)
// ----------------------------------------------------------------

import { toast } from 'sonner';

/** Returns the BSCScan base URL based on chain ID */
export function getBscScanUrl(chainId?: number): string {
  return chainId === 97
    ? 'https://testnet.bscscan.com'
    : 'https://bscscan.com';
}

/**
 * Watches a txHash through confirmation and fires toasts.
 * Returns nothing, purely side-effect.
 */
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
