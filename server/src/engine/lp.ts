import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export interface AddLiquidityResult {
  lpShares: number;
  newYesReserve: number;
  newNoReserve: number;
  totalLpShares: number;
}

export interface RemoveLiquidityResult {
  usdtOut: number;
  sharesRemoved: number;
  newYesReserve: number;
  newNoReserve: number;
  totalLpShares: number;
}

export interface LpInfo {
  totalLpShares: number;
  virtualLpShares: number;
  poolValue: number;
  yesReserve: number;
  noReserve: number;
  userShares: number;
  userValue: number;
  shareOfPool: number;
  initialLiquidity: number;
  providers: Array<{
    address: string;
    shares: number;
    value: number;
    depositAmount: number;
    shareOfPool: number;
  }>;
}

export async function addLiquidity(
  db: Pool,
  userAddress: string,
  marketId: string,
  amount: number,
): Promise<AddLiquidityResult> {
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
    throw new Error('Amount must be between 1 and 1,000,000 USDT');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Lock market
    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');
    if (Number(market.end_time) <= Date.now()) throw new Error('Market has expired');
    if (market.market_type !== 'binary') throw new Error('LP only supported for binary markets');

    // Check balance
    const balanceRes = await client.query('SELECT * FROM balances WHERE user_address = $1 FOR UPDATE', [userAddress]);
    const balance = balanceRes.rows[0];
    if (!balance || Number(balance.available) < amount) throw new Error('Insufficient balance');

    const yesReserve = Number(market.yes_reserve);
    const noReserve = Number(market.no_reserve);
    const poolValue = yesReserve + noReserve;
    const virtualLpShares = Number(market.virtual_lp_shares) || 0;
    const totalLpShares = Number(market.total_lp_shares) || 0;
    const allShares = virtualLpShares + totalLpShares;

    // Calculate LP shares: proportional to pool value
    const newShares = allShares > 0 ? allShares * (amount / poolValue) : amount;

    // Add to reserves proportionally (maintains current price)
    const yesRatio = yesReserve / poolValue;
    const addYes = amount * yesRatio;
    const addNo = amount * (1 - yesRatio);

    // Deduct balance
    await client.query('UPDATE balances SET available = available - $1 WHERE user_address = $2', [amount, userAddress]);

    // Update market reserves
    const newYesReserve = yesReserve + addYes;
    const newNoReserve = noReserve + addNo;
    const newTotalLpShares = totalLpShares + newShares;
    await client.query(
      `UPDATE markets SET yes_reserve = $1, no_reserve = $2, total_lp_shares = $3 WHERE id = $4`,
      [newYesReserve, newNoReserve, newTotalLpShares, marketId],
    );

    // Upsert LP position
    const now = Date.now();
    await client.query(
      `INSERT INTO lp_positions (id, user_address, market_id, lp_shares, deposit_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_address, market_id) DO UPDATE SET
         lp_shares = lp_positions.lp_shares + EXCLUDED.lp_shares,
         deposit_amount = lp_positions.deposit_amount + EXCLUDED.deposit_amount`,
      [randomUUID(), userAddress, marketId, newShares, amount, now],
    );

    // Settlement log
    await client.query(
      `INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
       VALUES ($1, $2, 'lp_add', $3, $4, $5, $6)`,
      [randomUUID(), marketId, userAddress, amount, JSON.stringify({
        lp_shares: newShares,
        yes_added: addYes,
        no_added: addNo,
      }), now],
    );

    await client.query('COMMIT');

    return {
      lpShares: newShares,
      newYesReserve,
      newNoReserve,
      totalLpShares: newTotalLpShares,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeLiquidity(
  db: Pool,
  userAddress: string,
  marketId: string,
  sharesToBurn: number,
): Promise<RemoveLiquidityResult> {
  if (!Number.isFinite(sharesToBurn) || sharesToBurn <= 0) {
    throw new Error('Shares must be a positive number');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Lock market
    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');

    // Lock LP position
    const lpRes = await client.query(
      'SELECT * FROM lp_positions WHERE user_address = $1 AND market_id = $2 FOR UPDATE',
      [userAddress, marketId],
    );
    const lp = lpRes.rows[0];
    if (!lp || Number(lp.lp_shares) < sharesToBurn - 0.0001) throw new Error('Insufficient LP shares');

    const yesReserve = Number(market.yes_reserve);
    const noReserve = Number(market.no_reserve);
    const poolValue = yesReserve + noReserve;
    const virtualLpShares = Number(market.virtual_lp_shares) || 0;
    const totalLpShares = Number(market.total_lp_shares) || 0;
    const initialLiquidity = Number(market.initial_liquidity) || 500;
    const allShares = virtualLpShares + totalLpShares;

    // Calculate withdrawal amount
    const lpPoolFraction = sharesToBurn / allShares;
    const usdtOut = lpPoolFraction * poolValue;

    // Safety check: reserves must not drop below minimum
    const minReserve = Math.max(1.0, initialLiquidity / 2);
    const yesRatio = yesReserve / poolValue;
    const removeYes = usdtOut * yesRatio;
    const removeNo = usdtOut * (1 - yesRatio);
    if (yesReserve - removeYes < minReserve || noReserve - removeNo < minReserve) {
      throw new Error('Cannot remove: would reduce reserves below minimum');
    }

    // Update reserves
    const newYesReserve = yesReserve - removeYes;
    const newNoReserve = noReserve - removeNo;
    const newTotalLpShares = totalLpShares - sharesToBurn;
    await client.query(
      `UPDATE markets SET yes_reserve = $1, no_reserve = $2, total_lp_shares = $3 WHERE id = $4`,
      [newYesReserve, newNoReserve, Math.max(0, newTotalLpShares), marketId],
    );

    // Credit user balance
    await client.query(
      `INSERT INTO balances (user_address, available, locked) VALUES ($1, $2, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + EXCLUDED.available`,
      [userAddress, usdtOut],
    );

    // Update or delete LP position
    const now = Date.now();
    const remainingShares = Number(lp.lp_shares) - sharesToBurn;
    if (remainingShares <= 0.0001) {
      await client.query('DELETE FROM lp_positions WHERE id = $1', [lp.id]);
    } else {
      const remainingDeposit = Math.max(0, Number(lp.deposit_amount) - usdtOut);
      await client.query(
        'UPDATE lp_positions SET lp_shares = $1, deposit_amount = $2 WHERE id = $3',
        [remainingShares, remainingDeposit, lp.id],
      );
    }

    // Settlement log
    await client.query(
      `INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
       VALUES ($1, $2, 'lp_remove', $3, $4, $5, $6)`,
      [randomUUID(), marketId, userAddress, usdtOut, JSON.stringify({
        shares_burned: sharesToBurn,
        yes_removed: removeYes,
        no_removed: removeNo,
      }), now],
    );

    await client.query('COMMIT');

    return {
      usdtOut,
      sharesRemoved: sharesToBurn,
      newYesReserve,
      newNoReserve,
      totalLpShares: Math.max(0, newTotalLpShares),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getLpInfo(
  db: Pool,
  marketId: string,
  userAddress?: string,
): Promise<LpInfo> {
  const marketRes = await db.query('SELECT * FROM markets WHERE id = $1', [marketId]);
  const market = marketRes.rows[0];
  if (!market) throw new Error('Market not found');

  const yesReserve = Number(market.yes_reserve);
  const noReserve = Number(market.no_reserve);
  const poolValue = yesReserve + noReserve;
  const virtualLpShares = Number(market.virtual_lp_shares) || 0;
  const totalLpShares = Number(market.total_lp_shares) || 0;
  const initialLiquidity = Number(market.initial_liquidity) || 10000;
  const allShares = virtualLpShares + totalLpShares;

  // User LP info
  let userShares = 0;
  let userValue = 0;
  let shareOfPool = 0;
  if (userAddress) {
    const lpRes = await db.query(
      'SELECT * FROM lp_positions WHERE user_address = $1 AND market_id = $2',
      [userAddress, marketId],
    );
    if (lpRes.rows.length > 0) {
      userShares = Number(lpRes.rows[0].lp_shares);
      shareOfPool = allShares > 0 ? userShares / allShares : 0;
      userValue = shareOfPool * poolValue;
    }
  }

  // All providers
  const providersRes = await db.query(
    'SELECT * FROM lp_positions WHERE market_id = $1 ORDER BY lp_shares DESC',
    [marketId],
  );
  const providers = providersRes.rows.map((p: any) => {
    const shares = Number(p.lp_shares);
    const pShareOfPool = allShares > 0 ? shares / allShares : 0;
    return {
      address: p.user_address,
      shares,
      value: pShareOfPool * poolValue,
      depositAmount: Number(p.deposit_amount),
      shareOfPool: pShareOfPool,
    };
  });

  return {
    totalLpShares,
    virtualLpShares,
    poolValue,
    yesReserve,
    noReserve,
    userShares,
    userValue,
    shareOfPool,
    initialLiquidity,
    providers,
  };
}
