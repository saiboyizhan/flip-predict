import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import crypto from 'crypto';

const router = Router();

// Achievement definitions
const ACHIEVEMENT_DEFS = [
  {
    id: 'first_trade',
    title: 'First Blood',
    titleZh: '初次交易',
    description: 'Complete your first trade',
    descriptionZh: '完成你的第一笔交易',
    icon: '🎯',
    category: 'trading',
    requirement: 1,
    type: 'trade_count',
  },
  {
    id: 'ten_trades',
    title: 'Getting Started',
    titleZh: '初露锋芒',
    description: 'Complete 10 trades',
    descriptionZh: '完成 10 笔交易',
    icon: '📈',
    category: 'trading',
    requirement: 10,
    type: 'trade_count',
  },
  {
    id: 'fifty_trades',
    title: 'Experienced Trader',
    titleZh: '交易老手',
    description: 'Complete 50 trades',
    descriptionZh: '完成 50 笔交易',
    icon: '🏆',
    category: 'trading',
    requirement: 50,
    type: 'trade_count',
  },
  {
    id: 'first_win',
    title: 'Winner',
    titleZh: '首次胜利',
    description: 'Win your first prediction',
    descriptionZh: '赢得你的第一次预测',
    icon: '🥇',
    category: 'trading',
    requirement: 1,
    type: 'win_count',
  },
  {
    id: 'five_streak',
    title: 'Hot Streak',
    titleZh: '五连胜',
    description: 'Win 5 predictions in a row',
    descriptionZh: '连续赢得 5 次预测',
    icon: '🔥',
    category: 'trading',
    requirement: 5,
    type: 'win_streak',
  },
  {
    id: 'whale',
    title: 'Whale',
    titleZh: '巨鲸',
    description: 'Trade volume exceeds $10,000',
    descriptionZh: '交易总额超过 $10,000',
    icon: '🐋',
    category: 'volume',
    requirement: 10000,
    type: 'trade_volume',
  },
  {
    id: 'agent_owner',
    title: 'Agent Master',
    titleZh: 'Agent大师',
    description: 'Mint your first Agent',
    descriptionZh: '铸造你的第一个 Agent',
    icon: '🤖',
    category: 'social',
    requirement: 1,
    type: 'agent_count',
  },
  {
    id: 'market_creator',
    title: 'Market Maker',
    titleZh: '做市专家',
    description: 'Create your first market',
    descriptionZh: '创建你的第一个市场',
    icon: '🏦',
    category: 'social',
    requirement: 1,
    type: 'market_created_count',
  },
  {
    id: 'social_butterfly',
    title: 'Social Butterfly',
    titleZh: '社交达人',
    description: 'Post 10 comments',
    descriptionZh: '发表 10 条评论',
    icon: '🦋',
    category: 'social',
    requirement: 10,
    type: 'comment_count',
  },
  {
    id: 'referral_king',
    title: 'Referral King',
    titleZh: '推荐之王',
    description: 'Invite 5 friends',
    descriptionZh: '邀请 5 位好友',
    icon: '👑',
    category: 'social',
    requirement: 5,
    type: 'referral_count',
  },
];

