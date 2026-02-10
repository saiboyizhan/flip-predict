const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempts = 0
let intentionalClose = false

const MAX_RECONNECT_ATTEMPTS = 10
const HEARTBEAT_INTERVAL = 30000 // 30 seconds
const BASE_RECONNECT_DELAY = 1000 // 1 second
const MAX_RECONNECT_DELAY = 30000 // 30 seconds

const callbacks: Map<string, Set<(data: unknown) => void>> = new Map()

function getReconnectDelay(): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  )
  return delay
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function handleMessage(event: MessageEvent) {
  try {
    const data = JSON.parse(event.data)

    // Handle pong responses (heartbeat acknowledgment)
    if (data.type === 'pong') {
      return
    }

    if (data.type === 'price_update' || data.type === 'new_trade') {
      const fns = callbacks.get(data.marketId)
      if (fns) {
        fns.forEach((fn) => fn(data))
      }
    }
  } catch {
    // ignore malformed messages
  }
}

export function connectWS(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  intentionalClose = false
  ws = new WebSocket(WS_URL)

  ws.addEventListener('open', () => {
    console.log('[WS] Connected successfully')
    reconnectAttempts = 0

    // Start heartbeat
    startHeartbeat()

    // Re-subscribe to all active markets
    callbacks.forEach((_fns, marketId) => {
      ws?.send(JSON.stringify({ type: 'subscribe', marketId }))
    })

    // Re-subscribe to all orderbook channels
    orderbookCallbacks.forEach((_fns, key) => {
      const [marketId, side] = key.split(':')
      ws?.send(JSON.stringify({ type: 'subscribe_orderbook', marketId, side }))
    })

    // Re-attach orderbook listener for new ws instance
    if (orderbookCallbacks.size > 0) {
      orderbookListenerAttached = false
      ensureOrderbookListener()
    }
  })

  ws.addEventListener('message', handleMessage)

  ws.addEventListener('close', () => {
    ws = null
    stopHeartbeat()
    orderbookListenerAttached = false

    // Don't reconnect if intentionally closed
    if (intentionalClose) {
      return
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[WS] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`)
      return
    }

    const delay = getReconnectDelay()
    reconnectAttempts++
    console.log(`[WS] Connection lost. Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)

    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      connectWS()
    }, delay)
  })

  ws.addEventListener('error', () => {
    // close will fire after error, triggering reconnect
    ws?.close()
  })
}

export function disconnectWS(): void {
  intentionalClose = true
  stopHeartbeat()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  if (ws) {
    ws.close()
    ws = null
  }
}

export function subscribeMarket(
  marketId: string,
  callback: (data: unknown) => void,
): void {
  if (!callbacks.has(marketId)) {
    callbacks.set(marketId, new Set())
  }
  callbacks.get(marketId)!.add(callback)

  // Send subscribe message if connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', marketId }))
  }
}

export function unsubscribeMarket(marketId: string): void {
  callbacks.delete(marketId)
}

// --- Orderbook WebSocket ---

const orderbookCallbacks: Map<string, Set<(data: unknown) => void>> = new Map()

function handleOrderbookMessage(event: MessageEvent) {
  try {
    const data = JSON.parse(event.data)
    if (data.type === 'orderbook_update') {
      const key = `${data.marketId}:${data.side}`
      const fns = orderbookCallbacks.get(key)
      if (fns) {
        fns.forEach((fn) => fn(data))
      }
    }
  } catch {
    // ignore malformed messages
  }
}

let orderbookListenerAttached = false

function ensureOrderbookListener() {
  if (orderbookListenerAttached) return
  if (ws) {
    ws.addEventListener('message', handleOrderbookMessage)
    orderbookListenerAttached = true
  }
}

export function subscribeOrderBook(
  marketId: string,
  side: string,
  callback: (data: unknown) => void,
): void {
  const key = `${marketId}:${side}`
  if (!orderbookCallbacks.has(key)) {
    orderbookCallbacks.set(key, new Set())
  }
  orderbookCallbacks.get(key)!.add(callback)

  connectWS()
  ensureOrderbookListener()

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe_orderbook', marketId, side }))
  }
}

export function unsubscribeOrderBook(marketId: string, side: string): void {
  const key = `${marketId}:${side}`
  orderbookCallbacks.delete(key)
}
