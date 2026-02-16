import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { initDatabase } from './db';
import { seedMarkets, seedAgents, seedComments } from './db/seed';
import { setupWebSocket } from './ws';
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

async function main() {
  // Initialize database
  const pool = await initDatabase();
  await seedMarkets(pool);
  await seedAgents(pool);
  await seedComments(pool);

  // Create Express app
  const app = express();

  // Trust proxy (Railway, Cloudflare, etc.)
  app.set('trust proxy', 1);

  // Middleware
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (health checks, curl, server-to-server)
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
  app.use('/api/comments', commentsRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/rewards', rewardRoutes);
  app.use('/api/fees', feeRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/achievements', achievementRoutes);
  app.use('/api/social', publicReadLimiter, socialRoutes);
  app.use('/api/profile', publicReadLimiter, profileRoutes);
  app.use('/api/copy-trading', copyTradingRoutes);

  app.use('/api/favorites', favoritesRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Testnet faucet: credit platform balance (testnet only)
  app.post('/api/faucet', async (req, res) => {
    try {
      const { address, amount } = req.body;
      if (!address || typeof address !== 'string') {
        res.status(400).json({ error: 'address required' });
        return;
      }
      const credit = Number(amount) || 10000;
      await pool.query(
        `INSERT INTO balances (user_address, available, locked)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $2`,
        [address.toLowerCase(), credit]
      );
      const bal = await pool.query('SELECT available, locked FROM balances WHERE user_address = $1', [address.toLowerCase()]);
      res.json({ success: true, balance: bal.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Admin: sync on-chain NFA to backend DB (testnet helper)
  app.post('/api/agents/admin-sync', async (req, res) => {
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
  process.exit(1);
});

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
