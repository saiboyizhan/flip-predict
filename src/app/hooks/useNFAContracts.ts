/**
 * Custom hooks for NFA (BAP-578) smart contract interactions.
 *
 * Each hook wraps wagmi's useWriteContract / useReadContract and provides
 * a simple interface with loading, error, and txHash state.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  useAccount,
} from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { NFA_ABI, NFA_CONTRACT_ADDRESS } from '@/app/config/nfaContracts';
import { USDT_ADDRESS, ERC20_ABI } from '@/app/config/contracts';

// ----------------------------------------------------------------
// READ HOOKS
// ----------------------------------------------------------------

/**
 * useAgentState - Read agent's current state (0=ACTIVE, 1=PAUSED, 2=TERMINATED)
 */
export function useAgentState(tokenId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'getState',
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: {
      enabled: tokenId !== undefined,
    },
  });

  const stateValue = data !== undefined ? Number(data) : undefined;
  const stateName =
    stateValue === 0 ? 'ACTIVE' :
    stateValue === 1 ? 'PAUSED' :
    stateValue === 2 ? 'TERMINATED' :
    'UNKNOWN';

  return {
    state: stateValue,
    stateValue,
    stateName,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useAgentBalance - Read agent's USDT balance
 */
export function useAgentBalance(tokenId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'getAgentBalance',
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: {
      enabled: tokenId !== undefined,
    },
  });

  const balanceUSDT = data !== undefined ? formatUnits(data as bigint, 18) : '0';

  return {
    balanceRaw: (data as bigint) ?? 0n,
    balanceUSDT,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useAgentMetadata - Read agent metadata (name, persona, etc.)
 */
export function useAgentMetadata(tokenId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'getAgentMetadata',
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: {
      enabled: tokenId !== undefined,
    },
  });

  type MetadataTuple = readonly [string, string, `0x${string}`, string, string, `0x${string}`, number];
  const md = data as MetadataTuple | undefined;
  const metadata = md
    ? {
        name: md[0],
        persona: md[1],
        voiceHash: md[2],
        animationURI: md[3],
        vaultURI: md[4],
        vaultHash: md[5],
        avatarId: md[6],
      }
    : null;

  return {
    metadata,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useMaxAgentsPerAddress - Read contract constant MAX_AGENTS_PER_ADDRESS
 */
export function useMaxAgentsPerAddress() {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'MAX_AGENTS_PER_ADDRESS',
  });

  return {
    maxAgents: data !== undefined ? Number(data) : 0,
    isLoading,
    error,
    refetch,
  };
}

// ----------------------------------------------------------------
// WRITE HOOKS
// ----------------------------------------------------------------

/**
 * useFundAgent - Fund agent with USDT (requires approve first)
 * Automatically checks allowance and approves if needed.
 */
