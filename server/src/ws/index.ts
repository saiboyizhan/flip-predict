import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { JWT_SECRET } from '../config';

interface Client {
  ws: WebSocket;
  subscribedMarkets: Set<string>;
  subscribedOrderBooks: Set<string>;
  userAddress?: string;
  lastPing?: number; // Track last ping timestamp for heartbeat timeout
}

const clients: Client[] = [];

// Rate limiting: max 100 messages per 60 seconds per client
const messageRates = new Map<WebSocket, { count: number; resetTime: number }>();

// Heartbeat timeout: disconnect clients that haven't pinged in 90 seconds
const HEARTBEAT_TIMEOUT = 90000;

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  // Periodic cleanup: remove dead connections and kick idle clients
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (let i = clients.length - 1; i >= 0; i--) {
      const client = clients[i];
      // Remove connections that are not OPEN
      if (client.ws.readyState !== WebSocket.OPEN) {
        clients.splice(i, 1);
        messageRates.delete(client.ws);
        continue;
      }
      // Kick clients that haven't sent a ping in HEARTBEAT_TIMEOUT
      if (client.lastPing && now - client.lastPing > HEARTBEAT_TIMEOUT) {
        console.log('[WS] Kicking idle client (no heartbeat)');
        client.ws.close(1000, 'Heartbeat timeout');
        clients.splice(i, 1);
        messageRates.delete(client.ws);
      }
    }
  }, 30000); // Run every 30 seconds

  wss.on('connection', (ws: WebSocket) => {
    const client: Client = { ws, subscribedMarkets: new Set(), subscribedOrderBooks: new Set(), lastPing: Date.now() };
    clients.push(client);

    ws.on('message', (data: Buffer) => {
      try {
        // Rate limiting check
        const now = Date.now();
        let rate = messageRates.get(ws);
        if (!rate || now > rate.resetTime) {
          rate = { count: 0, resetTime: now + 60000 };
          messageRates.set(ws, rate);
        }
        rate.count++;
        if (rate.count > 100) {
          ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
          return;
        }

        const msg = JSON.parse(data.toString());

        // Handle heartbeat ping from frontend
        if (msg.type === 'ping') {
          client.lastPing = Date.now(); // Update last ping timestamp
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'subscribe' && typeof msg.marketId === 'string' && msg.marketId.length <= 100) {
          if (client.subscribedMarkets.size >= 50) {
            ws.send(JSON.stringify({ type: 'error', message: 'Too many subscriptions' }));
          } else {
            client.subscribedMarkets.add(msg.marketId);
            ws.send(JSON.stringify({ type: 'subscribed', marketId: msg.marketId }));
          }
        }

        if (msg.type === 'unsubscribe' && typeof msg.marketId === 'string') {
          client.subscribedMarkets.delete(msg.marketId);
          ws.send(JSON.stringify({ type: 'unsubscribed', marketId: msg.marketId }));
        }

        if (msg.type === 'subscribe_orderbook' && typeof msg.marketId === 'string' && msg.marketId.length <= 100 && (msg.side === 'yes' || msg.side === 'no')) {
          if (client.subscribedOrderBooks.size >= 50) {
            ws.send(JSON.stringify({ type: 'error', message: 'Too many orderbook subscriptions' }));
          } else {
            const key = `${msg.marketId}:${msg.side}`;
            client.subscribedOrderBooks.add(key);
            ws.send(JSON.stringify({ type: 'subscribed_orderbook', marketId: msg.marketId, side: msg.side }));
          }
        }

        if (msg.type === 'unsubscribe_orderbook' && typeof msg.marketId === 'string' && (msg.side === 'yes' || msg.side === 'no')) {
          const key = `${msg.marketId}:${msg.side}`;
          client.subscribedOrderBooks.delete(key);
          ws.send(JSON.stringify({ type: 'unsubscribed_orderbook', marketId: msg.marketId, side: msg.side }));
        }

        // Subscribe to user notifications — requires valid JWT token
        if (msg.type === 'auth' && msg.token) {
          try {
            const decoded = jwt.verify(msg.token, JWT_SECRET) as { address?: unknown };
            if (typeof decoded.address !== 'string' || !ethers.isAddress(decoded.address)) {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token payload' }));
              return;
            }
            client.userAddress = decoded.address.toLowerCase();
            ws.send(JSON.stringify({ type: 'authed', address: client.userAddress }));
          } catch {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid or expired token' }));
          }
        }
      } catch {
        // ignore invalid messages
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', (err as Error).message);
    });

    ws.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
      messageRates.delete(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to prediction market WS' }));
  });

  return wss;
}

export function broadcastMultiPriceUpdate(marketId: string, prices: { optionId: string; price: number }[]): void {
  const msg = JSON.stringify({
    type: 'multi_price_update',
    marketId,
    prices,
    timestamp: Date.now(),
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscribedMarkets.has(marketId)) {
      try { client.ws.send(msg); } catch { /* ignore individual send failure */ }
    }
  }
}

export function broadcastPriceUpdate(marketId: string, yesPrice: number, noPrice: number): void {
  const msg = JSON.stringify({
    type: 'price_update',
    marketId,
    yesPrice,
    noPrice,
    timestamp: Date.now(),
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscribedMarkets.has(marketId)) {
      try { client.ws.send(msg); } catch { /* ignore individual send failure */ }
    }
  }
}

export function broadcastNewTrade(trade: {
  orderId: string;
  marketId: string;
  userAddress: string;
  side: string;
  type: string;
  amount: number;
  shares: number;
  price: number;
  timestamp: number;
}): void {
  const msg = JSON.stringify({
    ...trade,
    tradeType: trade.type,  // 保留原始 buy/sell
    type: 'new_trade',
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscribedMarkets.has(trade.marketId)) {
      try { client.ws.send(msg); } catch { /* ignore individual send failure */ }
    }
  }
}

export function broadcastMarketResolved(marketId: string, outcome: string, resolvedPrice?: number): void {
  const msg = JSON.stringify({
    type: 'market_resolved',
    marketId,
    outcome,
    resolvedPrice,
    timestamp: Date.now(),
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscribedMarkets.has(marketId)) {
      try { client.ws.send(msg); } catch { /* ignore individual send failure */ }
    }
  }
}

export function broadcastOrderBookUpdate(marketId: string, side: string, orderbook: any): void {
  const key = `${marketId}:${side}`;
  const msg = JSON.stringify({
    type: 'orderbook_update',
    marketId,
    side,
    ...orderbook,
    timestamp: Date.now(),
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscribedOrderBooks.has(key)) {
      try { client.ws.send(msg); } catch { /* ignore individual send failure */ }
    }
  }
}

// Push notification to a specific user via WebSocket
export function broadcastNotification(userAddress: string, notification: any): void {
  const msg = JSON.stringify({
    type: 'notification',
    notification,
  });

  const targetAddress = userAddress.toLowerCase();
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.userAddress === targetAddress) {
      try { client.ws.send(msg); } catch { /* ignore individual send failure */ }
    }
  }
}
