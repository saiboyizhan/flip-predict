import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import crypto from 'crypto';
import { broadcastNotification } from '../ws';

const router = Router();

// GET /api/notifications — get current user's notifications
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { limit = '50', offset = '0' } = req.query;
    const rawLimit = Number.parseInt(String(limit), 10);
    const rawOffset = Number.parseInt(String(offset), 10);
    const parsedLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 200));
    const parsedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    const { rows: notifications } = await db.query(`
      SELECT * FROM notifications
      WHERE user_address = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.userAddress, parsedLimit, parsedOffset]);

    // Map is_read integer to boolean for API response
    const mapped = notifications.map((n: any) => ({
      ...n,
      is_read: !!n.is_read,
    }));

    res.json({ notifications: mapped });
  } catch (err: any) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notifications/unread-count — unread count
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const result = await db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_address = $1 AND is_read = 0',
      [req.userAddress]
    );
    res.json({ count: parseInt(result.rows[0].count) || 0 });
  } catch (err: any) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    await db.query(
      'UPDATE notifications SET is_read = 1 WHERE user_address = $1 AND is_read = 0',
      [req.userAddress]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/:id/read — mark single as read
router.put('/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const result = await db.query(
      'UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_address = $2 RETURNING *',
      [req.params.id, req.userAddress]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    const notification = { ...result.rows[0], is_read: !!result.rows[0].is_read };
    res.json({ success: true, notification });
  } catch (err: any) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notifications/activity — aggregated activity from settlement_log + orders
// Provides a unified feed even when the notifications table is empty
router.get('/activity', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { limit = '50', offset = '0' } = req.query;
    const rawLimit = Number.parseInt(String(limit), 10);
    const rawOffset = Number.parseInt(String(offset), 10);
    const parsedLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 200));
    const parsedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    // Union of orders and settlement_log for this user, ordered by time desc
    const { rows } = await db.query(`
      (
        SELECT
          o.id,
          'trade' as type,
          CASE
            WHEN o.type = 'buy' THEN 'Order Filled'
            ELSE 'Order Sold'
          END as title,
          'You ' || o.type || ' ' || ROUND(CAST(o.shares AS NUMERIC), 2) || ' ' || UPPER(o.side) || ' shares at $' || ROUND(CAST(o.price AS NUMERIC), 4) as message,
          o.created_at,
          0 as is_read
        FROM orders o
        WHERE o.user_address = $1
      )
      UNION ALL
      (
        SELECT
          s.id,
          'market' as type,
          CASE
            WHEN s.action = 'resolve' THEN 'Market Resolved'
            WHEN s.action = 'claim' THEN 'Winnings Claimed'
            WHEN s.action = 'refund' THEN 'Refund Issued'
            ELSE 'Settlement Update'
          END as title,
          CASE
            WHEN s.action = 'claim' THEN 'You claimed $' || ROUND(CAST(COALESCE(s.amount, 0) AS NUMERIC), 2) || ' in winnings'
            WHEN s.action = 'resolve' THEN 'A market you participated in has been resolved'
            WHEN s.action = 'refund' THEN 'You received a refund of $' || ROUND(CAST(COALESCE(s.amount, 0) AS NUMERIC), 2)
            ELSE 'Settlement action: ' || s.action
          END as message,
          s.created_at,
          0 as is_read
        FROM settlement_log s
        WHERE s.user_address = $1
      )
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.userAddress, parsedLimit, parsedOffset]);

    const notifications = rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      created_at: r.created_at,
      is_read: !!r.is_read,
    }));

    res.json({ notifications });
  } catch (err: any) {
    console.error('Activity feed error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: create notification and push via WebSocket
// Includes debouncing: skip if same type+user notification was created in last 5 seconds
export async function createNotification(params: {
  userAddress: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}): Promise<any> {
  const db = getDb();

  // Debounce: check if same type+user notification was created in last 5 seconds
  const fiveSecondsAgo = Date.now() - 5000;
  const recentDup = await db.query(
    'SELECT id FROM notifications WHERE user_address = $1 AND type = $2 AND created_at > $3 LIMIT 1',
    [params.userAddress, params.type, fiveSecondsAgo]
  );
  if (recentDup.rows.length > 0) {
    return recentDup.rows[0]; // Skip duplicate, return existing
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  const { rows } = await db.query(`
    INSERT INTO notifications (id, user_address, type, title, message, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [id, params.userAddress, params.type, params.title, params.message, JSON.stringify(params.metadata || {}), now]);

  const notification = rows[0];

  // Push via WebSocket
  broadcastNotification(params.userAddress, notification);

  return notification;
}

export default router;
