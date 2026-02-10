import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { calculateBuy, calculateSell } from './amm';

export interface OrderResult {
  orderId: string;
  shares: number;
  price: number;
  newYesPrice: number;
  newNoPrice: number;
}

export interface SellOrderResult {
  orderId: string;
  amountOut: number;
  price: number;
  newYesPrice: number;
  newNoPrice: number;
}

export async function executeBuy(
  db: Pool,
  userAddress: string,
  marketId: string,
  side: 'yes' | 'no',
  amount: number
): Promise<OrderResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be a positive finite number');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');

    // Check balance
    const balanceRes = await client.query('SELECT * FROM balances WHERE user_address = $1 FOR UPDATE', [userAddress]);
    const balance = balanceRes.rows[0];
    if (!balance || balance.available < amount) throw new Error('Insufficient balance');

    // Calculate trade via AMM
    const result = calculateBuy(market.yes_reserve, market.no_reserve, side, amount);

    const orderId = randomUUID();
    const now = Date.now();

    // Deduct balance
    await client.query('UPDATE balances SET available = available - $1 WHERE user_address = $2', [amount, userAddress]);

    // Update market reserves and prices
    await client.query(`
      UPDATE markets
      SET yes_reserve = $1, no_reserve = $2, yes_price = $3, no_price = $4, volume = volume + $5
      WHERE id = $6
    `, [result.newYesReserve, result.newNoReserve, result.newYesPrice, result.newNoPrice, amount, marketId]);

    // Record price history
    await client.query(
      `INSERT INTO price_history (market_id, yes_price, no_price, volume) VALUES ($1, $2, $3, $4)`,
      [marketId, result.newYesPrice, result.newNoPrice, amount]
    );

    // Create order record
    await client.query(`
      INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
      VALUES ($1, $2, $3, $4, 'buy', $5, $6, $7, 'filled', $8)
    `, [orderId, userAddress, marketId, side, amount, result.sharesOut, result.pricePerShare, now]);

    // Atomic upsert avoids concurrent lost updates on positions.
    await client.query(`
      INSERT INTO positions (id, user_address, market_id, side, shares, avg_cost, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_address, market_id, side)
      DO UPDATE SET
        avg_cost = CASE
          WHEN positions.shares + EXCLUDED.shares > 0
          THEN ((positions.shares * positions.avg_cost) + (EXCLUDED.shares * EXCLUDED.avg_cost))
               / (positions.shares + EXCLUDED.shares)
          ELSE positions.avg_cost
        END,
        shares = positions.shares + EXCLUDED.shares
    `, [randomUUID(), userAddress, marketId, side, result.sharesOut, result.pricePerShare, now]);

    await client.query('COMMIT');

    return {
      orderId,
      shares: result.sharesOut,
      price: result.pricePerShare,
      newYesPrice: result.newYesPrice,
      newNoPrice: result.newNoPrice,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function executeSell(
  db: Pool,
  userAddress: string,
  marketId: string,
  side: 'yes' | 'no',
  shares: number
): Promise<SellOrderResult> {
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error('Shares must be a positive finite number');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');

    // Check position
    const positionRes = await client.query(
      'SELECT * FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3 FOR UPDATE',
      [userAddress, marketId, side]
    );
    const position = positionRes.rows[0];
    if (!position || position.shares < shares) throw new Error('Insufficient shares');

    // Calculate trade via AMM
    const result = calculateSell(market.yes_reserve, market.no_reserve, side, shares);

    const orderId = randomUUID();
    const now = Date.now();

    // Credit balance (safe even if balance row is missing due to legacy data inconsistency)
    await client.query(
      `INSERT INTO balances (user_address, available, locked)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + EXCLUDED.available`,
      [userAddress, result.amountOut]
    );

    // Update market reserves and prices
    await client.query(`
      UPDATE markets
      SET yes_reserve = $1, no_reserve = $2, yes_price = $3, no_price = $4, volume = volume + $5
      WHERE id = $6
    `, [result.newYesReserve, result.newNoReserve, result.newYesPrice, result.newNoPrice, result.amountOut, marketId]);

    // Record price history
    await client.query(
      `INSERT INTO price_history (market_id, yes_price, no_price, volume) VALUES ($1, $2, $3, $4)`,
      [marketId, result.newYesPrice, result.newNoPrice, result.amountOut]
    );

    // Create order record
    await client.query(`
      INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
      VALUES ($1, $2, $3, $4, 'sell', $5, $6, $7, 'filled', $8)
    `, [orderId, userAddress, marketId, side, result.amountOut, shares, result.pricePerShare, now]);

    // Update position
    const newShares = position.shares - shares;
    if (newShares <= 0.0001) {
      await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
    } else {
      await client.query('UPDATE positions SET shares = $1 WHERE id = $2', [newShares, position.id]);
    }

    await client.query('COMMIT');

    return {
      orderId,
      amountOut: result.amountOut,
      price: result.pricePerShare,
      newYesPrice: result.newYesPrice,
      newNoPrice: result.newNoPrice,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
