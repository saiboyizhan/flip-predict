// AMM Constant Product Market Maker Engine
// Formula: YES_reserve * NO_reserve = k (constant)
// YES price = NO_reserve / (YES_reserve + NO_reserve)
// NO price  = YES_reserve / (YES_reserve + NO_reserve)

export interface Pool {
  yesReserve: number;
  noReserve: number;
  k: number;
  totalLiquidity: number;
}

export interface BuyResult {
  shares: number;
  avgPrice: number;
  priceImpact: number;
  newPool: Pool;
}

export interface SellResult {
  payout: number;
  avgPrice: number;
  priceImpact: number;
  newPool: Pool;
}

export interface EstimatedReturn {
  shares: number;
  potentialPayout: number;
  potentialProfit: number;
}

const MIN_TRADE_AMOUNT = 0.01;
// P0-1 Fix: MIN_RESERVE increased from 0.001 to 1.0 (0.01% of initial 10000 liquidity)
const MIN_RESERVE = 1.0;

/**
 * Create a symmetric pool where YES and NO each start at 50% price.
 */
export function createPool(initialLiquidity: number): Pool {
  const reserve = initialLiquidity;
  return {
    yesReserve: reserve,
    noReserve: reserve,
    k: reserve * reserve,
    totalLiquidity: initialLiquidity,
  };
}

/**
 * Create an asymmetric pool with a target YES price.
 *
 * Given:
 *   yesPrice = noReserve / (yesReserve + noReserve)
 *   totalLiquidity = yesReserve + noReserve
 *
 * Solving:
 *   noReserve  = yesPrice * totalLiquidity
 *   yesReserve = (1 - yesPrice) * totalLiquidity
 */
export function createPoolFromPrices(yesPrice: number, totalLiquidity: number): Pool {
  if (yesPrice <= 0 || yesPrice >= 1) {
    throw new Error('yesPrice must be between 0 and 1 (exclusive)');
  }
  if (totalLiquidity <= 0) {
    throw new Error('totalLiquidity must be positive');
  }

  const noReserve = yesPrice * totalLiquidity;
  const yesReserve = (1 - yesPrice) * totalLiquidity;

  // P2-9 Fix: Rename totalLiquidity to initialLiquidity in Pool interface for clarity
  // (Note: This is the constant initial value, not the sum of current reserves)
  return {
    yesReserve,
    noReserve,
    k: yesReserve * noReserve,
    totalLiquidity, // Keep as-is for backward compatibility; consider renaming field in future
  };
}

/**
 * Get current price for a given side.
 * P1-5 Fix: Return default 0.5 instead of 0 when reserves are zero (consistent with backend).
 */
export function getPrice(pool: Pool, side: 'yes' | 'no'): number {
  if (!Number.isFinite(pool.yesReserve) || !Number.isFinite(pool.noReserve) ||
      pool.yesReserve <= 0 || pool.noReserve <= 0) {
    return 0.5;
  }
  const total = pool.yesReserve + pool.noReserve;
  if (total === 0) return 0.5;

  if (side === 'yes') {
    return pool.noReserve / total;
  }
  return pool.yesReserve / total;
}

/**
 * Calculate the result of buying shares on a given side.
 *
 * When buying YES shares with `amount` BNB:
 *   1. The amount is added to the NO reserve (the opposite side)
 *   2. YES reserve adjusts to maintain k: newYesReserve = k / newNoReserve
 *   3. Shares received = old YES reserve - new YES reserve
 *
 * This follows the standard CPMM swap model:
 *   - Buying YES = swapping BNB into the opposite side of the pool
 *   - The pool gives back shares from the target side's reserve decrease
 */
