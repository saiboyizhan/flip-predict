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
  if (!Number.isFinite(yesReserve) || !Number.isFinite(noReserve) || yesReserve <= 0 || noReserve <= 0) {
    throw new Error('Invalid AMM reserves');
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
 * When buying YES: user puts BNB into the NO reserve, gets YES shares out
 * When buying NO: user puts BNB into the YES reserve, gets NO shares out
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
    // Buying YES: add amount to noReserve, remove shares from yesReserve
    newNoReserve = noReserve + amount;
    newYesReserve = k / newNoReserve;
    sharesOut = yesReserve - newYesReserve;
  } else {
    // Buying NO: add amount to yesReserve, remove shares from noReserve
    newYesReserve = yesReserve + amount;
    newNoReserve = k / newYesReserve;
    sharesOut = noReserve - newNoReserve;
  }

  // Bug D1 Fix: Guard against reserve depletion causing extreme values.
  // After a buy, the output reserve must stay above a minimum floor to prevent
  // floating-point overflow in subsequent k/reserve calculations.
  const MIN_RESERVE = 0.001;
  if (newYesReserve < MIN_RESERVE || newNoReserve < MIN_RESERVE) {
    throw new Error('Trade too large: would deplete AMM reserves');
  }

  const newPrice = getPrice(newYesReserve, newNoReserve);
  const pricePerShare = amount / sharesOut;
  if (!Number.isFinite(sharesOut) || sharesOut <= 0 || !Number.isFinite(pricePerShare)) {
    throw new Error('AMM buy calculation failed');
  }
  const oldSidePrice = side === 'yes' ? oldPrice.yesPrice : oldPrice.noPrice;
  const newSidePrice = side === 'yes' ? newPrice.yesPrice : newPrice.noPrice;
  const priceImpact = Math.abs(newSidePrice - oldSidePrice) / oldSidePrice;

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
 * When selling YES: put YES shares back into yesReserve, get BNB from noReserve
 * When selling NO: put NO shares back into noReserve, get BNB from yesReserve
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

  const k = yesReserve * noReserve;

  let newYesReserve: number;
  let newNoReserve: number;
  let amountOut: number;

  if (side === 'yes') {
    // Selling YES: add shares to yesReserve, remove BNB from noReserve
    newYesReserve = yesReserve + shares;
    newNoReserve = k / newYesReserve;
    amountOut = noReserve - newNoReserve;
  } else {
    // Selling NO: add shares to noReserve, remove BNB from yesReserve
    newNoReserve = noReserve + shares;
    newYesReserve = k / newNoReserve;
    amountOut = yesReserve - newYesReserve;
  }

  // Bug D15 Fix: Guard against sell draining reserve below minimum.
  const MIN_RESERVE = 0.001;
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