export function useFundAgent() {
  const { address: userAddress } = useAccount();
  const [needsApproval, setNeedsApproval] = useState(false);
  const [pendingAmount, setPendingAmount] = useState<bigint | null>(null);

  // USDT allowance check
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: USDT_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args:
      userAddress && NFA_CONTRACT_ADDRESS
        ? [userAddress, NFA_CONTRACT_ADDRESS as `0x${string}`]
        : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  const allowanceRaw = (allowanceData as bigint) ?? 0n;

  // Approve hook
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const {
    isLoading: isApproveConfirming,
    isSuccess: isApproveConfirmed,
    error: approveConfirmError,
  } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Fund hook
  const {
    writeContract: writeFund,
    data: fundTxHash,
    isPending: isFunding,
    error: fundError,
    reset: resetFund,
  } = useWriteContract();

  const {
    isLoading: isFundConfirming,
    isSuccess: isFundConfirmed,
    error: fundConfirmError,
  } = useWaitForTransactionReceipt({ hash: fundTxHash });

  // Track pending tokenId for auto-fund after approve
  const [pendingTokenId, setPendingTokenId] = useState<bigint | null>(null);

  // When approve is confirmed, automatically proceed to fund
  useEffect(() => {
    if (isApproveConfirmed && needsApproval && pendingAmount !== null && pendingTokenId !== null) {
      setNeedsApproval(false);
      refetchAllowance();
      // Auto-execute fund after approval
      writeFund({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'fundAgent',
        args: [pendingTokenId, pendingAmount],
      });
    }
  }, [isApproveConfirmed, needsApproval, pendingAmount, pendingTokenId, refetchAllowance, writeFund]);

  const fundAgent = useCallback(
    (tokenId: bigint, amountUSDT: string) => {
      resetApprove();
      resetFund();

      const amountWei = parseUnits(amountUSDT, 18);
      setPendingAmount(amountWei);
      setPendingTokenId(tokenId);

      // Check if we need to approve
      if (allowanceRaw < amountWei) {
        setNeedsApproval(true);
        writeApprove({
          address: USDT_ADDRESS as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [NFA_CONTRACT_ADDRESS as `0x${string}`, amountWei],
        });
      } else {
        // Already approved, fund directly
        setNeedsApproval(false);
        writeFund({
          address: NFA_CONTRACT_ADDRESS as `0x${string}`,
          abi: NFA_ABI,
          functionName: 'fundAgent',
          args: [tokenId, amountWei],
        });
      }
    },
    [allowanceRaw, writeApprove, writeFund, resetApprove, resetFund],
  );

  return {
    fundAgent,
    needsApproval,
    approveNeeded: needsApproval, // alias for compatibility
    isApproving,
    txHash: needsApproval ? approveTxHash : fundTxHash,
    isPending: needsApproval ? isApproving : isFunding,
    isConfirming: needsApproval ? isApproveConfirming : isFundConfirming,
    isSuccess: needsApproval ? isApproveConfirmed : isFundConfirmed,
    error: approveError || approveConfirmError || fundError || fundConfirmError,
    reset: () => {
      resetApprove();
      resetFund();
      setNeedsApproval(false);
      setPendingAmount(null);
      setPendingTokenId(null);
    },
  };
}

/**
 * useWithdrawFromAgent - Withdraw USDT from agent
 */