/** Calculate user progress for all achievement types */
async function calculateUserProgress(address: string): Promise<Record<string, number>> {
  const db = getDb();

  // Trade count
  const tradeCountRes = await db.query(
    'SELECT COUNT(*) as count FROM orders WHERE user_address = $1',
    [address]
  );
  const tradeCount = parseInt(tradeCountRes.rows[0]?.count) || 0;

  // Trade volume
  const tradeVolumeRes = await db.query(
    'SELECT COALESCE(SUM(amount), 0) as volume FROM orders WHERE user_address = $1',
    [address]
  );
  const tradeVolume = parseFloat(tradeVolumeRes.rows[0]?.volume) || 0;

  // Win count (from resolved markets)
  const winCountRes = await db.query(`
    SELECT COUNT(*) as count
    FROM positions p
    JOIN market_resolution mr ON p.market_id = mr.market_id
    WHERE p.user_address = $1 AND mr.outcome IS NOT NULL AND p.side = mr.outcome
  `, [address]);
  const winCount = parseInt(winCountRes.rows[0]?.count) || 0;

  // Win streak - calculate from ordered resolved trades
  let winStreak = 0;
  try {
    const streakRes = await db.query(`
      SELECT
        CASE WHEN p.side = mr.outcome THEN 1 ELSE 0 END as is_win
      FROM positions p
      JOIN market_resolution mr ON p.market_id = mr.market_id
      WHERE p.user_address = $1 AND mr.outcome IS NOT NULL
      ORDER BY COALESCE(mr.resolved_at, p.created_at) DESC
    `, [address]);

    let currentStreak = 0;
    let bestStreak = 0;
    for (const row of streakRes.rows as any[]) {
      if (row.is_win === 1) {
        currentStreak++;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    winStreak = bestStreak;
  } catch {
    winStreak = 0;
  }

  // Agent count
  const agentCountRes = await db.query(
    'SELECT COUNT(*) as count FROM agents WHERE owner_address = $1',
    [address]
  );
  const agentCount = parseInt(agentCountRes.rows[0]?.count) || 0;

  // Market created count
  const marketCreatedRes = await db.query(
    'SELECT COUNT(*) as count FROM user_created_markets WHERE creator_address = $1',
    [address]
  );
  const marketCreatedCount = parseInt(marketCreatedRes.rows[0]?.count) || 0;

  // Comment count
  const commentCountRes = await db.query(
    'SELECT COUNT(*) as count FROM comments WHERE user_address = $1',
    [address]
  );
  const commentCount = parseInt(commentCountRes.rows[0]?.count) || 0;

  // Referral count
  const referralCountRes = await db.query(
    'SELECT COUNT(*) as count FROM referrals WHERE referrer_address = $1',
    [address]
  );
  const referralCount = parseInt(referralCountRes.rows[0]?.count) || 0;

  return {
    trade_count: tradeCount,
    trade_volume: tradeVolume,
    win_count: winCount,
    win_streak: winStreak,
    agent_count: agentCount,
    market_created_count: marketCreatedCount,
    comment_count: commentCount,
    referral_count: referralCount,
  };
}

/** Auto-unlock achievements based on progress and persist to DB */
async function checkAndUnlockAchievements(address: string, progress: Record<string, number>) {
  const db = getDb();
  const now = Date.now();

  for (const def of ACHIEVEMENT_DEFS) {
    const currentProgress = progress[def.type] || 0;
    if (currentProgress >= def.requirement) {
      // Try to insert (ignore if already exists)
      try {
        await db.query(`
          INSERT INTO user_achievements (id, user_address, achievement_id, unlocked_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_address, achievement_id) DO NOTHING
        `, [crypto.randomUUID(), address, def.id, now]);
      } catch {
        // Ignore duplicate key errors
      }
    }
  }
}

// GET /api/achievements — List all achievement definitions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const achievements = ACHIEVEMENT_DEFS.map((def) => ({
      id: def.id,
      title: def.title,
      titleZh: def.titleZh,
      description: def.description,
      descriptionZh: def.descriptionZh,
      icon: def.icon,
      category: def.category,
      requirement: def.requirement,
      type: def.type,
    }));

    res.json({ achievements });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/achievements/:address — Get user achievement progress
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address as string;
    const db = getDb();

    // Calculate progress
    const progress = await calculateUserProgress(address);

    // Auto-unlock achievements
    await checkAndUnlockAchievements(address, progress);

    // Fetch user's unlocked achievements
    const { rows: unlocked } = await db.query(
      'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_address = $1',
      [address]
    );

    const unlockedMap = new Map<string, number>();
    for (const row of unlocked as any[]) {
      unlockedMap.set(row.achievement_id, parseInt(row.unlocked_at));
    }

    // Build response with progress info
    const achievements = ACHIEVEMENT_DEFS.map((def) => {
      const currentProgress = progress[def.type] || 0;
      const isUnlocked = unlockedMap.has(def.id);

      return {
        id: def.id,
        title: def.title,
        titleZh: def.titleZh,
        description: def.description,
        descriptionZh: def.descriptionZh,
        icon: def.icon,
        category: def.category,
        requirement: def.requirement,
        type: def.type,
        progress: Math.min(currentProgress, def.requirement),
        unlocked: isUnlocked,
        unlockedAt: isUnlocked ? unlockedMap.get(def.id) : null,
      };
    });

    res.json({ achievements });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
