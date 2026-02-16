const RAW_BSC_NETWORK = (process.env.BSC_NETWORK || '').trim().toLowerCase();

export const BSC_NETWORK: 'mainnet' | 'testnet' =
  RAW_BSC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

export const BSC_CHAIN_ID =
  Number(process.env.BSC_CHAIN_ID) ||
  (BSC_NETWORK === 'mainnet' ? 56 : 97);

export const DEFAULT_BSC_RPC_URL =
  BSC_NETWORK === 'mainnet'
    ? 'https://bsc-dataseed.bnbchain.org'
    : 'https://bsc-testnet-rpc.publicnode.com';

export const BSC_RPC_URL = (process.env.BSC_RPC_URL || '').trim() || DEFAULT_BSC_RPC_URL;

export function getRpcUrl(overrideEnvKey: string): string {
  const override = process.env[overrideEnvKey];
  if (typeof override === 'string' && override.trim()) {
    return override.trim();
  }
  return BSC_RPC_URL;
}

export function logNetworkConfigSummary(): void {
  const rpcSource = process.env.BSC_RPC_URL?.trim() ? 'BSC_RPC_URL' : 'default-by-BSC_NETWORK';
  if (!process.env.BSC_NETWORK?.trim()) {
    console.warn('[network] BSC_NETWORK is not set. Defaulting to testnet.');
  }
  if (!process.env.BSC_RPC_URL?.trim()) {
    console.warn('[network] BSC_RPC_URL is not set. Using network default RPC endpoint.');
  }
  console.info(
    `[network] BSC_NETWORK=${BSC_NETWORK} chainId=${BSC_CHAIN_ID} rpcSource=${rpcSource} rpc=${BSC_RPC_URL}`
  );
}