export function useWithdrawFromAgent() {
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
    (tokenId: bigint, amountUSDT: string) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'withdrawFromAgent',
        args: [tokenId, parseUnits(amountUSDT, 18)],
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

/**
 * usePauseAgent - Pause agent (only owner)
 */
export function usePauseAgent() {
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

  const pauseAgent = useCallback(
    (tokenId: bigint) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'pauseAgent',
        args: [tokenId],
      });
    },
    [writeContract, reset],
  );

  return {
    pauseAgent,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

/**
 * useUnpauseAgent - Unpause agent (only owner)
 */
export function useUnpauseAgent() {
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

  const unpauseAgent = useCallback(
    (tokenId: bigint) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'unpauseAgent',
        args: [tokenId],
      });
    },
    [writeContract, reset],
  );

  return {
    unpauseAgent,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

/**
 * useTerminateAgent - Terminate agent (only owner, irreversible)
 * Note: Does NOT auto-execute. Caller must invoke terminateAgent(tokenId) explicitly.
 */
export function useTerminateAgent() {
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

  const terminateAgent = useCallback(
    (tokenId: bigint) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'terminateAgent',
        args: [tokenId],
      });
    },
    [writeContract, reset],
  );

  return {
    terminateAgent,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

/**
 * useTransferAgent - Transfer NFT ownership (for buying/selling agents)
 * Uses ERC721 transferFrom to transfer ownership on-chain.
 */
export function useTransferAgent() {
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

  const transferAgent = useCallback(
    (from: `0x${string}`, to: `0x${string}`, tokenId: bigint) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'transferFrom',
        args: [from, to, tokenId],
      });
    },
    [writeContract, reset],
  );

  return {
    transferAgent,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// LEARNING MODULE HOOKS
// ----------------------------------------------------------------

/**
 * useAgentLearning - Read agent's learning metrics
 */
export function useAgentLearning(tokenId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'getLearningMetrics',
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: {
      enabled: tokenId !== undefined,
    },
  });

  type MetricsTuple = readonly [bigint, bigint, `0x${string}`, bigint];
  const md = data as MetricsTuple | undefined;
  const metrics = md
    ? {
        totalInteractions: Number(md[0]),
        successfulOutcomes: Number(md[1]),
        learningRoot: md[2],
        lastUpdated: Number(md[3]),
      }
    : null;

  return {
    metrics,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useUpdateLearning - Update agent's learning root
 */
export function useUpdateLearning() {
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

  const updateLearning = useCallback(
    (tokenId: bigint, newRoot: `0x${string}`, proof: `0x${string}`) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'updateLearning',
        args: [tokenId, newRoot, proof],
      });
    },
    [writeContract, reset],
  );

  return {
    updateLearning,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// MEMORY MODULE HOOKS
// ----------------------------------------------------------------

/**
 * useAgentModule - Read a specific memory module
 */
export function useAgentModule(tokenId: bigint | undefined, moduleAddress: `0x${string}` | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'getModule',
    args: tokenId !== undefined && moduleAddress ? [tokenId, moduleAddress] : undefined,
    query: {
      enabled: tokenId !== undefined && !!moduleAddress,
    },
  });

  type ModuleTuple = readonly [`0x${string}`, string, `0x${string}`, bigint, boolean];
  const md = data as ModuleTuple | undefined;
  const module = md
    ? {
        moduleAddress: md[0],
        metadata: md[1],
        metadataHash: md[2],
        registrationTime: Number(md[3]),
        isActive: md[4],
      }
    : null;

  return {
    module,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useRegisterModule - Register a new memory module
 */
export function useRegisterModule() {
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

  const registerModule = useCallback(
    (tokenId: bigint, moduleAddress: `0x${string}`, metadata: string) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'registerModule',
        args: [tokenId, moduleAddress, metadata],
      });
    },
    [writeContract, reset],
  );

  return {
    registerModule,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

/**
 * useDeactivateModule - Deactivate a memory module
 */
export function useDeactivateModule() {
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

  const deactivateModule = useCallback(
    (tokenId: bigint, moduleAddress: `0x${string}`) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'deactivateModule',
        args: [tokenId, moduleAddress],
      });
    },
    [writeContract, reset],
  );

  return {
    deactivateModule,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// VAULT PERMISSION HOOKS
// ----------------------------------------------------------------

/**
 * useVaultPermission - Read vault permission for a delegate
 */
export function useVaultPermission(tokenId: bigint | undefined, delegate: `0x${string}` | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: NFA_CONTRACT_ADDRESS as `0x${string}`,
    abi: NFA_ABI,
    functionName: 'getPermission',
    args: tokenId !== undefined && delegate ? [tokenId, delegate] : undefined,
    query: {
      enabled: tokenId !== undefined && !!delegate,
    },
  });

  type PermissionTuple = readonly [`0x${string}`, number, bigint, boolean];
  const pd = data as PermissionTuple | undefined;
  const permission = pd
    ? {
        delegate: pd[0],
        level: pd[1],
        expiryTime: Number(pd[2]),
        isActive: pd[3],
      }
    : null;

  return {
    permission,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useDelegateAccess - Delegate vault access to an address
 */
export function useDelegateAccess() {
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

  const delegateAccess = useCallback(
    (tokenId: bigint, delegate: `0x${string}`, level: number, expiryTime: bigint) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'delegateAccess',
        args: [tokenId, delegate, level, expiryTime],
      });
    },
    [writeContract, reset],
  );

  return {
    delegateAccess,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

/**
 * useRevokeAccess - Revoke vault access from a delegate
 */
export function useRevokeAccess() {
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

  const revokeAccess = useCallback(
    (tokenId: bigint, delegate: `0x${string}`) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'revokeAccess',
        args: [tokenId, delegate],
      });
    },
    [writeContract, reset],
  );

  return {
    revokeAccess,
    txHash,
    isWriting,
    isConfirming,
    isConfirmed,
    error: writeError || confirmError,
    reset,
  };
}

// ----------------------------------------------------------------
// COPY TRADING ON-CHAIN HOOKS
// ----------------------------------------------------------------

/**
 * useAgentTakePosition - Agent takes position in prediction market
 * Used for on-chain copy trading
 */
export function useAgentTakePosition() {
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
    (tokenId: bigint, marketId: bigint, side: 0 | 1, amountUSDT: string) => {
      reset();
      writeContract({
        address: NFA_CONTRACT_ADDRESS as `0x${string}`,
        abi: NFA_ABI,
        functionName: 'agentPredictionTakePosition',
        args: [tokenId, marketId, side === 1, parseUnits(amountUSDT, 18)],
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
