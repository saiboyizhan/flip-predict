/**
 * Constant Product AMM (Automated Market Maker)
 * Uses x * y = k formula where x = yesReserve, y = noReserve
 */

export interface Pool {
  yesReserve: number;
  noReserve: number;
  k: number;
}

export interface TradeResult {
  sharesOut: number;
  pricePerShare: number;
  newYesPrice: number;
  newNoPrice: number;
  newYesReserve: number;
  newNoReserve: number;
  priceImpact: number;
}

export interface SellResult {
  amountOut: number;
  pricePerShare: number;
  newYesPrice: number;
  newNoPrice: number;
  newYesReserve: number;
  newNoReserve: number;
}

export function createPool(initialLiquidity: number = 10000): Pool {
  const yesReserve = initialLiquidity;
  const noReserve = initialLiquidity;
  return {
    yesReserve,
    noReserve,
    k: yesReserve * noReserve,
  };
}

export function getPrice(yesReserve: number, noReserve: number): { yesPrice: number; noPrice: number } {
  // P1-5 Fix: Return default price 0.5/0.5 instead of throwing error when reserves are zero
  if (!Number.isFinite(yesReserve) || !Number.isFinite(noReserve) || yesReserve <= 0 || noReserve <= 0) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }
  const total = yesReserve + noReserve;
  const yesPrice = noReserve / total;
  return {
    yesPrice,
    noPrice: 1 - yesPrice,   // derived — guarantees yes + no === 1
  };
}

/**
 * Calculate buying shares of a given side
 * When buying YES: user puts USDT into the NO reserve, gets YES shares out
 * When buying NO: user puts USDT into the YES reserve, gets NO shares out
 */
export function calculateBuy(
  yesReserve: number,
  noReserve: number,
  side: 'yes' | 'no',
  amount: number
): TradeResult {
  if (!Number.isFinite(yesReserve) || !Number.isFinite(noReserve) || yesReserve <= 0 || noReserve <= 0) {
    throw new Error('Invalid AMM reserves');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid buy amount');
  }

  const k = yesReserve * noReserve;
  const oldPrice = getPrice(yesReserve, noReserve);

  let newYesReserve: number;
  let newNoReserve: number;
  let sharesOut: number;

  if (side === 'yes') {
    // Buying YES: mint amount YES+NO, add NO to pool, swap out YES
    newNoReserve = noReserve + amount;
    newYesReserve = k / newNoReserve;
    sharesOut = amount + (yesReserve - newYesReserve);
  } else {
    // Buying NO: mint amount YES+NO, add YES to pool, swap out NO
    newYesReserve = yesReserve + amount;
    newNoReserve = k / newYesReserve;
    sharesOut = amount + (noReserve - newNoReserve);
  }

  // Bug D1 Fix: Guard against reserve depletion causing extreme values.
  // After a buy, the output reserve must stay above a minimum floor to prevent
  // floating-point overflow in subsequent k/reserve calculations.
  // P0-1 Fix: MIN_RESERVE increased from 0.001 to 1.0 (0.01% of initial 10000 liquidity)
  const MIN_RESERVE = 1.0;
  if (newYesReserve < MIN_RESERVE || newNoReserve < MIN_RESERVE) {
    throw new Error('Trade too large: would deplete AMM reserves');
  }

  const newPrice = getPrice(newYesReserve, newNoReserve);
  const pricePerShare = amount / sharesOut;
  if (!Number.isFinite(sharesOut) || sharesOut <= 0 || !Number.isFinite(pricePerShare)) {
    throw new Error('AMM buy calculation failed');
  }
  // P1-4 Fix: Unified price impact calculation with divide-by-zero protection
  const oldSidePrice = side === 'yes' ? oldPrice.yesPrice : oldPrice.noPrice;
  const newSidePrice = side === 'yes' ? newPrice.yesPrice : newPrice.noPrice;
  const priceImpact = oldSidePrice > 0
    ? Math.abs(newSidePrice - oldSidePrice) / oldSidePrice * 100
    : 0;

  return {
    sharesOut,
    pricePerShare,
    newYesPrice: newPrice.yesPrice,
    newNoPrice: newPrice.noPrice,
    newYesReserve,
    newNoReserve,
    priceImpact,
  };
}

/**
 * Calculate selling shares of a given side
 * When selling YES: put YES shares back into yesReserve, get USDT from noReserve
 * When selling NO: put NO shares back into noReserve, get USDT from yesReserve
 */
export function calculateSell(
  yesReserve: number,
  noReserve: number,
  side: 'yes' | 'no',
  shares: number
): SellResult {
  if (!Number.isFinite(yesReserve) || !Number.isFinite(noReserve) || yesReserve <= 0 || noReserve <= 0) {
    throw new Error('Invalid AMM reserves');
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error('Invalid sell shares');
  }

  let newYesReserve: number;
  let newNoReserve: number;
  let amountOut: number;

  if (side === 'yes') {
    // Selling YES: add shares to YES pool, pair-burn YES+NO to redeem USDT
    // Solve quadratic: amountOut = (b - sqrt(b^2 - 4c)) / 2
    const b = yesReserve + noReserve + shares;
    const c = shares * noReserve;
    amountOut = (b - Math.sqrt(b * b - 4 * c)) / 2;
    newYesReserve = yesReserve + shares - amountOut;
    newNoReserve = noReserve - amountOut;
  } else {
    // Selling NO: add shares to NO pool, pair-burn YES+NO to redeem USDT
    const b = yesReserve + noReserve + shares;
    const c = shares * yesReserve;
    amountOut = (b - Math.sqrt(b * b - 4 * c)) / 2;
    newNoReserve = noReserve + shares - amountOut;
    newYesReserve = yesReserve - amountOut;
  }

  // Bug D15 Fix: Guard against sell draining reserve below minimum.
  // P0-1 Fix: MIN_RESERVE increased from 0.001 to 1.0 (0.01% of initial 10000 liquidity)
  const MIN_RESERVE = 1.0;
  if (newYesReserve < MIN_RESERVE || newNoReserve < MIN_RESERVE) {
    throw new Error('Trade too large: would deplete AMM reserves');
  }

  const newPrice = getPrice(newYesReserve, newNoReserve);
  const pricePerShare = amountOut / shares;
  if (!Number.isFinite(amountOut) || amountOut <= 0 || !Number.isFinite(pricePerShare)) {
    throw new Error('AMM sell calculation failed');
  }

  return {
    amountOut,
    pricePerShare,
    newYesPrice: newPrice.yesPrice,
    newNoPrice: newPrice.noPrice,
    newYesReserve,
    newNoReserve,
  };
}
