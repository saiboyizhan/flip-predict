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
import { startSwarmVerifier } from './engine/swarm-verifier';
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
import swarmRoutes from './routes/swarm';

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

async function main() {
  // Initialize database
  const pool = await initDatabase();
  await seedMarkets(pool);
  await seedAgents(pool);
  await seedComments(pool);

  // Create Express app
  const app = express();

  // JWT secret check - refuse to start with insecure secret
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === 'prediction-market-dev-secret') {
    console.error('FATAL: JWT_SECRET is not set or uses the default value. Set a secure JWT_SECRET in .env');
    process.exit(1);
  }

  // Middleware
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(generalLimiter);

  // Routes
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/markets', marketCreationRoutes);
  app.use('/api/markets', marketsRoutes);
  app.use('/api/orders', tradingLimiter, tradingRoutes);
  app.use('/api', portfolioRoutes);
  app.use('/api/orderbook', orderbookRoutes);
  app.use('/api/settlement', settlementRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/rewards', rewardRoutes);
  app.use('/api/fees', feeRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/achievements', achievementRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/copy-trading', copyTradingRoutes);
  app.use('/api/swarm', swarmRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
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
    const swarmVerifierInterval = startSwarmVerifier(pool, 300000);

    // Graceful shutdown handler
    const shutdown = () => {
      console.log('Shutting down gracefully...');
      clearInterval(keeperInterval);
      clearInterval(autoTraderInterval);
      clearInterval(swarmVerifierInterval);
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
