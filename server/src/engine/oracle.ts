import { ethers } from 'ethers';

// Binance Oracle Feed Adapter ABI (read-only functions)
const ORACLE_ABI = [
  'function latestAnswer() external view returns (int256)',
  'function decimals() external view returns (uint8)',
  'function latestTimestamp() external view returns (uint256)',
  'function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'
];

// BSC mainnet Binance Oracle feed addresses (Chainlink-compatible interface)
export const ORACLE_FEEDS: Record<string, string> = {
  'BTC/USD': '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf',
  'BNB/USD': '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
  'ETH/USD': '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',
  'SOL/USD': '0x0E8a53DD9c13589df6382F13dA6B3Ec8F919B323',
  'DOGE/USD': '0x3AB0A0d137D4F946fBB19eecc6e92E64660231C8',
  'XRP/USD': '0x93A67D414fF9e2B2fCa22e41e8b3e5934cFB1310',
};

export const SUPPORTED_PAIRS = Object.keys(ORACLE_FEEDS);

const BSC_RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org';

let cachedProvider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(BSC_RPC);
  }
  return cachedProvider;
}

interface OraclePrice {
  price: number;
  decimals: number;
  updatedAt: number;
  raw: bigint;
}

export async function getOraclePrice(pair: string): Promise<OraclePrice> {
  const feedAddress = ORACLE_FEEDS[pair];
  if (feedAddress) {
    try {
      const provider = getProvider();
      const contract = new ethers.Contract(feedAddress, ORACLE_ABI, provider);
      const [, answer, , updatedAt] = await contract.latestRoundData();
      const decimals = await contract.decimals();
      const price = Number(answer) / Math.pow(10, Number(decimals));

      // Bug D29 Fix: Reject stale oracle data. If the price feed hasn't been
      // updated in over 1 hour, the data is likely unreliable.
      const updatedAtSec = Number(updatedAt);
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - updatedAtSec > 3600) {
        console.warn(`Oracle data for ${pair} is stale (last updated ${nowSec - updatedAtSec}s ago), trying fallback...`);
        return await getFallbackPrice(pair);
      }

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Invalid oracle price for ${pair}: ${price}`);
      }

      return { price, decimals: Number(decimals), updatedAt: updatedAtSec, raw: answer };
    } catch (err) {
      console.warn(`Oracle read failed for ${pair}, trying fallback...`);
    }
  }

  return await getFallbackPrice(pair);
}

async function getFallbackPrice(pair: string): Promise<OraclePrice> {
  // Use Binance public API as fallback (no key required)
  const symbolMap: Record<string, string> = {
    'BTC/USD': 'BTCUSDT',
    'BNB/USD': 'BNBUSDT',
    'ETH/USD': 'ETHUSDT',
    'SOL/USD': 'SOLUSDT',
  };
  const binanceSymbol = symbolMap[pair];
  if (!binanceSymbol) throw new Error(`Unsupported pair: ${pair}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let resp: Response;
  try {
    resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!resp.ok) {
    throw new Error(`Binance API returned HTTP ${resp.status} for ${pair}`);
  }
  const data = await resp.json();
  const price = parseFloat(data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`No valid price from Binance for ${pair}`);
  }

  return {
    price,
    decimals: 8,
    updatedAt: Math.floor(Date.now() / 1000),
    raw: BigInt(Math.round(price * 1e8))
  };
}
