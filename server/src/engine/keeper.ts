import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getOraclePrice, SUPPORTED_PAIRS } from './oracle';

export async function checkAndResolveMarkets(db: Pool): Promise<void> {
  const now = Date.now();

  // Use a transaction with FOR UPDATE SKIP LOCKED to prevent race conditions
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
      try {
        if (market.resolution_type && market.oracle_pair && SUPPORTED_PAIRS.includes(market.oracle_pair)) {
          await resolveByOracleInTx(client, market);
        } else {
          await client.query("UPDATE markets SET status = 'pending_resolution' WHERE id = $1", [market.id]);
          console.log(`Market ${market.id} marked as pending_resolution (manual)`);
        }
      } catch (err: any) {
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
}

/**
 * Resolve a market by oracle within an existing transaction.
 * The caller is responsible for BEGIN/COMMIT/ROLLBACK.
 */
async function resolveByOracleInTx(client: any, market: any): Promise<void> {
  const priceData = await getOraclePrice(market.oracle_pair);

  let outcome: boolean;
  if (market.resolution_type === 'price_above') {
    outcome = priceData.price >= market.target_price;
  } else if (market.resolution_type === 'price_below') {
    outcome = priceData.price <= market.target_price;
  } else {
    return;
  }

  const outcomeSide = outcome ? 'yes' : 'no';
  const now = Date.now();

  await client.query("UPDATE markets SET status = 'resolved' WHERE id = $1", [market.id]);

  await client.query(`
    UPDATE market_resolution
    SET outcome = $1, resolved_price = $2, resolved_at = $3, resolved_by = 'oracle'
    WHERE market_id = $4
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

  console.log(`Market ${market.id} resolved by oracle: ${market.oracle_pair} = $${priceData.price.toFixed(2)}, outcome = ${outcomeSide}`);
}

export async function settleMarketPositions(client: any, marketId: string, winningSide: string): Promise<void> {
  const posRes = await client.query('SELECT * FROM positions WHERE market_id = $1', [marketId]);
  const positions = posRes.rows;

  if (positions.length === 0) return;

  const winners = positions.filter((p: any) => p.side === winningSide);
  const losers = positions.filter((p: any) => p.side !== winningSide);

  const totalWinnerShares = winners.reduce((sum: number, p: any) => sum + p.shares, 0);
  const totalLoserValue = losers.reduce((sum: number, p: any) => sum + p.shares * p.avg_cost, 0);

  if (totalWinnerShares === 0) return;

  const now = Date.now();

  for (const winner of winners) {
    const principal = winner.shares * winner.avg_cost;
    const bonus = (winner.shares / totalWinnerShares) * totalLoserValue;
    const reward = principal + bonus;

    await client.query(
      'UPDATE balances SET available = available + $1 WHERE user_address = $2',
      [reward, winner.user_address]
    );

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'settle_winner', $3, $4, $5, $6)
    `, [
      randomUUID(), marketId, winner.user_address, reward,
      JSON.stringify({ shares: winner.shares, principal, bonus, side: winningSide }),
      now
    ]);
  }

  for (const loser of losers) {
    const lost = loser.shares * loser.avg_cost;
    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'settle_loser', $3, $4, $5, $6)
    `, [
      randomUUID(), marketId, loser.user_address, lost,
      JSON.stringify({ shares: loser.shares, lost, side: loser.side }),
      now
    ]);
  }
}

export function startKeeper(db: Pool, intervalMs: number = 30000): NodeJS.Timeout {
  console.log(`Keeper started (${intervalMs / 1000}s interval)`);

  checkAndResolveMarkets(db).catch(err => console.error('Keeper error:', err));

  return setInterval(() => {
    checkAndResolveMarkets(db).catch(err => console.error('Keeper error:', err));
  }, intervalMs);
}
