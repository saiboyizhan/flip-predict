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
  const now = Math.floor(Date.now() / 1000);

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

  // Phase 2.5: Mark open limit orders as expired for resolved markets
  for (const resolved of resolvedMarkets) {
    try {
      await db.query(
        `UPDATE open_orders SET status = 'expired'
         WHERE market_id = $1 AND status = 'open'`,
        [resolved.marketId]
      );
    } catch (err: any) {
      console.error(`Failed to expire open orders for market ${resolved.marketId}:`, err.message);
    }
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

  // Update prices to 1/0 (CTF: winning side = 1, losing side = 0)
  const finalYesPrice = outcomeSide === 'yes' ? 1 : 0;
  const finalNoPrice = outcomeSide === 'yes' ? 0 : 1;

  await client.query(
    "UPDATE markets SET status = 'resolved', yes_price = $1, no_price = $2 WHERE id = $3",
    [finalYesPrice, finalNoPrice, market.id]
  );
  // Insert final price history record
  await client.query(
    'INSERT INTO price_history (market_id, yes_price, no_price, timestamp) VALUES ($1, $2, $3, NOW())',
    [market.id, finalYesPrice, finalNoPrice]
  );

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

/**
 * Settle market positions in DB after on-chain resolution.
 * v2 simplified: no open_orders, no balances, no copy_trade commissions.
 * Settlement is now on-chain (claimWinnings). This just updates DB state.
 */
export async function settleMarketPositions(client: any, marketId: string, winningSide: string): Promise<void> {
  if (winningSide !== 'yes' && winningSide !== 'no' && !winningSide.startsWith('option_')) {
    throw new Error(`Invalid winning side: ${winningSide}`);
  }

  const now = Date.now();

  await client.query("UPDATE markets SET status = 'settling' WHERE id = $1", [marketId]);

  // LP Settlement: record LP position cleanup
  const lpRes = await client.query(
    'SELECT * FROM lp_positions WHERE market_id = $1 FOR UPDATE',
    [marketId]
  );

  if (lpRes.rows.length > 0) {
    for (const lp of lpRes.rows) {
      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
        VALUES ($1, $2, 'lp_settle', $3, $4, $5, $6)
      `, [
        randomUUID(), marketId, lp.user_address, Number(lp.deposit_amount),
        JSON.stringify({ lp_shares: Number(lp.lp_shares), deposit: Number(lp.deposit_amount), winning_side: winningSide }),
        now
      ]);
    }
    await client.query('DELETE FROM lp_positions WHERE market_id = $1', [marketId]);
    await client.query('UPDATE markets SET total_lp_shares = 0 WHERE id = $1', [marketId]);
  }

  // Log position settlement (positions tracked by event-listener)
  const posRes = await client.query('SELECT * FROM positions WHERE market_id = $1 FOR UPDATE', [marketId]);
  const positions = posRes.rows;

  for (const pos of positions) {
    const isWinner = pos.side === winningSide;
    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      randomUUID(), marketId, isWinner ? 'settle_winner' : 'settle_loser',
      pos.user_address, Number(pos.shares),
      JSON.stringify({ shares: pos.shares, side: pos.side, outcome: isWinner ? 'won' : 'lost' }),
      now
    ]);
  }

  // Clean up positions and reserves
  await client.query('DELETE FROM positions WHERE market_id = $1', [marketId]);
  await client.query('UPDATE markets SET yes_reserve = 0, no_reserve = 0 WHERE id = $1', [marketId]);
  await client.query("UPDATE markets SET status = 'settled' WHERE id = $1", [marketId]);
}

export function startKeeper(db: Pool, intervalMs: number = 30000): NodeJS.Timeout {
  console.info(`Keeper started (${intervalMs / 1000}s interval)`);
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await checkAndResolveMarkets(db);
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
