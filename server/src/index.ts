import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { initDatabase } from './db';
// Seed functions removed — testnet uses real data only
import { setupWebSocket, getWebSocketStatus } from './ws';
import authRoutes from './routes/auth';
import marketsRoutes from './routes/markets';
import tradingRoutes from './routes/trading';
import portfolioRoutes from './routes/portfolio';
import orderbookRoutes from './routes/orderbook';
import settlementRoutes from './routes/settlement';
import agentRoutes from './routes/agents';
import { startKeeper } from './engine/keeper';
import { startAutoTrader } from './engine/agent-autotrader';

import marketCreationRoutes from './routes/market-creation';
import leaderboardRoutes from './routes/leaderboard';
import commentsRoutes from './routes/comments';
import notificationRoutes from './routes/notifications';
import rewardRoutes from './routes/rewards';
import feeRoutes from './routes/fees';
import walletRoutes from './routes/wallet';
import achievementRoutes from './routes/achievements';
import socialRoutes from './routes/social';
import profileRoutes from './routes/profile';
import copyTradingRoutes from './routes/copy-trading';

import favoritesRoutes from './routes/favorites';
import { authMiddleware, AuthRequest } from './routes/middleware/auth';
import { adminMiddleware } from './routes/middleware/admin';
import { BSC_CHAIN_ID, BSC_NETWORK, logNetworkConfigSummary } from './config/network';

const PORT = parseInt(process.env.PORT || '3001', 10);

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later.' },
});

const tradingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many trading requests, please try again later.' },
});

const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const copyTradingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

