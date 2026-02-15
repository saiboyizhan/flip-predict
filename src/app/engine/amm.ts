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

  return {
    yesReserve,
    noReserve,
    k: yesReserve * noReserve,
    totalLiquidity,
  };
}

/**
 * Get current price for a given side.
 */
export function getPrice(pool: Pool, side: 'yes' | 'no'): number {
  const total = pool.yesReserve + pool.noReserve;
  if (total === 0) return 0;

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
  if (amount < MIN_TRADE_AMOUNT) {
    throw new Error(`Minimum trade amount is ${MIN_TRADE_AMOUNT}`);
  }

  const currentPrice = getPrice(pool, side);

  let newYesReserve: number;
  let newNoReserve: number;
  let shares: number;

  if (side === 'yes') {
    // Buying YES: add amount to noReserve (the other side), yesReserve decreases
    newNoReserve = pool.noReserve + amount;
    newYesReserve = pool.k / newNoReserve;
    shares = pool.yesReserve - newYesReserve;
  } else {
    // Buying NO: add amount to yesReserve (the other side), noReserve decreases
    newYesReserve = pool.yesReserve + amount;
    newNoReserve = pool.k / newYesReserve;
    shares = pool.noReserve - newNoReserve;
  }

  const avgPrice = amount / shares;
  const priceImpact = ((avgPrice - currentPrice) / currentPrice) * 100;

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
  if (shares < MIN_TRADE_AMOUNT) {
    throw new Error(`Minimum trade amount is ${MIN_TRADE_AMOUNT}`);
  }

  const currentPrice = getPrice(pool, side);

  let newYesReserve: number;
  let newNoReserve: number;
  let payout: number;

  if (side === 'yes') {
    // Selling YES: add shares back to yesReserve, noReserve decreases
    newYesReserve = pool.yesReserve + shares;
    newNoReserve = pool.k / newYesReserve;
    payout = pool.noReserve - newNoReserve;
  } else {
    // Selling NO: add shares back to noReserve, yesReserve decreases
    newNoReserve = pool.noReserve + shares;
    newYesReserve = pool.k / newNoReserve;
    payout = pool.yesReserve - newYesReserve;
  }

  const avgPrice = payout / shares;
  const priceImpact = ((currentPrice - avgPrice) / currentPrice) * 100;

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
