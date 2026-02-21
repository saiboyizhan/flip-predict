import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { calculateLMSRBuy, calculateLMSRSell, getLMSRPrices } from './lmsr';

const TRADE_FEE_RATE = 0.01;

export interface MultiBuyResult {
  orderId: string;
  shares: number;
  price: number;
  newPrices: { optionId: string; price: number }[];
}

export interface MultiSellResult {
  orderId: string;
  amountOut: number;
  price: number;
  newPrices: { optionId: string; price: number }[];
}

export async function executeBuyMulti(
  db: Pool,
  userAddress: string,
  marketId: string,
  optionId: string,
  amount: number,
): Promise<MultiBuyResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be a positive finite number');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Lock market
    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');
    if (market.market_type !== 'multi') throw new Error('Market is not multi-option');

    // Lock and fetch options
    const optionsRes = await client.query(
      'SELECT * FROM market_options WHERE market_id = $1 ORDER BY option_index ASC FOR UPDATE',
      [marketId],
    );
    const options = optionsRes.rows;
    if (options.length < 2) throw new Error('Invalid multi-option market');

    // Find the target option
    const targetOption = options.find((o: any) => o.id === optionId);
    if (!targetOption) throw new Error('Option not found');

    // Check balance
    const balanceRes = await client.query('SELECT * FROM balances WHERE user_address = $1 FOR UPDATE', [userAddress]);
    const balance = balanceRes.rows[0];
    if (!balance || Number(balance.available) < amount) throw new Error('Insufficient balance');

    // Prepare LMSR calculation
    const reserves = options.map((o: any) => Number(o.reserve));
    const b = Number(market.total_liquidity) / options.length;
    const optionIndex = Number(targetOption.option_index);

    // Trade fee: deduct before LMSR calculation
    const fee = Math.round(amount * TRADE_FEE_RATE * 10000) / 10000;
    const effectiveAmount = amount - fee;

    const result = calculateLMSRBuy(reserves, b, optionIndex, effectiveAmount);

    const orderId = randomUUID();
    const now = Date.now();
    const pricePerShare = effectiveAmount / result.sharesOut;

    // Deduct balance
    await client.query('UPDATE balances SET available = available - $1 WHERE user_address = $2', [amount, userAddress]);

    // Update market volume
    await client.query('UPDATE markets SET volume = volume + $1 WHERE id = $2', [amount, marketId]);

    // Update each option's reserve and price
    const newPrices: { optionId: string; price: number }[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      await client.query(
        'UPDATE market_options SET reserve = $1, price = $2 WHERE id = $3',
        [result.newReserves[i], result.newPrices[i], opt.id],
      );
      newPrices.push({ optionId: opt.id, price: result.newPrices[i] });

      // Record option price history
      await client.query(
        'INSERT INTO option_price_history (market_id, option_id, price, volume) VALUES ($1, $2, $3, $4)',
        [marketId, opt.id, result.newPrices[i], i === optionIndex ? amount : 0],
      );
    }

    // Create order record with option_id
    await client.query(`
      INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at, option_id)
      VALUES ($1, $2, $3, $4, 'buy', $5, $6, $7, 'filled', $8, $9)
    `, [orderId, userAddress, marketId, `option_${optionIndex}`, amount, result.sharesOut, pricePerShare, now, optionId]);

    // Upsert position with option_id
    await client.query(`
      INSERT INTO positions (id, user_address, market_id, side, shares, avg_cost, created_at, option_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_address, market_id, side)
      DO UPDATE SET
        avg_cost = CASE
          WHEN positions.shares + EXCLUDED.shares > 0
          THEN ((positions.shares * positions.avg_cost) + (EXCLUDED.shares * EXCLUDED.avg_cost))
               / (positions.shares + EXCLUDED.shares)
          ELSE positions.avg_cost
        END,
        shares = positions.shares + EXCLUDED.shares
    `, [randomUUID(), userAddress, marketId, `option_${optionIndex}`, result.sharesOut, pricePerShare, now, optionId]);

    // Record trade fee
    if (fee > 0) {
      await client.query(
        `INSERT INTO fee_records (id, user_address, market_id, type, amount, created_at)
         VALUES ($1, $2, $3, 'trade_fee', $4, $5)`,
        [randomUUID(), userAddress, marketId, fee, now]
      );
    }

    await client.query('COMMIT');

    return {
      orderId,
      shares: result.sharesOut,
      price: pricePerShare,
      newPrices,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function executeSellMulti(
  db: Pool,
  userAddress: string,
  marketId: string,
  optionId: string,
  shares: number,
): Promise<MultiSellResult> {
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error('Shares must be a positive finite number');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Lock market
    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');
    if (market.market_type !== 'multi') throw new Error('Market is not multi-option');

    // Lock and fetch options
    const optionsRes = await client.query(
      'SELECT * FROM market_options WHERE market_id = $1 ORDER BY option_index ASC FOR UPDATE',
      [marketId],
    );
    const options = optionsRes.rows;
    if (options.length < 2) throw new Error('Invalid multi-option market');

    const targetOption = options.find((o: any) => o.id === optionId);
    if (!targetOption) throw new Error('Option not found');
    const optionIndex = Number(targetOption.option_index);

    // Check position
    const positionRes = await client.query(
      'SELECT * FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3 FOR UPDATE',
      [userAddress, marketId, `option_${optionIndex}`],
    );
    const position = positionRes.rows[0];
    if (!position || Number(position.shares) < shares) throw new Error('Insufficient shares');

    // Prepare LMSR calculation
    const reserves = options.map((o: any) => Number(o.reserve));
    const b = Number(market.total_liquidity) / options.length;

    const result = calculateLMSRSell(reserves, b, optionIndex, shares);

    // Trade fee on sell proceeds
    const grossAmountOut = result.amountOut;
    const fee = Math.round(grossAmountOut * TRADE_FEE_RATE * 10000) / 10000;
    const netAmountOut = grossAmountOut - fee;

    const orderId = randomUUID();
    const now = Date.now();
    const pricePerShare = grossAmountOut / shares;

    // Credit balance with net amount (after fee)
    await client.query(
      `INSERT INTO balances (user_address, available, locked) VALUES ($1, $2, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + EXCLUDED.available`,
      [userAddress, netAmountOut],
    );

    // Update market volume
    await client.query('UPDATE markets SET volume = volume + $1 WHERE id = $2', [result.amountOut, marketId]);

    // Update each option's reserve and price
    const newPrices: { optionId: string; price: number }[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      await client.query(
        'UPDATE market_options SET reserve = $1, price = $2 WHERE id = $3',
        [result.newReserves[i], result.newPrices[i], opt.id],
      );
      newPrices.push({ optionId: opt.id, price: result.newPrices[i] });

      await client.query(
        'INSERT INTO option_price_history (market_id, option_id, price, volume) VALUES ($1, $2, $3, $4)',
        [marketId, opt.id, result.newPrices[i], i === optionIndex ? result.amountOut : 0],
      );
    }

    // Create order record
    await client.query(`
      INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at, option_id)
      VALUES ($1, $2, $3, $4, 'sell', $5, $6, $7, 'filled', $8, $9)
    `, [orderId, userAddress, marketId, `option_${optionIndex}`, result.amountOut, shares, pricePerShare, now, optionId]);

    // Update position
    const newShares = Number(position.shares) - shares;
    if (newShares <= 0.0001) {
      await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
    } else {
      await client.query('UPDATE positions SET shares = $1 WHERE id = $2', [newShares, position.id]);
    }

    // Record trade fee
    if (fee > 0) {
      await client.query(
        `INSERT INTO fee_records (id, user_address, market_id, type, amount, created_at)
         VALUES ($1, $2, $3, 'trade_fee', $4, $5)`,
        [randomUUID(), userAddress, marketId, fee, now]
      );
    }

    await client.query('COMMIT');

    return {
      orderId,
      amountOut: netAmountOut,
      price: pricePerShare,
      newPrices,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
