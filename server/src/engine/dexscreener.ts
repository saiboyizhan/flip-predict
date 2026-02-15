/**
 * DexScreener API integration for BSC token price data.
 * Free API, no key required.
 */

// --- Types ---

export interface TokenPrice {
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  pairAddress: string;
  dexId: string;
  fetchedAt: number;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

// --- Common BSC token addresses ---

export const BSC_TOKENS: Record<string, string> = {
  BNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  FLOKI: '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E',
  PEPE: '0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00',
  DOGE: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43',
  SHIB: '0x2859e4544C4bB03966803b044A93563Bd2D0DD4D',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

// Reverse lookup: address (lowercased) -> symbol
const ADDRESS_TO_SYMBOL = new Map<string, string>();
for (const [symbol, addr] of Object.entries(BSC_TOKENS)) {
  ADDRESS_TO_SYMBOL.set(addr.toLowerCase(), symbol);
}

// --- Price cache (60s TTL) ---

const CACHE_TTL_MS = 60_000;
const priceCache = new Map<string, { data: TokenPrice; expiresAt: number }>();

function getCached(address: string): TokenPrice | null {
  const key = address.toLowerCase();
  const entry = priceCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    priceCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(address: string, data: TokenPrice): void {
  priceCache.set(address.toLowerCase(), { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- API calls ---

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';

function pickBestPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
  // Filter to BSC pairs only, then pick highest liquidity
  const bscPairs = pairs.filter(p => p.chainId === 'bsc');
  if (bscPairs.length === 0) return pairs[0] ?? null;
  bscPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return bscPairs[0];
}

function pairToTokenPrice(pair: DexScreenerPair): TokenPrice {
  return {
    price: Number(pair.priceUsd ?? 0),
    priceChange24h: pair.priceChange?.h24 ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    liquidity: pair.liquidity?.usd ?? 0,
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    fetchedAt: Date.now(),
  };
}

/**
 * Fetch price for a single BSC token by contract address.
 */
export async function fetchTokenPrice(tokenAddress: string): Promise<TokenPrice> {
  const cached = getCached(tokenAddress);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch(`${DEXSCREENER_BASE}/tokens/${tokenAddress}`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`DexScreener API returned HTTP ${resp.status}`);
    }
    const data: DexScreenerResponse = await resp.json();
    if (!data.pairs || data.pairs.length === 0) {
      throw new Error(`No pairs found for token ${tokenAddress}`);
    }

    const best = pickBestPair(data.pairs);
    if (!best) throw new Error(`No suitable pair for ${tokenAddress}`);

    const result = pairToTokenPrice(best);
    if (!Number.isFinite(result.price) || result.price <= 0) {
      throw new Error(`Invalid price from DexScreener for ${tokenAddress}: ${result.price}`);
    }

    setCache(tokenAddress, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch prices for multiple tokens in parallel.
 * DexScreener supports comma-separated addresses (up to ~30 per call).
 */
export async function fetchMultipleTokenPrices(addresses: string[]): Promise<Map<string, TokenPrice>> {
  const result = new Map<string, TokenPrice>();
  const uncached: string[] = [];

  // Return cached entries first
  for (const addr of addresses) {
    const cached = getCached(addr);
    if (cached) {
      result.set(addr.toLowerCase(), cached);
    } else {
      uncached.push(addr);
    }
  }

  if (uncached.length === 0) return result;

  // DexScreener multi-token endpoint accepts comma-separated addresses
  const BATCH_SIZE = 30;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const joined = batch.join(',');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(`${DEXSCREENER_BASE}/tokens/${joined}`, {
        signal: controller.signal,
      });
      if (!resp.ok) {
        console.error(`DexScreener batch request failed: HTTP ${resp.status}`);
        continue;
      }
      const data: DexScreenerResponse = await resp.json();
      if (!data.pairs) continue;

      // Group pairs by base token address
      const grouped = new Map<string, DexScreenerPair[]>();
      for (const pair of data.pairs) {
        const key = pair.baseToken.address.toLowerCase();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(pair);
      }

      for (const [addr, pairs] of grouped) {
        const best = pickBestPair(pairs);
        if (!best) continue;
        const tp = pairToTokenPrice(best);
        if (Number.isFinite(tp.price) && tp.price > 0) {
          setCache(addr, tp);
          result.set(addr, tp);
        }
      }
    } catch (err: any) {
      console.error(`DexScreener batch fetch error:`, err.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  return result;
}

/**
 * Resolve a token symbol to its BSC address, or return the input if it looks like an address.
 */
export function resolveTokenAddress(symbolOrAddress: string): string | null {
  if (symbolOrAddress.startsWith('0x') && symbolOrAddress.length === 42) {
    return symbolOrAddress;
  }
  return BSC_TOKENS[symbolOrAddress.toUpperCase()] ?? null;
}

/**
 * Get the symbol for a known BSC token address.
 */
export function getTokenSymbol(address: string): string | null {
  return ADDRESS_TO_SYMBOL.get(address.toLowerCase()) ?? null;
}

/**
 * Convenience: fetch price by symbol name (e.g. "BNB", "CAKE").
 */
export async function fetchTokenPriceBySymbol(symbol: string): Promise<TokenPrice> {
  const address = resolveTokenAddress(symbol);
  if (!address) throw new Error(`Unknown token symbol: ${symbol}`);
  return fetchTokenPrice(address);
}

/**
 * Clear the price cache (useful for testing).
 */
export function clearPriceCache(): void {
  priceCache.clear();
}
