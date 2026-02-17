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
  remoteAddress?: string; // Track client IP for rate limiting
}

const clients: Client[] = [];

// Rate limiting: max 100 messages per 60 seconds per client (keyed by IP or address)
const messageRates = new Map<string, { count: number; resetTime: number }>();

function getRateLimitKey(client: Client): string {
  // Prefer wallet address, then remote IP, then fallback to a unique id
  if (client.userAddress) return client.userAddress;
  if (client.remoteAddress) return client.remoteAddress;
  return 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// Heartbeat timeout: disconnect clients that haven't pinged in 90 seconds
const HEARTBEAT_TIMEOUT = 90000;

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  // Periodic cleanup: remove dead connections and kick idle clients
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (let i = clients.length - 1; i >= 0; i--) {
      const client = clients[i];
      const rateLimitKey = getRateLimitKey(client);
      // Remove connections in CLOSING or CLOSED state (not just non-OPEN)
      if (client.ws.readyState === WebSocket.CLOSING || client.ws.readyState === WebSocket.CLOSED) {
        clients.splice(i, 1);
        messageRates.delete(rateLimitKey);
        continue;
      }
      // Remove connections that are not OPEN
      if (client.ws.readyState !== WebSocket.OPEN) {
        clients.splice(i, 1);
        messageRates.delete(rateLimitKey);
        continue;
      }
      // Kick clients that haven't sent a ping in HEARTBEAT_TIMEOUT
      if (client.lastPing && now - client.lastPing > HEARTBEAT_TIMEOUT) {
        console.log('[WS] Kicking idle client (no heartbeat)');
        client.ws.close(1000, 'Heartbeat timeout');
        clients.splice(i, 1);
        messageRates.delete(rateLimitKey);
      }
    }
    // Cleanup stale rate limit entries (resetTime in the past)
    for (const [key, rate] of messageRates) {
      if (now > rate.resetTime) {
        messageRates.delete(key);
      }
    }
  }, 30000); // Run every 30 seconds

  wss.on('close', () => {
    clearInterval(cleanupInterval);
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const remoteAddress = req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : req.socket?.remoteAddress || undefined;
    const client: Client = { ws, subscribedMarkets: new Set(), subscribedOrderBooks: new Set(), lastPing: Date.now(), remoteAddress };
    clients.push(client);

    ws.on('message', (data: Buffer) => {
      try {
        // Rate limiting check (keyed by IP/address, not ws instance)
        const now = Date.now();
        const rateLimitKey = getRateLimitKey(client);
        let rate = messageRates.get(rateLimitKey);
        if (!rate || now > rate.resetTime) {
          rate = { count: 0, resetTime: now + 60000 };
          messageRates.set(rateLimitKey, rate);
        }
        rate.count++;
        if (rate.count > 100) {
          ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
          return;
        }

        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch (parseErr) {
          console.warn('[WS] Invalid JSON received:', parseErr instanceof Error ? parseErr.message : 'unknown error');
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
          return;
        }

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
      messageRates.delete(getRateLimitKey(client));
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

// Get WebSocket connection status for health checks
export function getWebSocketStatus(): { connectedClients: number; authenticatedClients: number } {
  let authenticated = 0;
  for (const client of clients) {
    if (client.userAddress) authenticated++;
  }
  return {
    connectedClients: clients.length,
    authenticatedClients: authenticated,
  };
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
