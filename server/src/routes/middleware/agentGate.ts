import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getDb } from '../../db';

/**
 * Middleware: require the user to have at least one agent (NFA) before trading.
 * Returns 403 with { error: 'AGENT_REQUIRED' } if the user has no agents.
 */
export async function requireAgent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const userAddress = req.userAddress;
  if (!userAddress) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const db = getDb();
    const result = await db.query(
      'SELECT COUNT(*) as count FROM agents WHERE owner_address = $1',
      [userAddress]
    );
    const count = Number(result.rows[0]?.count) || 0;

    if (count === 0) {
      res.status(403).json({ error: 'AGENT_REQUIRED' });
      return;
    }

    next();
  } catch (err) {
    console.error('Agent gate check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
