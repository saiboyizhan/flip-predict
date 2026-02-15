import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export async function processRevenueShare(
  db: Pool,
  copyTradeId: string,
  profit: number
): Promise<void> {
  if (profit <= 0) return;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Read copy_trade record
    const copyTrade = (await client.query(
      'SELECT * FROM copy_trades WHERE id = $1',
      [copyTradeId]
    )).rows[0];

    if (!copyTrade) {
      await client.query('ROLLBACK');
      return;
    }

    // Read agent_followers to get revenue_share_pct
    const followerRecord = (await client.query(
      "SELECT * FROM agent_followers WHERE agent_id = $1 AND follower_address = $2 AND status = 'active'",
      [copyTrade.agent_id, copyTrade.follower_address]
    )).rows[0];

    if (!followerRecord) {
      await client.query('ROLLBACK');
      return;
    }

    const revenueSharePct = Number(followerRecord.revenue_share_pct) || 10;
    const share = Math.round((profit * (revenueSharePct / 100)) * 100) / 100;

    if (share < 0.01) {
      await client.query('ROLLBACK');
      return;
    }

    // Read agent owner
    const agent = (await client.query(
      'SELECT owner_address FROM agents WHERE id = $1',
      [copyTrade.agent_id]
    )).rows[0];

    if (!agent) {
      await client.query('ROLLBACK');
      return;
    }

    // Credit share to agent owner's balance
    await client.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address)
      DO UPDATE SET available = balances.available + $2
    `, [agent.owner_address, share]);

    // Insert agent_earnings record
    await client.query(`
      INSERT INTO agent_earnings (id, agent_id, source, amount, follower_address, claimed, created_at)
      VALUES ($1, $2, 'copy_trading', $3, $4, 0, $5)
    `, [
      randomUUID(),
      copyTrade.agent_id,
      share,
      copyTrade.follower_address,
      Date.now()
    ]);

    // Update copy_trade revenue_share
    await client.query(
      'UPDATE copy_trades SET revenue_share = $1 WHERE id = $2',
      [share, copyTradeId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Revenue share failed for copy trade ${copyTradeId}:`, (err as Error).message);
  } finally {
    client.release();
  }
}
