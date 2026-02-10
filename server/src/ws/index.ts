import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'prediction-market-dev-secret';

interface Client {
  ws: WebSocket;
  subscribedMarkets: Set<string>;
  subscribedOrderBooks: Set<string>;
  userAddress?: string;
}

const clients: Client[] = [];

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    const client: Client = { ws, subscribedMarkets: new Set(), subscribedOrderBooks: new Set() };
    clients.push(client);

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'subscribe' && msg.marketId) {
          client.subscribedMarkets.add(msg.marketId);
          ws.send(JSON.stringify({ type: 'subscribed', marketId: msg.marketId }));
        }

        if (msg.type === 'unsubscribe' && msg.marketId) {
          client.subscribedMarkets.delete(msg.marketId);
          ws.send(JSON.stringify({ type: 'unsubscribed', marketId: msg.marketId }));
        }

        if (msg.type === 'subscribe_orderbook' && msg.marketId && msg.side) {
          const key = `${msg.marketId}:${msg.side}`;
          client.subscribedOrderBooks.add(key);
          ws.send(JSON.stringify({ type: 'subscribed_orderbook', marketId: msg.marketId, side: msg.side }));
        }

        if (msg.type === 'unsubscribe_orderbook' && msg.marketId && msg.side) {
          const key = `${msg.marketId}:${msg.side}`;
          client.subscribedOrderBooks.delete(key);
          ws.send(JSON.stringify({ type: 'unsubscribed_orderbook', marketId: msg.marketId, side: msg.side }));
        }

        // Subscribe to user notifications — requires valid JWT token
        if (msg.type === 'auth' && msg.token) {
          try {
            const decoded = jwt.verify(msg.token, JWT_SECRET) as { address: string };
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

    ws.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to prediction market WS' }));
  });

  return wss;
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
      client.ws.send(msg);
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
    type: 'new_trade',
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.subscribedMarkets.has(trade.marketId)) {
      client.ws.send(msg);
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
      client.ws.send(msg);
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
      client.ws.send(msg);
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
      client.ws.send(msg);
    }
  }
}