async function main() {
  logNetworkConfigSummary();

  // Initialize database
  const pool = await initDatabase();

  // Create Express app
  const app = express();

  // Trust proxy (Railway, Cloudflare, etc.)
  app.set('trust proxy', 1);

  // Middleware
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';
  if (IS_PRODUCTION && !process.env.CORS_ORIGIN) {
    console.warn('WARNING: CORS_ORIGIN is not set in production. All browser requests will be blocked.');
  }
  app.use(cors({
    origin: function (origin, callback) {
      // In production, require an Origin header (block server-to-server / curl without origin)
      if (!origin && process.env.NODE_ENV === 'production') {
        return callback(new Error('Origin required'));
      }
      // Allow requests with no origin in development (health checks, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Check against allowed origins (comma-separated)
      const allowed = process.env.CORS_ORIGIN;
      if (allowed) {
        const origins = allowed.split(',').map(o => o.trim());
        if (origins.includes(origin)) return callback(null, true);
      }

      // Development: allow localhost
      if (!IS_PRODUCTION && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
  app.use(helmet());
  // Reject oversized request bodies early (before parsing)
  app.use((req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 1048576) { // 1MB = 1048576 bytes
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(generalLimiter);

  // Routes
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/markets', publicReadLimiter, marketCreationRoutes);
  app.use('/api/markets', publicReadLimiter, marketsRoutes);
  app.use('/api/orders', tradingLimiter, tradingRoutes);
  app.use('/api', portfolioRoutes);
  app.use('/api/orderbook', publicReadLimiter, orderbookRoutes);
  app.use('/api/settlement', publicReadLimiter, settlementRoutes);
  app.use('/api/agents', publicReadLimiter, agentRoutes);
  app.use('/api/leaderboard', publicReadLimiter, leaderboardRoutes);
  app.use('/api/comments', commentLimiter, commentsRoutes);
  app.use('/api/notifications', publicReadLimiter, notificationRoutes);
  app.use('/api/rewards', publicReadLimiter, rewardRoutes);
  app.use('/api/fees', feeRoutes);
  app.use('/api/wallet', walletLimiter, walletRoutes);
  app.use('/api/achievements', publicReadLimiter, achievementRoutes);
  app.use('/api/social', publicReadLimiter, socialRoutes);
  app.use('/api/profile', publicReadLimiter, profileRoutes);
  app.use('/api/copy-trading', copyTradingLimiter, copyTradingRoutes);

  app.use('/api/favorites', publicReadLimiter, favoritesRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      network: {
        bscNetwork: BSC_NETWORK,
        bscChainId: BSC_CHAIN_ID,
      },
      websocket: getWebSocketStatus(),
    });
  });

  // Testnet faucet: credit platform balance (testnet only)
  const faucetRateLimit = new Map<string, number>();
  // Cleanup stale faucet rate limit entries every hour to prevent memory leak
  const faucetCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of faucetRateLimit) {
      if (now - timestamp > 3600000) { // 1 hour
        faucetRateLimit.delete(key);
      }
    }
  }, 3600000); // Run every hour
  app.post('/api/faucet', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const address = req.userAddress!.toLowerCase();
      const { amount } = req.body;

      // Rate limit: one faucet request per address per 60 seconds
      const lastRequest = faucetRateLimit.get(address);
      if (lastRequest && Date.now() - lastRequest < 60000) {
        res.status(429).json({ error: 'Faucet rate limited. Try again in 1 minute.' });
        return;
      }

      const MAX_FAUCET = 10000;
      const credit = Math.min(Math.max(Number(amount) || 1000, 1), MAX_FAUCET);
      await pool.query(
        `INSERT INTO balances (user_address, available, locked)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $2`,
        [address, credit]
      );
      faucetRateLimit.set(address, Date.now());
      const bal = await pool.query('SELECT available, locked FROM balances WHERE user_address = $1', [address]);
      res.json({ success: true, balance: bal.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Admin: cleanup all seed/fake data
  app.post('/api/admin/cleanup-seed', async (req, res) => {
    try {
      // Verify admin via secret key (no wallet signature needed)
      const { secret } = req.body;
      const jwtSecret = process.env.JWT_SECRET || '';
      if (!secret || secret !== jwtSecret) { res.status(403).json({ error: 'Invalid secret' }); return; }

      const SEED_ADDRESSES = [
        '0x742d35cc6634c0532925a3b844bc9e7595f0beb8',
        '0x8f9e3d7a2b1c4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
        '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        '0x9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d',
        '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e',
        '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f',
        '0x6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
        '0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b',
      ];
      const SEED_AGENT_IDS = ['agent-001', 'agent-002', 'agent-003', 'agent-004', 'agent-005'];

      const client = await pool.connect();
      const results: Record<string, number> = {};
      try {
        await client.query('BEGIN');

        // 1. Delete seed comments (from fake addresses)
        const r1 = await client.query(
          'DELETE FROM comments WHERE LOWER(user_address) = ANY($1::text[])',
          [SEED_ADDRESSES]
        );
        results.comments = r1.rowCount ?? 0;

        // 2. Delete seed agent trades
        const r2 = await client.query(
          'DELETE FROM agent_trades WHERE agent_id = ANY($1::text[])',
          [SEED_AGENT_IDS]
        );
        results.agent_trades = r2.rowCount ?? 0;

        // 3. Delete seed agent style profiles
        const r3 = await client.query(
          'DELETE FROM agent_style_profile WHERE agent_id = ANY($1::text[])',
          [SEED_AGENT_IDS]
        );
        results.agent_style_profiles = r3.rowCount ?? 0;

        // 4. Delete seed agent predictions
        const r4 = await client.query(
          'DELETE FROM agent_predictions WHERE agent_id = ANY($1::text[])',
          [SEED_AGENT_IDS]
        );
        results.agent_predictions = r4.rowCount ?? 0;

        // 5. Delete seed agent followers
        try {
          const r5a = await client.query(
            'DELETE FROM agent_followers WHERE agent_id = ANY($1::text[])',
            [SEED_AGENT_IDS]
          );
          results.agent_followers = r5a.rowCount ?? 0;
        } catch { results.agent_followers = 0; }

        // 6. Delete seed agents
        const r5 = await client.query(
          'DELETE FROM agents WHERE id = ANY($1::text[])',
          [SEED_AGENT_IDS]
        );
        results.agents = r5.rowCount ?? 0;

        // 7. Delete ALL seed price history (generated before any real trades)
        //    Keep only price history generated by actual trades (those have matching orders)
        const r6 = await client.query(
          `DELETE FROM price_history WHERE id IN (
             SELECT ph.id FROM price_history ph
             LEFT JOIN orders o ON o.market_id = ph.market_id
               AND o.created_at BETWEEN (EXTRACT(EPOCH FROM ph.timestamp) * 1000 - 60000)
               AND (EXTRACT(EPOCH FROM ph.timestamp) * 1000 + 60000)
             WHERE o.id IS NULL
           )`
        );
        results.price_history = r6.rowCount ?? 0;

        // 8. Reset market volumes to match actual order totals
        await client.query(`
          UPDATE markets SET volume = COALESCE(
            (SELECT SUM(amount) FROM orders WHERE orders.market_id = markets.id AND type = 'buy'),
            0
          )
        `);
        results.volume_reset = 1;

        // participants is computed in API layer, not a DB column

        await client.query('COMMIT');
        console.info('Seed data cleanup completed.');
        res.json({ success: true, deleted: results });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error('Cleanup error:', err);
      res.status(500).json({ error: err.message || 'Cleanup failed' });
    }
  });

  // Admin: sync on-chain NFA to backend DB (testnet helper)
  app.post('/api/agents/admin-sync', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { address, tokenId, name, avatar, mintTxHash } = req.body;
      if (!address || typeof address !== 'string') {
        res.status(400).json({ error: 'address required' });
        return;
      }
      const tid = Number(tokenId);
      if (!Number.isFinite(tid) || tid < 0) {
        res.status(400).json({ error: 'valid tokenId required' });
        return;
      }
      const agentName = name || `Agent #${tid}`;
      const agentAvatar = avatar || '/avatars/default.png';
      const id = 'agent-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      const now = Date.now();
      // Upsert: skip if tokenId already exists
      const existing = await pool.query('SELECT id FROM agents WHERE token_id = $1 LIMIT 1', [tid]);
      if (existing.rows.length > 0) {
        const agent = (await pool.query('SELECT * FROM agents WHERE token_id = $1', [tid])).rows[0];
        res.json({ agent, synced: false, message: 'already exists' });
        return;
      }
      await pool.query(`
        INSERT INTO agents (id, name, owner_address, strategy, description, persona, avatar, token_id, mint_tx_hash, wallet_balance, level, experience, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1000, 1, 0, $10)
      `, [id, agentName, address.toLowerCase(), 'random', '', '', agentAvatar, tid, mintTxHash || null, now]);
      const agent = (await pool.query('SELECT * FROM agents WHERE id = $1', [id])).rows[0];
      res.json({ agent, synced: true });
    } catch (err: any) {
      console.error('Agent admin-sync error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket
  setupWebSocket(server);

  // Start server
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket available on ws://localhost:${PORT}`);
    const keeperInterval = startKeeper(pool, 30000);
    const autoTraderInterval = startAutoTrader(pool, 60000);



    // Graceful shutdown handler
    const shutdown = () => {
      console.log('Shutting down gracefully...');
      clearInterval(keeperInterval);
      clearInterval(autoTraderInterval);
      clearInterval(faucetCleanupInterval);


      server.close(() => {
        pool.end().then(() => {
          console.log('Server shut down.');
          process.exit(0);
        }).catch(() => {
          process.exit(1);
        });
      });
      // Force exit after 10 seconds if graceful shutdown stalls
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}

// Global handlers for uncaught errors to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Attempt graceful shutdown before exiting
  try {
    // The shutdown function is scoped inside main's server.listen callback,
    // so we emit SIGTERM to trigger it if it's been registered
    process.emit('SIGTERM', 'SIGTERM');
  } catch { /* ignore */ }
  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error('Forced exit after uncaught exception');
    process.exit(1);
  }, 5000).unref();
});

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
