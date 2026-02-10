import { create } from 'zustand'

export interface Comment {
  id: string
  marketId: string
  author: string
  avatar: string
  content: string
  timestamp: number
  likes: number
  liked: boolean
}

interface CommentState {
  comments: Record<string, Comment[]>
  addComment: (marketId: string, content: string) => void
  likeComment: (marketId: string, commentId: string) => void
  getComments: (marketId: string) => Comment[]
}

function randomAddr(): string {
  const hex = '0123456789abcdef'
  let prefix = '0x'
  let suffix = ''
  for (let i = 0; i < 4; i++) prefix += hex[Math.floor(Math.random() * 16)]
  for (let i = 0; i < 4; i++) suffix += hex[Math.floor(Math.random() * 16)]
  return `${prefix}...${suffix}`
}

function randomColor(): string {
  const colors = [
    '#f43f5e', '#ec4899', '#a855f7', '#8b5cf6',
    '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6',
    '#10b981', '#22c55e', '#eab308', '#f97316',
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

const now = Date.now()

const MOCK_COMMENTS: Record<string, Comment[]> = {
  'fm-001': [
    { id: 'c1', marketId: 'fm-001', author: '0x7a2d...8f3b', avatar: '#f43f5e', content: '这波直接冲！ALL IN YES', timestamp: now - 300000, likes: 23, liked: false },
    { id: 'c2', marketId: 'fm-001', author: '0x3e9f...c1a2', avatar: '#8b5cf6', content: '别急，等CZ发推再说', timestamp: now - 600000, likes: 15, liked: false },
    { id: 'c3', marketId: 'fm-001', author: '0xb5c8...2d7e', avatar: '#06b6d4', content: '已经梭哈了，不接受反驳', timestamp: now - 900000, likes: 42, liked: false },
    { id: 'c4', marketId: 'fm-001', author: '0x91d4...5f0a', avatar: '#22c55e', content: '内盘毕业率这么高，不冲才是傻子', timestamp: now - 1800000, likes: 8, liked: false },
  ],
  'ma-001': [
    { id: 'c5', marketId: 'ma-001', author: '0x4f6a...d92c', avatar: '#eab308', content: 'PEPE永远的神！狗狗币已经是上个世纪的了', timestamp: now - 120000, likes: 31, liked: false },
    { id: 'c6', marketId: 'ma-001', author: '0xc3b7...1e4f', avatar: '#f97316', content: '别小看DOGE，马斯克随时可能发推', timestamp: now - 480000, likes: 19, liked: false },
    { id: 'c7', marketId: 'ma-001', author: '0x8d2e...a6b1', avatar: '#a855f7', content: '两个都买，对冲一下不香吗', timestamp: now - 1200000, likes: 7, liked: false },
  ],
  'bw-001': [
    { id: 'c8', marketId: 'bw-001', author: '0x2a9c...7e5d', avatar: '#3b82f6', content: '10万刀就是个心理关口，迟早破', timestamp: now - 180000, likes: 56, liked: false },
    { id: 'c9', marketId: 'bw-001', author: '0xd7f1...3b8c', avatar: '#14b8a6', content: '空军已经被埋了三层了，还有人做空吗', timestamp: now - 720000, likes: 28, liked: false },
    { id: 'c10', marketId: 'bw-001', author: '0x5e3a...c9f2', avatar: '#ec4899', content: '我奶BTC年底20万，截图为证', timestamp: now - 2400000, likes: 12, liked: false },
  ],
  'nr-001': [
    { id: 'c11', marketId: 'nr-001', author: '0xa1d6...4e7b', avatar: '#10b981', content: 'AI+Crypto才是真正的未来，无脑冲', timestamp: now - 240000, likes: 35, liked: false },
    { id: 'c12', marketId: 'nr-001', author: '0x6b8f...d2a9', avatar: '#6366f1', content: '上次说RWA是未来的人现在还好吗', timestamp: now - 960000, likes: 11, liked: false },
  ],
  'kol-001': [
    { id: 'c13', marketId: 'kol-001', author: '0xf4c2...8a1d', avatar: '#f43f5e', content: '跟KOL买币，赢了会所嫩模，输了下海干活', timestamp: now - 360000, likes: 44, liked: false },
    { id: 'c14', marketId: 'kol-001', author: '0x9e7b...5c3f', avatar: '#eab308', content: '上次跟着买直接腰斩，这次我反着来', timestamp: now - 1500000, likes: 22, liked: false },
  ],
}

export const useCommentStore = create<CommentState>((set, get) => ({
  comments: MOCK_COMMENTS,

  addComment: (marketId, content) => {
    const comment: Comment = {
      id: `c${Date.now()}`,
      marketId,
      author: randomAddr(),
      avatar: randomColor(),
      content,
      timestamp: Date.now(),
      likes: 0,
      liked: false,
    }
    const prev = get().comments[marketId] ?? []
    set({
      comments: {
        ...get().comments,
        [marketId]: [comment, ...prev],
      },
    })
  },

  likeComment: (marketId, commentId) => {
    const prev = get().comments[marketId] ?? []
    set({
      comments: {
        ...get().comments,
        [marketId]: prev.map(c =>
          c.id === commentId
            ? { ...c, liked: !c.liked, likes: c.liked ? c.likes - 1 : c.likes + 1 }
            : c,
        ),
      },
    })
  },

  getComments: (marketId) => {
    const list = get().comments[marketId] ?? []
    return [...list].sort((a, b) => b.timestamp - a.timestamp)
  },
}))
