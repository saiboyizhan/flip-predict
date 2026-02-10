import { useReadContract, useChainId } from "wagmi";
import { formatUnits } from "viem";
import {
  USDT_ADDRESS_BSC,
  USDT_ADDRESS_BSC_TESTNET,
  ERC20_ABI,
} from "../config/contracts";

export function useUSDTBalance(address?: `0x${string}`) {
  const chainId = useChainId();

  const usdtAddress =
    chainId === 97 ? USDT_ADDRESS_BSC_TESTNET : USDT_ADDRESS_BSC;

  const { data, isLoading, isError, refetch } = useReadContract({
    address: usdtAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const balance = data ? parseFloat(formatUnits(data, 18)) : 0;
  const formatted = balance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    balance,
    formatted,
    isLoading,
    isError,
    refetch,
  };
}
