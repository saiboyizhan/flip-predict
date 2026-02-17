const WS_URL = import.meta.env.VITE_WS_URL || 'wss://flip-backend-production.up.railway.app'

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempts = 0
let intentionalClose = false
let connectionDead = false

let reconnectCallbacks: Set<() => void> = new Set()
const notificationCallbacks: Set<(notification: unknown) => void> = new Set()

// --- Connection status tracking ---
export type WSConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'dead'
let currentStatus: WSConnectionStatus = 'disconnected'
const statusCallbacks: Set<(status: WSConnectionStatus) => void> = new Set()

function setConnectionStatus(status: WSConnectionStatus): void {
  if (status === currentStatus) return
  currentStatus = status
  statusCallbacks.forEach(cb => cb(status))
}

export function getConnectionStatus(): WSConnectionStatus {
  return currentStatus
}

export function onConnectionStatusChange(cb: (status: WSConnectionStatus) => void): () => void {
  statusCallbacks.add(cb)
  // Immediately notify with current status
  cb(currentStatus)
  return () => { statusCallbacks.delete(cb) }
}

export function onReconnect(cb: () => void): () => void {
  reconnectCallbacks.add(cb)
  return () => { reconnectCallbacks.delete(cb) }
}

export function isConnectionDead(): boolean {
  return connectionDead
}

const MAX_RECONNECT_ATTEMPTS = 10
const HEARTBEAT_INTERVAL = 30000 // 30 seconds
const BASE_RECONNECT_DELAY = 1000 // 1 second
const MAX_RECONNECT_DELAY = 30000 // 30 seconds

const callbacks: Map<string, Set<(data: unknown) => void>> = new Map()
const globalCallbacks: Set<(data: any) => void> = new Set()

export function addGlobalListener(cb: (data: any) => void): void {
  globalCallbacks.add(cb)
}

export function removeGlobalListener(cb: (data: any) => void): void {
  globalCallbacks.delete(cb)
}

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

    // Basic type validation: data.type must be a string
    if (!data || typeof data.type !== 'string') return

    // For price_update, validate that price fields are numbers
    if (data.type === 'price_update') {
      if (typeof data.yesPrice !== 'number' || typeof data.noPrice !== 'number') return
    }

    // Handle pong responses (heartbeat acknowledgment)
    if (data.type === 'pong') {
      return
    }

    // Handle auth errors (expired/invalid token)
    if (data.type === 'auth_error') {
      console.warn('[WS] Auth error:', data.error)
      // Notify user before clearing session
      import('sonner').then(({ toast }) => {
        toast.error('Session expired. Please reconnect your wallet.')
      }).catch(() => {})
      localStorage.removeItem('jwt_token')
      // Trigger logout in auth store to sync state
      import('@/app/stores/useAuthStore').then(({ useAuthStore }) => {
        useAuthStore.getState().logout()
      }).catch(() => {})
      return
    }

    if (data.type === 'price_update' || data.type === 'new_trade' || data.type === 'market_resolved' || data.type === 'multi_price_update') {
      const fns = callbacks.get(data.marketId)
      if (fns) {
        fns.forEach((fn) => fn(data))
      }
    }

    // Sync price updates to MarketStore so list page reflects live prices
    if (data.type === 'price_update' && data.marketId) {
      import('@/app/stores/useMarketStore').then(({ useMarketStore }) => {
        const store = useMarketStore.getState()
        const market = store.getMarketById(data.marketId)
        if (market) {
          store.updateMarketPrices(data.marketId, data.yesPrice, data.noPrice, market.volume)
        }
      }).catch(() => {})
    }
    if (data.type === 'multi_price_update' && data.marketId) {
      import('@/app/stores/useMarketStore').then(({ useMarketStore }) => {
        useMarketStore.getState().updateMultiOptionPrices(data.marketId, data.prices)
      }).catch(() => {})
    }

    // Handle user-targeted notification messages
    if (data.type === 'notification') {
      const fns = notificationCallbacks
      if (fns.size > 0) {
        fns.forEach((fn) => fn(data.notification))
      }
    }

    // Dispatch to global listeners (e.g. TradingFeed)
    globalCallbacks.forEach((cb) => cb(data))
  } catch {
    // ignore malformed messages
  }
}

export function connectWS(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  intentionalClose = false
  connectionDead = false
  setConnectionStatus(reconnectAttempts > 0 ? 'reconnecting' : 'disconnected')
  ws = new WebSocket(WS_URL)

  ws.addEventListener('open', () => {
    reconnectAttempts = 0
    setConnectionStatus('connected')

    // Start heartbeat
    startHeartbeat()

    // Re-authenticate if we have a stored token
    const token = localStorage.getItem('jwt_token')
    if (token) {
      ws?.send(JSON.stringify({ type: 'auth', token }))
    }

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

    // Notify components that connection was restored so they can resync state
    reconnectCallbacks.forEach(cb => cb())
  })

  ws.addEventListener('message', handleMessage)

  ws.addEventListener('close', () => {
    ws = null
    stopHeartbeat()
    orderbookListenerAttached = false

    // Don't reconnect if intentionally closed
    if (intentionalClose) {
      setConnectionStatus('disconnected')
      return
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      connectionDead = true
      setConnectionStatus('dead')
      import('sonner').then(({ toast }) => {
        toast.error('Real-time connection lost. Prices may be stale. Please refresh.')
      }).catch(() => {})
      return
    }

    setConnectionStatus('reconnecting')
    const delay = getReconnectDelay()
    reconnectAttempts++
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
  reconnectCallbacks.clear()
  notificationCallbacks.clear()
  callbacks.clear()
  globalCallbacks.clear()
  orderbookCallbacks.clear()
  orderbookListenerAttached = false
  if (ws) {
    ws.close()
    ws = null
  }
  setConnectionStatus('disconnected')
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

export function unsubscribeMarket(marketId: string, callback?: (data: unknown) => void): void {
  if (callback) {
    const fns = callbacks.get(marketId)
    if (fns) {
      fns.delete(callback)
      if (fns.size === 0) {
        callbacks.delete(marketId)
        // Unsubscribe from server when no callbacks remain
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe', marketId }))
        }
      }
    }
  } else {
    // If no specific callback provided, remove all callbacks for this market
    callbacks.delete(marketId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', marketId }))
    }
  }
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
    // Remove first to prevent duplicate listeners
    ws.removeEventListener('message', handleOrderbookMessage)
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

export function unsubscribeOrderBook(marketId: string, side: string, callback?: (data: unknown) => void): void {
  const key = `${marketId}:${side}`
  if (callback) {
    const fns = orderbookCallbacks.get(key)
    if (fns) {
      fns.delete(callback)
      if (fns.size === 0) {
        orderbookCallbacks.delete(key)
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe_orderbook', marketId, side }))
        }
      }
    }
  } else {
    orderbookCallbacks.delete(key)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe_orderbook', marketId, side }))
    }
  }
}

// --- Notification WebSocket ---

export function authenticateWS(token: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'auth', token }))
  }
}

export function subscribeNotifications(callback: (notification: unknown) => void): () => void {
  notificationCallbacks.add(callback)
  return () => {
    notificationCallbacks.delete(callback)
  }
}
