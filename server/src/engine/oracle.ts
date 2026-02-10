import { ethers } from 'ethers';

// Binance Oracle Feed Adapter ABI (read-only functions)
const ORACLE_ABI = [
  'function latestAnswer() external view returns (int256)',
  'function decimals() external view returns (uint8)',
  'function latestTimestamp() external view returns (uint256)',
  'function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)'
];

// BSC mainnet known Oracle Adapter addresses
export const ORACLE_FEEDS: Record<string, string> = {
  'BTC/USD': '0x491fD333937522e69D1c3FB944fbC5e95eEF9f59',
  'BNB/USD': '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
  'ETH/USD': '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',
};

export const SUPPORTED_PAIRS = Object.keys(ORACLE_FEEDS);

const BSC_RPC = 'https://bsc-dataseed.bnbchain.org';

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
      const provider = new ethers.JsonRpcProvider(BSC_RPC);
      const contract = new ethers.Contract(feedAddress, ORACLE_ABI, provider);
      const [, answer, , updatedAt] = await contract.latestRoundData();
      const decimals = await contract.decimals();
      const price = Number(answer) / Math.pow(10, Number(decimals));
      return { price, decimals: Number(decimals), updatedAt: Number(updatedAt), raw: answer };
    } catch (err) {
      console.warn(`Oracle read failed for ${pair}, trying fallback...`);
    }
  }

  return await getFallbackPrice(pair);
}

async function getFallbackPrice(pair: string): Promise<OraclePrice> {
  const coinMap: Record<string, string> = {
    'BTC/USD': 'bitcoin',
    'BNB/USD': 'binancecoin',
    'ETH/USD': 'ethereum',
    'SOL/USD': 'solana',
  };
  const coinId = coinMap[pair];
  if (!coinId) throw new Error(`Unsupported pair: ${pair}`);

  const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
  const data = await resp.json();
  const price = data[coinId]?.usd;
  if (!price) throw new Error(`No price for ${pair}`);

  return {
    price,
    decimals: 8,
    updatedAt: Math.floor(Date.now() / 1000),
    raw: BigInt(Math.round(price * 1e8))
  };
}