export function calculateBuy(
  pool: Pool,
  side: 'yes' | 'no',
  amount: number
): BuyResult {
  if (!Number.isFinite(amount) || amount < MIN_TRADE_AMOUNT) {
    throw new Error(`Minimum trade amount is ${MIN_TRADE_AMOUNT}`);
  }

  const currentPrice = getPrice(pool, side);

  let newYesReserve: number;
  let newNoReserve: number;
  let shares: number;

  if (side === 'yes') {
    // Buying YES: mint amount YES+NO, add NO to pool, swap out YES
    newNoReserve = pool.noReserve + amount;
    newYesReserve = pool.k / newNoReserve;
    shares = amount + (pool.yesReserve - newYesReserve);
  } else {
    // Buying NO: mint amount YES+NO, add YES to pool, swap out NO
    newYesReserve = pool.yesReserve + amount;
    newNoReserve = pool.k / newYesReserve;
    shares = amount + (pool.noReserve - newNoReserve);
  }

  // Guard against reserve depletion causing extreme values
  if (newYesReserve < MIN_RESERVE || newNoReserve < MIN_RESERVE) {
    throw new Error('Trade too large: would deplete AMM reserves');
  }

  const avgPrice = amount / shares;
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(avgPrice)) {
    throw new Error('AMM buy calculation failed');
  }
  // P1-4 Fix: Unified price impact calculation with divide-by-zero protection
  const priceImpact = currentPrice > 0
    ? Math.abs(avgPrice - currentPrice) / currentPrice * 100
    : 0;

  const newPool: Pool = {
    yesReserve: newYesReserve,
    noReserve: newNoReserve,
    k: pool.k,
    totalLiquidity: pool.totalLiquidity,
  };

  return { shares, avgPrice, priceImpact, newPool };
}

/**
 * Calculate the result of selling shares on a given side.
 *
 * When selling YES shares:
 *   1. Shares are returned to the YES reserve (reverse of buying)
 *   2. NO reserve adjusts to maintain k: newNoReserve = k / newYesReserve
 *   3. Payout = old NO reserve - new NO reserve
 */
export function calculateSell(
  pool: Pool,
  side: 'yes' | 'no',
  shares: number
): SellResult {
  if (!Number.isFinite(shares) || shares < MIN_TRADE_AMOUNT) {
    throw new Error(`Minimum trade amount is ${MIN_TRADE_AMOUNT}`);
  }

  const currentPrice = getPrice(pool, side);

  let newYesReserve: number;
  let newNoReserve: number;
  let payout: number;

  if (side === 'yes') {
    // Selling YES (CTF pair-burn model): add shares to YES pool, pair-burn YES+NO to redeem USDT
    // Quadratic: payout = (b - sqrt(b^2 - 4c)) / 2
    const b = pool.yesReserve + pool.noReserve + shares;
    const c = shares * pool.noReserve;
    payout = (b - Math.sqrt(b * b - 4 * c)) / 2;
    newYesReserve = pool.yesReserve + shares - payout;
    newNoReserve = pool.noReserve - payout;
  } else {
    // Selling NO (CTF pair-burn model): add shares to NO pool, pair-burn YES+NO to redeem USDT
    const b = pool.yesReserve + pool.noReserve + shares;
    const c = shares * pool.yesReserve;
    payout = (b - Math.sqrt(b * b - 4 * c)) / 2;
    newNoReserve = pool.noReserve + shares - payout;
    newYesReserve = pool.yesReserve - payout;
  }

  // Guard against reserve depletion
  if (newYesReserve < MIN_RESERVE || newNoReserve < MIN_RESERVE) {
    throw new Error('Trade too large: would deplete AMM reserves');
  }

  const avgPrice = payout / shares;
  if (!Number.isFinite(payout) || payout <= 0 || !Number.isFinite(avgPrice)) {
    throw new Error('AMM sell calculation failed');
  }
  const priceImpact = currentPrice > 0
    ? Math.abs(currentPrice - avgPrice) / currentPrice * 100
    : 0;

  const newPool: Pool = {
    yesReserve: newYesReserve,
    noReserve: newNoReserve,
    k: pool.k,
    totalLiquidity: pool.totalLiquidity,
  };

  return { payout, avgPrice, priceImpact, newPool };
}

/**
 * Estimate potential return for a buy.
 *
 * - shares: how many shares you get for `amount`
 * - potentialPayout: if the outcome resolves YES (or NO), each share pays 1.0
 * - potentialProfit: potentialPayout - amount
 */
export function getEstimatedReturn(
  pool: Pool,
  side: 'yes' | 'no',
  amount: number
): EstimatedReturn {
  if (amount < MIN_TRADE_AMOUNT) {
    return { shares: 0, potentialPayout: 0, potentialProfit: 0 };
  }

  const { shares } = calculateBuy(pool, side, amount);

  // If the outcome resolves in your favor, each share pays out 1.0
  const potentialPayout = shares;
  const potentialProfit = potentialPayout - amount;

  return { shares, potentialPayout, potentialProfit };
}
