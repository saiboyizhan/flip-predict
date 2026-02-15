/**
 * Logarithmic Market Scoring Rule (LMSR) Engine
 *
 * Cost(q) = b * ln(Σ exp(q_i / b))
 * Price_i = exp(q_i / b) / Σ exp(q_j / b)
 * b = totalLiquidity / numOptions
 *
 * Uses log-sum-exp trick for numerical stability.
 */

export interface LMSRPool {
  reserves: number[];
  b: number;
}

export interface LMSRBuyResult {
  sharesOut: number;
  newReserves: number[];
  newPrices: number[];
}

export interface LMSRSellResult {
  amountOut: number;
  newReserves: number[];
  newPrices: number[];
}

/**
 * Create an LMSR pool with equal initial reserves for each option.
 */
export function createLMSRPool(numOptions: number, totalLiquidity: number): LMSRPool {
  if (numOptions < 2) throw new Error('LMSR requires at least 2 options');
  if (totalLiquidity <= 0) throw new Error('totalLiquidity must be positive');

  const b = totalLiquidity / numOptions;
  // Start with equal reserves so all prices are equal (1/numOptions)
  const reserves = new Array(numOptions).fill(b);

  return { reserves, b };
}

/**
 * Log-sum-exp trick: compute ln(Σ exp(x_i)) in a numerically stable way.
 */
function logSumExp(values: number[]): number {
  if (values.length === 0) return -Infinity;
  const max = Math.max(...values);
  if (!Number.isFinite(max)) return max;
  let sum = 0;
  for (const v of values) {
    sum += Math.exp(v - max);
  }
  return max + Math.log(sum);
}

/**
 * LMSR cost function: C(q) = b * ln(Σ exp(q_i / b))
 */
function lmsrCost(reserves: number[], b: number): number {
  const scaled = reserves.map(r => r / b);
  return b * logSumExp(scaled);
}

/**
 * Get prices for all options. Prices sum to ~1.
 * Price_i = exp(q_i / b) / Σ exp(q_j / b)
 */
export function getLMSRPrices(reserves: number[], b: number): number[] {
  const scaled = reserves.map(r => r / b);
  const max = Math.max(...scaled);
  const exps = scaled.map(s => Math.exp(s - max));
  const sumExps = exps.reduce((a, v) => a + v, 0);
  return exps.map(e => e / sumExps);
}

/**
 * Calculate buying shares of a specific option.
 * Uses binary search to find deltaShares such that:
 *   Cost(q + Δe_i) - Cost(q) = amount
 *
 * Where e_i is the unit vector for option i.
 */
export function calculateLMSRBuy(
  reserves: number[],
  b: number,
  optionIndex: number,
  amount: number,
): LMSRBuyResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid buy amount');
  }
  if (optionIndex < 0 || optionIndex >= reserves.length) {
    throw new Error('Invalid option index');
  }

  const currentCost = lmsrCost(reserves, b);

  // Binary search for deltaShares
  let lo = 0;
  let hi = amount * 100; // Upper bound: can't get more shares than amount * 100
  let mid = 0;

  for (let iter = 0; iter < 100; iter++) {
    mid = (lo + hi) / 2;
    const newReserves = [...reserves];
    newReserves[optionIndex] += mid;
    const newCost = lmsrCost(newReserves, b);
    const costDiff = newCost - currentCost;

    if (Math.abs(costDiff - amount) < 1e-8) {
      break;
    }

    if (costDiff < amount) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Convergence validation: verify the binary search found an acceptable solution
  const finalReservesCheck = [...reserves];
  finalReservesCheck[optionIndex] += mid;
  const finalCostDiff = lmsrCost(finalReservesCheck, b) - currentCost;
  if (Math.abs(finalCostDiff - amount) > 1e-4) {
    throw new Error('LMSR buy calculation failed: binary search did not converge');
  }

  const sharesOut = mid;
  const newReserves = [...reserves];
  newReserves[optionIndex] += sharesOut;
  const newPrices = getLMSRPrices(newReserves, b);

  if (!Number.isFinite(sharesOut) || sharesOut <= 0) {
    throw new Error('LMSR buy calculation failed');
  }

  return { sharesOut, newReserves, newPrices };
}

/**
 * Calculate selling shares of a specific option.
 * The user returns shares, and receives:
 *   amountOut = Cost(q) - Cost(q - Δe_i)
 */
export function calculateLMSRSell(
  reserves: number[],
  b: number,
  optionIndex: number,
  shares: number,
): LMSRSellResult {
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error('Invalid sell shares');
  }
  if (optionIndex < 0 || optionIndex >= reserves.length) {
    throw new Error('Invalid option index');
  }

  const currentCost = lmsrCost(reserves, b);
  const newReserves = [...reserves];
  newReserves[optionIndex] -= shares;

  // Ensure reserves don't go below a minimum
  if (newReserves[optionIndex] < 0.001) {
    throw new Error('Trade too large: would deplete reserves');
  }

  const newCost = lmsrCost(newReserves, b);
  const amountOut = currentCost - newCost;

  if (!Number.isFinite(amountOut) || amountOut <= 0) {
    throw new Error('LMSR sell calculation failed');
  }

  const newPrices = getLMSRPrices(newReserves, b);

  return { amountOut, newReserves, newPrices };
}
