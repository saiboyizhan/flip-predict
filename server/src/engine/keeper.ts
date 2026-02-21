import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getOraclePrice, SUPPORTED_PAIRS } from './oracle';
import { fetchTokenPrice } from './dexscreener';
import { broadcastMarketResolved } from '../ws';
import { resolvePredictions } from './agent-prediction';

/**
 * Check if an oracle_pair value is a BSC token address (0x...) rather than
 * a traditional pair like "BTC/USD". Token addresses are resolved via DexScreener.
 */
function isTokenAddress(pair: string): boolean {
  return pair.startsWith('0x') && pair.length === 42;
}

export async function checkAndResolveMarkets(db: Pool): Promise<void> {
  const now = Date.now();

  // Track resolved markets for post-commit actions (WS broadcast & prediction resolution)
  const resolvedMarkets: Array<{ marketId: string; outcome: string; resolvedPrice: number }> = [];

  // Phase 1: Identify expired markets that need oracle resolution and pre-fetch prices
  // outside the transaction to avoid holding DB locks during external RPC calls (Bug 4 fix).
  const candidateRes = await db.query(
    `SELECT m.id, mr.oracle_pair, mr.resolution_type, mr.target_price
     FROM markets m
     LEFT JOIN market_resolution mr ON m.id = mr.market_id
     WHERE m.status = 'active' AND m.end_time <= $1`,
    [now]
  );

  const oraclePriceCache = new Map<string, { price: number; updatedAt: number }>();
  for (const row of candidateRes.rows) {
    if (!row.oracle_pair || oraclePriceCache.has(row.oracle_pair)) continue;

    try {
      if (SUPPORTED_PAIRS.includes(row.oracle_pair)) {
        // Traditional on-chain oracle (BTC/USD, BNB/USD, ETH/USD)
        const priceData = await getOraclePrice(row.oracle_pair);
        oraclePriceCache.set(row.oracle_pair, priceData);
      } else if (isTokenAddress(row.oracle_pair)) {
        // BSC token address — resolve via DexScreener
        const dexData = await fetchTokenPrice(row.oracle_pair);
        oraclePriceCache.set(row.oracle_pair, {
          price: dexData.price,
          updatedAt: Math.floor(dexData.fetchedAt / 1000),
        });
      }
    } catch (err: any) {
      console.error(`Failed to fetch price for ${row.oracle_pair}:`, err.message);
    }
  }

  // Phase 2: Use a transaction with FOR UPDATE SKIP LOCKED to prevent race conditions
  // when multiple keeper instances run concurrently
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Atomically select and lock expired markets, skipping any already locked by another keeper
    const expiredRes = await client.query(
      `SELECT m.*, mr.resolution_type, mr.oracle_pair, mr.target_price
       FROM markets m
       LEFT JOIN market_resolution mr ON m.id = mr.market_id
       WHERE m.status = 'active' AND m.end_time <= $1
       FOR UPDATE OF m SKIP LOCKED`,
      [now]
    );
    const expiredMarkets = expiredRes.rows;

    for (const market of expiredMarkets) {
      // Skip multi-option markets -- keeper only handles binary markets
      if (market.market_type === 'multi') {
        await client.query("UPDATE markets SET status = 'pending_resolution' WHERE id = $1", [market.id]);
        console.info(`Market ${market.id} skipped by keeper (multi-option), marked as pending_resolution`);
        continue;
      }

      await client.query('SAVEPOINT market_resolution_sp');
      try {
        const canResolve = market.resolution_type && market.oracle_pair &&
          (SUPPORTED_PAIRS.includes(market.oracle_pair) || isTokenAddress(market.oracle_pair));

        if (canResolve) {
          const priceData = oraclePriceCache.get(market.oracle_pair);
          if (!priceData) {
            // Oracle fetch failed -- fall back to manual resolution instead of leaving stuck in pending_resolution
            console.error(`No cached price for ${market.oracle_pair}, falling back to manual for market ${market.id}`);
            await client.query("UPDATE markets SET status = 'pending_resolution' WHERE id = $1", [market.id]);
            console.info(`Market ${market.id} marked as pending_resolution (oracle unavailable, needs manual resolution)`);
          } else {
            const result = await resolveByOracleInTx(client, market, priceData);
            if (result) {
              resolvedMarkets.push(result);
            }
          }
        } else {
          await client.query("UPDATE markets SET status = 'pending_resolution' WHERE id = $1", [market.id]);
          console.info(`Market ${market.id} marked as pending_resolution (manual)`);
        }
        await client.query('RELEASE SAVEPOINT market_resolution_sp');
      } catch (err: any) {
        await client.query('ROLLBACK TO SAVEPOINT market_resolution_sp');
        await client.query('RELEASE SAVEPOINT market_resolution_sp');
        console.error(`Failed to resolve market ${market.id}:`, err.message);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Phase 3: Post-commit actions — broadcast WS events and resolve agent predictions
  for (const resolved of resolvedMarkets) {
    try {
      broadcastMarketResolved(resolved.marketId, resolved.outcome, resolved.resolvedPrice);
    } catch (err: any) {
      console.error(`Failed to broadcast market_resolved for ${resolved.marketId}:`, err.message);
    }
    try {
      await resolvePredictions(db, resolved.marketId, resolved.outcome);
    } catch (err: any) {
      console.error(`Failed to resolve predictions for ${resolved.marketId}:`, err.message);
    }
  }
}

/**
 * Resolve a market by oracle within an existing transaction.
 * The caller is responsible for BEGIN/COMMIT/ROLLBACK.
 * Price data is pre-fetched outside the transaction to avoid holding DB locks during RPC calls.
 * Returns resolution info for post-commit actions, or null if no resolution was made.
 */
async function resolveByOracleInTx(
  client: any,
  market: any,
  priceData: { price: number; updatedAt: number }
): Promise<{ marketId: string; outcome: string; resolvedPrice: number } | null> {
  // Keep oracle resolution semantics aligned with on-chain PredictionMarket:
  // price_above: YES if price >= target
  // price_below: YES if price <= target
  let outcome: boolean;
  if (market.resolution_type === 'price_above') {
    outcome = priceData.price >= Number(market.target_price);
  } else if (market.resolution_type === 'price_below') {
    outcome = priceData.price <= Number(market.target_price);
  } else {
    return null;
  }

  const outcomeSide = outcome ? 'yes' : 'no';
  const now = Date.now();

  await client.query("UPDATE markets SET status = 'resolved' WHERE id = $1", [market.id]);

  await client.query(`
    INSERT INTO market_resolution (id, market_id, outcome, resolved_price, resolved_at, resolved_by)
    VALUES (gen_random_uuid(), $4, $1, $2, $3, 'oracle')
    ON CONFLICT (market_id) DO UPDATE
    SET outcome = $1, resolved_price = $2, resolved_at = $3, resolved_by = 'oracle'
  `, [outcomeSide, priceData.price, now, market.id]);

  await settleMarketPositions(client, market.id, outcomeSide);

  await client.query(`
    INSERT INTO settlement_log (id, market_id, action, details, created_at)
    VALUES ($1, $2, 'resolve', $3, $4)
  `, [randomUUID(), market.id, JSON.stringify({
    oracle_pair: market.oracle_pair,
    price: priceData.price,
    target: market.target_price,
    outcome: outcomeSide
  }), now]);

  console.info(`Market ${market.id} resolved by oracle: ${market.oracle_pair} = $${priceData.price.toFixed(2)}, outcome = ${outcomeSide}`);

  return { marketId: market.id, outcome: outcomeSide, resolvedPrice: priceData.price };
}

export async function settleMarketPositions(client: any, marketId: string, winningSide: string): Promise<void> {
  if (winningSide !== 'yes' && winningSide !== 'no' && !winningSide.startsWith('option_')) {
    throw new Error(`Invalid winning side: ${winningSide}`);
  }

  const now = Date.now();

  // ============================================================
  // P0 Fix: Set market status to 'settling' BEFORE cancelling orders
  // to prevent new trades from being placed during settlement.
  // ============================================================
  await client.query("UPDATE markets SET status = 'settling' WHERE id = $1", [marketId]);

  // ============================================================
  // Bug C3 Fix: Cancel all open orders BEFORE settling positions.
  // Open buy orders have locked funds; open sell orders have
  // shares deducted from the user's position. Return them all.
  // ============================================================
  const openOrdersRes = await client.query(
    "SELECT * FROM open_orders WHERE market_id = $1 AND status IN ('open', 'partial') FOR UPDATE",
    [marketId]
  );
  const openOrders = openOrdersRes.rows;

  for (const order of openOrders) {
    const remainingAmount = order.amount - order.filled;
    if (remainingAmount <= 0) continue;

    let loggedAmount = remainingAmount;
    if (order.order_side === 'buy') {
      // P1-8 Fix: Buy order cancellation - return locked funds
      // Note: open_orders table only interacts with orderbook, not AMM.
      // Buy orders lock funds at placement (line ~121-124 in orderbook.ts) and unlock here at cancellation.
      const lockedAmount = remainingAmount * order.price;
      loggedAmount = lockedAmount;
      // Return locked funds to user's available balance
      await client.query(
        `INSERT INTO balances (user_address, available, locked)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_address) DO UPDATE SET
           available = balances.available + EXCLUDED.available,
           locked = GREATEST(balances.locked - EXCLUDED.available, 0)`,
        [order.user_address, lockedAmount]
      );
    } else if (order.order_side === 'sell') {
      // P1-8 Fix: Sell order cancellation - restore shares to position
      // Shares were deducted at placement (line ~214-220 in orderbook.ts) and restored here.
      // No double-restoration risk: each sell order reduces position once, cancellation restores once.
      const restoreCostBasis = Number(order.cost_basis ?? order.price) || 0;
      // Return shares back to user's position. The row might not exist anymore because
      // shares were reduced at order placement time and may have reached 0.
      await client.query(
        `INSERT INTO positions (id, user_address, market_id, side, shares, avg_cost, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_address, market_id, side)
         DO UPDATE SET
           avg_cost = CASE
             WHEN positions.shares + EXCLUDED.shares > 0
             THEN ((positions.shares * positions.avg_cost) + (EXCLUDED.shares * EXCLUDED.avg_cost))
                  / (positions.shares + EXCLUDED.shares)
             ELSE positions.avg_cost
           END,
           shares = positions.shares + EXCLUDED.shares`,
        [randomUUID(), order.user_address, marketId, order.side, remainingAmount, restoreCostBasis, now]
      );
    }

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'cancel_open_order', $3, $4, $5, $6)
    `, [
      randomUUID(), marketId, order.user_address, loggedAmount,
      JSON.stringify({ order_id: order.id, order_side: order.order_side, side: order.side, remaining_amount: remainingAmount }),
      now
    ]);
  }

  // Mark all open orders as cancelled
  await client.query(
    "UPDATE open_orders SET status = 'cancelled' WHERE market_id = $1 AND status IN ('open', 'partial')",
    [marketId]
  );

  // ============================================================
  // LP Settlement: settle LP positions BEFORE trader positions
  // ============================================================
  const lpRes = await client.query(
    'SELECT * FROM lp_positions WHERE market_id = $1 FOR UPDATE',
    [marketId]
  );
  const lpPositions = lpRes.rows;

  // Re-fetch market after order cancellation to get current reserves
  const marketAfterCancel = await client.query('SELECT * FROM markets WHERE id = $1', [marketId]);
  const mkt = marketAfterCancel.rows[0];
  const currentYesReserve = Number(mkt.yes_reserve);
  const currentNoReserve = Number(mkt.no_reserve);
  const virtualLpShares = Number(mkt.virtual_lp_shares) || 0;
  const totalLpShares = Number(mkt.total_lp_shares) || 0;

  if (lpPositions.length > 0 && totalLpShares > 0) {
    const allShares = virtualLpShares + totalLpShares;
    const poolValue = currentYesReserve + currentNoReserve;

    // Determine winning reserve (CTF model: losing side becomes 0)
    const winningReserve = winningSide === 'yes' ? currentYesReserve : currentNoReserve;

    // LP total payout: their fraction of the winning reserve
    const lpFraction = totalLpShares / allShares;
    const lpTotalPayout = lpFraction * winningReserve;

    // Distribute payout to each LP proportionally
    let totalLpPaid = 0;
    for (const lp of lpPositions) {
      const lpShares = Number(lp.lp_shares);
      const lpShareRatio = lpShares / totalLpShares;
      const payout = lpShareRatio * lpTotalPayout;

      if (!Number.isFinite(payout) || payout <= 0) continue;

      // Credit LP user
      await client.query(
        `INSERT INTO balances (user_address, available, locked) VALUES ($1, $2, 0)
         ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $2`,
        [lp.user_address, payout]
      );

      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
        VALUES ($1, $2, 'lp_settle', $3, $4, $5, $6)
      `, [
        randomUUID(), marketId, lp.user_address, payout,
        JSON.stringify({ lp_shares: lpShares, deposit: Number(lp.deposit_amount), payout, winning_side: winningSide }),
        now
      ]);

      totalLpPaid += payout;
    }

    // Deduct LP payout from winning reserve
    if (winningSide === 'yes') {
      await client.query(
        'UPDATE markets SET yes_reserve = GREATEST(yes_reserve - $1, 0) WHERE id = $2',
        [totalLpPaid, marketId]
      );
    } else {
      await client.query(
        'UPDATE markets SET no_reserve = GREATEST(no_reserve - $1, 0) WHERE id = $2',
        [totalLpPaid, marketId]
      );
    }

    // Clean up LP positions and reset LP shares
    await client.query('DELETE FROM lp_positions WHERE market_id = $1', [marketId]);
    await client.query('UPDATE markets SET total_lp_shares = 0 WHERE id = $1', [marketId]);
  }

  // ============================================================
  // Settle positions
  // ============================================================
  // Bug D3 Fix: Lock position rows to prevent concurrent trades from modifying
  // them while settlement is in progress. Without FOR UPDATE, a trade could insert
  // or update a position row between our SELECT and the final DELETE.
  const posRes = await client.query('SELECT * FROM positions WHERE market_id = $1 FOR UPDATE', [marketId]);
  const positions = posRes.rows;

  if (positions.length === 0) {
    // Even with no positions, zero out AMM reserves (Bug C4)
    // AMM reserves are consumed during settlement to fund winner payouts
    await client.query(
      'UPDATE markets SET yes_reserve = 0, no_reserve = 0 WHERE id = $1',
      [marketId]
    );
    return;
  }

  const winners = positions.filter((p: any) => p.side === winningSide);
  const losers = positions.filter((p: any) => p.side !== winningSide);

  const totalWinnerShares = winners.reduce((sum: number, p: any) => sum + Number(p.shares), 0);

  if (totalWinnerShares === 0) {
    // No winners but there are positions - still zero out reserves and clean positions
    await client.query(
      'UPDATE markets SET yes_reserve = 0, no_reserve = 0 WHERE id = $1',
      [marketId]
    );
    // Log losers
    for (const loser of losers) {
      const lost = Number(loser.shares) * Number(loser.avg_cost);
      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
        VALUES ($1, $2, 'settle_loser', $3, $4, $5, $6)
      `, [
        randomUUID(), marketId, loser.user_address, lost,
        JSON.stringify({ shares: loser.shares, lost, side: loser.side }),
        now
      ]);
    }
    // Bug H2 Fix: Clean up all positions for this market
    await client.query('DELETE FROM positions WHERE market_id = $1', [marketId]);
    return;
  }

  // Pre-fetch copy trade relationships for this market to calculate revenue sharing.
  // Maps follower_address -> { agent_id, revenue_share_pct, copy_trade_id, cost }
  const copyTradeMap = new Map<string, { agent_id: string; revenue_share_pct: number; copy_trade_id: string; cost: number }>();
  const ctRes = await client.query(
    `SELECT ct.id, ct.follower_address, ct.agent_id, ct.amount as cost, ct.shares,
            COALESCE(af.revenue_share_pct, 10) as revenue_share_pct
     FROM copy_trades ct
     JOIN agent_followers af ON af.agent_id = ct.agent_id AND af.follower_address = ct.follower_address
     WHERE ct.market_id = $1 AND ct.side = $2 AND ct.status = 'open'`,
    [marketId, winningSide]
  );
  for (const row of ctRes.rows) {
    copyTradeMap.set(row.follower_address, {
      agent_id: row.agent_id,
      revenue_share_pct: Number(row.revenue_share_pct),
      copy_trade_id: row.id,
      cost: Number(row.cost),
    });
  }

  // CTF settlement: 1 winning share = 1 USDT (not pari-mutuel proportional split).
  // In CPMM + CTF model, winning shares redeem 1:1 against the collateral pool.

  // Step 1: Credit ALL winners their full shares (no commission deducted here).
  for (const winner of winners) {
    const reward = Number(winner.shares);

    // P1-7 Fix: Validate reward is finite and non-negative before crediting
    if (!Number.isFinite(reward) || reward < 0) {
      console.error(`Invalid reward: ${reward} for ${winner.user_address} in market ${marketId}`);
      continue;
    }

    // Full payout first -- commission is deducted separately from copy_trades only.
    await client.query(
      `INSERT INTO balances (user_address, available, locked) VALUES ($2, $1, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $1`,
      [reward, winner.user_address]
    );

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'settle_winner', $3, $4, $5, $6)
    `, [
      randomUUID(), marketId, winner.user_address, reward,
      JSON.stringify({ shares: Number(winner.shares), reward, payout: reward, side: winningSide }),
      now
    ]);
  }

  // Step 2: Separately calculate commission from copy_trades only.
  // Use copy_trades.shares (not positions.shares) so manual trades are never taxed.
  for (const ct of ctRes.rows) {
    const copyShares = Number(ct.shares || 0);
    const copyCost = Number(ct.cost || 0);
    const copyProfit = copyShares - copyCost;
    const revSharePct = Number(ct.revenue_share_pct || 10);
    const followerAddr = ct.follower_address;
    const copyInfo = copyTradeMap.get(followerAddr);
    if (!copyInfo) continue;

    if (copyProfit > 0) {
      let commission = Math.round(copyProfit * (revSharePct / 100) * 100) / 100;
      // P1 Fix: Minimum commission threshold -- don't insert 0-value records
      if (commission > 0 && commission < 0.01) commission = 0.01;
      if (commission <= 0) continue;

      // Deduct commission from follower's balance (already credited in Step 1)
      // Use GREATEST to prevent CHECK constraint violation if available < commission
      await client.query(
        `UPDATE balances SET available = GREATEST(available - $1, 0) WHERE user_address = $2`,
        [commission, followerAddr]
      );

      // Record in agent_earnings (creator claims later via /claim)
      await client.query(`
        INSERT INTO agent_earnings (id, agent_id, source, amount, follower_address, claimed, created_at)
        VALUES ($1, $2, 'copy_trade_commission', $3, $4, 0, $5)
      `, [randomUUID(), copyInfo.agent_id, commission, followerAddr, now]);

      // Update copy_trades record
      await client.query(
        `UPDATE copy_trades SET status = 'settled', outcome = 'won', profit = $1, revenue_share = $2 WHERE id = $3`,
        [copyProfit, commission, copyInfo.copy_trade_id]
      );

      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
        VALUES ($1, $2, 'revenue_share', $3, $4, $5, $6)
      `, [
        randomUUID(), marketId, followerAddr, commission,
        JSON.stringify({ agent_id: copyInfo.agent_id, profit: copyProfit, pct: revSharePct, commission }),
        now
    ]);
    } else {
      // No profit (or loss) -- no commission, but still settle the copy trade record
      await client.query(
        `UPDATE copy_trades SET status = 'settled', outcome = 'won', profit = $1, revenue_share = 0 WHERE id = $2`,
        [copyProfit, copyInfo.copy_trade_id]
      );
    }
  }

  // Settle losing copy trades
  for (const loser of losers) {
    const loserCopy = await client.query(
      `SELECT id FROM copy_trades WHERE market_id = $1 AND follower_address = $2 AND side = $3 AND status = 'open'`,
      [marketId, loser.user_address, loser.side]
    );
    for (const ct of loserCopy.rows) {
      await client.query(
        `UPDATE copy_trades SET status = 'settled', outcome = 'lost', profit = 0, revenue_share = 0 WHERE id = $1`,
        [ct.id]
      );
    }
  }

  for (const loser of losers) {
    const lost = Number(loser.shares) * Number(loser.avg_cost);
    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'settle_loser', $3, $4, $5, $6)
    `, [
      randomUUID(), marketId, loser.user_address, lost,
      JSON.stringify({ shares: loser.shares, lost, side: loser.side }),
      now
    ]);
  }

  // Bug C4 Fix: AMM reserves are consumed during settlement to fund winner payouts.
  // The total money deposited into the AMM pool is represented by yes_reserve + no_reserve.
  // After settlement, these reserves have been fully distributed to winners, so zero them out.
  await client.query(
    'UPDATE markets SET yes_reserve = 0, no_reserve = 0 WHERE id = $1',
    [marketId]
  );

  // Bug H2 Fix: Clean up all positions for this settled market.
  // Prevents stale portfolio data and eliminates any future double-claim vectors.
  await client.query('DELETE FROM positions WHERE market_id = $1', [marketId]);
}

export function startKeeper(db: Pool, intervalMs: number = 30000): NodeJS.Timeout {
  console.info(`Keeper started (${intervalMs / 1000}s interval)`);
  let isRunning = false;

  // Lazy import to avoid circular dependency
  let _processWithdrawals: (() => Promise<any>) | null = null;
  async function getProcessWithdrawals() {
    if (!_processWithdrawals) {
      const mod = await import('../routes/wallet');
      _processWithdrawals = mod.processWithdrawals;
    }
    return _processWithdrawals;
  }

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await checkAndResolveMarkets(db);
      // Process pending withdrawals each cycle
      try {
        const proc = await getProcessWithdrawals();
        await proc();
      } catch (wErr: any) {
        console.error('Withdrawal processor error:', wErr.message);
      }
    } catch (err) {
      console.error('Keeper error:', err);
    } finally {
      isRunning = false;
    }
  };

  void run();
  return setInterval(() => {
    void run();
  }, intervalMs);
}
