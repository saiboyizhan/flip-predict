import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import crypto from 'crypto';

const router = Router();

// GET /api/fees/:address — user fee records
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = '50', offset = '0', type } = req.query;
    const db = getDb();

    let sql = 'SELECT f.*, m.title as market_title FROM fee_records f LEFT JOIN markets m ON f.market_id = m.id WHERE f.user_address = $1';
    const params: any[] = [address];
    let paramIndex = 2;

    if (type) {
      sql += ` AND f.type = $${paramIndex++}`;
      params.push(type);
    }

    sql += ` ORDER BY f.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(Math.min(parseInt(limit as string) || 50, 200));
    params.push(parseInt(offset as string) || 0);

    const { rows: fees } = await db.query(sql, params);

    // Aggregate totals
    const totalResult = await db.query(`
      SELECT
        COALESCE(SUM(amount), 0) as total_fees,
        COALESCE(SUM(CASE WHEN type = 'trade_fee' THEN amount ELSE 0 END), 0) as trade_fees,
        COALESCE(SUM(CASE WHEN type = 'creation_fee' THEN amount ELSE 0 END), 0) as creation_fees,
        COALESCE(SUM(CASE WHEN type = 'mint_fee' THEN amount ELSE 0 END), 0) as mint_fees
      FROM fee_records
      WHERE user_address = $1
    `, [address]);

    res.json({
      fees,
      summary: {
        totalFees: parseFloat(totalResult.rows[0].total_fees) || 0,
        tradeFees: parseFloat(totalResult.rows[0].trade_fees) || 0,
        creationFees: parseFloat(totalResult.rows[0].creation_fees) || 0,
        mintFees: parseFloat(totalResult.rows[0].mint_fees) || 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: record a fee
export async function recordFee(params: {
  userAddress: string;
  marketId?: string;
  type: string;
  amount: number;
}): Promise<any> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  const { rows } = await db.query(`
    INSERT INTO fee_records (id, user_address, market_id, type, amount, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, params.userAddress, params.marketId || null, params.type, params.amount, now]);

  return rows[0];
}

export default router;
