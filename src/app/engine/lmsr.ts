/**
 * Frontend LMSR (Logarithmic Market Scoring Rule) Engine
 * Used for trade preview calculations without DB access.
 *
 * Cost(q) = b * ln(Σ exp(q_i / b))
 * Price_i = exp(q_i / b) / Σ exp(q_j / b)
 */

export interface LMSRPool {
  reserves: number[];
  b: number;
}

export interface LMSRBuyPreview {
  sharesOut: number;
  avgPrice: number;
  priceImpact: number;
  newPrices: number[];
  error?: string;
}

export interface LMSRSellPreview {
  amountOut: number;
  avgPrice: number;
  priceImpact: number;
  newPrices: number[];
  error?: string;
}

function logSumExp(values: number[]): number {
  const max = Math.max(...values);
  let sum = 0;
  for (const v of values) {
    sum += Math.exp(v - max);
  }
  return max + Math.log(sum);
}

function lmsrCost(reserves: number[], b: number): number {
  const scaled = reserves.map(r => r / b);
  return b * logSumExp(scaled);
}

export function getLMSRPrices(reserves: number[], b: number): number[] {
  const scaled = reserves.map(r => r / b);
  const max = Math.max(...scaled);
  const exps = scaled.map(s => Math.exp(s - max));
  const sumExps = exps.reduce((a, v) => a + v, 0);
  return exps.map(e => e / sumExps);
}

export function createLMSRPool(numOptions: number, totalLiquidity: number): LMSRPool {
  const b = totalLiquidity / numOptions;
  const reserves = new Array(numOptions).fill(b);
  return { reserves, b };
}

export function calculateLMSRBuyPreview(
  reserves: number[],
  b: number,
  optionIndex: number,
  amount: number,
): LMSRBuyPreview {
  if (amount <= 0) {
    return { sharesOut: 0, avgPrice: 0, priceImpact: 0, newPrices: getLMSRPrices(reserves, b) };
  }

  const oldPrices = getLMSRPrices(reserves, b);
  const currentCost = lmsrCost(reserves, b);

  // Binary search for deltaShares
  let lo = 0;
  let hi = amount * 100;
  let mid = 0;

  for (let iter = 0; iter < 1000; iter++) {
    mid = (lo + hi) / 2;
    const newReserves = [...reserves];
    newReserves[optionIndex] += mid;
    const newCost = lmsrCost(newReserves, b);
    const costDiff = newCost - currentCost;

    if (Math.abs(costDiff - amount) < 1e-8) break;
    if (costDiff < amount) lo = mid;
    else hi = mid;
  }

  // Convergence validation: verify the binary search found an acceptable solution
  const checkReserves = [...reserves];
  checkReserves[optionIndex] += mid;
  const finalCostDiff = lmsrCost(checkReserves, b) - currentCost;
  if (Math.abs(finalCostDiff - amount) > 1e-4) {
    console.warn('LMSR buy preview: binary search did not converge', { amount, finalCostDiff });
    return { sharesOut: 0, avgPrice: 0, priceImpact: 0, newPrices: oldPrices, error: 'Binary search did not converge' };
  }

  const sharesOut = mid;
  const newReserves = [...reserves];
  newReserves[optionIndex] += sharesOut;
  const newPrices = getLMSRPrices(newReserves, b);

  const avgPrice = sharesOut > 0 ? amount / sharesOut : 0;
  const oldPrice = oldPrices[optionIndex] || 0;
  const priceImpact = oldPrice > 0 ? Math.abs(newPrices[optionIndex] - oldPrice) / oldPrice * 100 : 0;

  return { sharesOut, avgPrice, priceImpact, newPrices };
}

export function calculateLMSRSellPreview(
  reserves: number[],
  b: number,
  optionIndex: number,
  shares: number,
): LMSRSellPreview {
  if (shares <= 0) {
    return { amountOut: 0, avgPrice: 0, priceImpact: 0, newPrices: getLMSRPrices(reserves, b) };
  }

  const oldPrices = getLMSRPrices(reserves, b);
  const currentCost = lmsrCost(reserves, b);

  const newReserves = [...reserves];
  newReserves[optionIndex] -= shares;

  if (newReserves[optionIndex] < 1.0) {
    console.warn('LMSR sell preview: trade too large, would deplete reserves', { optionIndex, shares, reserve: reserves[optionIndex] });
    return { amountOut: 0, avgPrice: 0, priceImpact: 0, newPrices: oldPrices, error: 'Trade too large: would deplete reserves' };
  }

  const newCost = lmsrCost(newReserves, b);
  const amountOut = currentCost - newCost;
  const newPrices = getLMSRPrices(newReserves, b);

  const avgPrice = shares > 0 ? amountOut / shares : 0;
  const oldPrice = oldPrices[optionIndex] || 0;
  const priceImpact = oldPrice > 0 ? Math.abs(oldPrice - newPrices[optionIndex]) / oldPrice * 100 : 0;

  return { amountOut, avgPrice, priceImpact, newPrices };
}
