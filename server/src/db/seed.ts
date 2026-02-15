import { Pool } from 'pg';
import crypto from 'crypto';
import { initDatabase, getDb } from './index';
import { getPrice } from '../engine/amm';

function futureTs(days: number, hours = 0): number {
  return Date.now() + days * 86400000 + hours * 3600000;
}

function pastTs(days: number): number {
  return Date.now() - days * 86400000;
}

interface SeedMarket {
  id: string;
  title: string;
  description: string;
  category: string;
  yesPrice: number;
  volume: number;
  endDays: number;
  createdDays: number;
  /** Oracle resolution config (if set, market auto-settles via Binance Oracle) */
  resolutionType?: 'price_above' | 'price_below' | 'manual';
  oraclePair?: string;       // e.g. 'BNB/USD' or '0x...' token address
  targetPrice?: number;
}

const MARKETS: SeedMarket[] = [
  // ==================== four-meme: 毕业数量预测 (13) ====================
  // --- 日预测 ---
  { id: 'fm-001', title: '今日 Four.meme 毕业代币数量是否超过 30 个？', description: 'Four.meme 日均毕业 50-150 个代币，bonding curve 达到 24 BNB 即自动毕业到 PancakeSwap。低于 30 个通常意味着市场极度冷清。以 Dune Analytics Four.meme Dashboard 当日 UTC 0:00-23:59 数据为准。', category: 'four-meme', yesPrice: 0.82, volume: 1180000, endDays: 1, createdDays: 0 },
  { id: 'fm-002', title: '今日 Four.meme 毕业代币数量是否超过 80 个？', description: '80 个毕业是 Four.meme 的中等活跃水平。近 7 日有 4 天超过 80，3 天低于 80。以 Dune Analytics 当日数据为准。', category: 'four-meme', yesPrice: 0.55, volume: 1010000, endDays: 1, createdDays: 0 },
  { id: 'fm-003', title: '今日 Four.meme 毕业代币数量是否超过 150 个？', description: '150+ 属于高峰水平，历史上仅在市场极度 FOMO 时出现过（如 2025.10 Meme Season 期间）。以 Dune Analytics 当日数据为准。', category: 'four-meme', yesPrice: 0.18, volume: 760000, endDays: 1, createdDays: 0 },
  { id: 'fm-004', title: '2月16日 Four.meme 毕业代币是否超过 50 个？', description: '周日通常是链上活跃度的低谷。过去 4 个周日平均毕业 62 个，但波动较大（最低 38，最高 91）。以 Dune Analytics 数据为准。', category: 'four-meme', yesPrice: 0.63, volume: 580000, endDays: 1, createdDays: 0 },
  { id: 'fm-005', title: '2月17日 Four.meme 毕业代币是否超过 100 个？', description: '周一通常迎来链上活跃度回升。如果周末有新叙事发酵，周一容易出现毕业高峰。过去 4 个周一平均毕业 95 个。以 Dune Analytics 数据为准。', category: 'four-meme', yesPrice: 0.47, volume: 490000, endDays: 2, createdDays: 0 },
  { id: 'fm-006', title: '2月18日 Four.meme 毕业代币是否超过 80 个？', description: '黑客松截止前一天 (2/19)，BSC 生态关注度可能提升。周二历史平均毕业约 88 个，属于正常偏高水平。以 Dune Analytics 数据为准。', category: 'four-meme', yesPrice: 0.58, volume: 400000, endDays: 3, createdDays: 0 },
  { id: 'fm-007', title: '2月19日 Four.meme 毕业代币是否超过 30 个？', description: 'Good Vibes Only 黑客松截止当天。注意力可能从 Meme 转向黑客松，但 Four.meme 基础毕业量通常不会低于 40。30 是极端低值阈值。以 Dune Analytics 数据为准。', category: 'four-meme', yesPrice: 0.88, volume: 320000, endDays: 4, createdDays: 0 },
  // --- 周预测 ---
  { id: 'fm-008', title: '本周 (2/10-2/16) Four.meme 毕业代币总数是否超过 500 个？', description: '日均 50-150 计算，本周 7 天合计需日均 71+。截至 2/14 已毕业约 380 个，剩余 2 天需 120+。以 Dune Analytics 周统计数据为准。', category: 'four-meme', yesPrice: 0.72, volume: 1480000, endDays: 1, createdDays: 3 },
  { id: 'fm-009', title: '本周 (2/10-2/16) Four.meme 毕业代币总数是否超过 700 个？', description: '700 需要日均 100+，属于较高水平。截至 2/14 已毕业约 380 个，剩 2 天需 320+（日均 160），难度较大。以 Dune Analytics 周统计数据为准。', category: 'four-meme', yesPrice: 0.25, volume: 890000, endDays: 1, createdDays: 3 },
  { id: 'fm-010', title: '下周 (2/17-2/23) Four.meme 毕业代币总数是否超过 600 个？', description: '下周包含黑客松结束后的反弹期，历史上大事件后 Meme 活跃度通常上升。600 需日均 85+，为中等偏高水平。以 Dune Analytics 周统计数据为准。', category: 'four-meme', yesPrice: 0.52, volume: 740000, endDays: 8, createdDays: 1 },
  { id: 'fm-011', title: '下周 (2/17-2/23) Four.meme 毕业代币总数是否超过 1000 个？', description: '1000 需日均 143+，接近历史高峰水平。除非出现 Meme Season 级别的 FOMO 行情，否则很难达到。以 Dune Analytics 周统计数据为准。', category: 'four-meme', yesPrice: 0.15, volume: 1080000, endDays: 8, createdDays: 1 },
  // --- 毕业率 + 创建量 ---
  { id: 'fm-012', title: '本周 Four.meme 毕业率是否超过 2%？', description: '毕业率 = 毕业数 / 新创建数。历史平均约 1.3%，上周达 1.75%。超过 2% 意味着质量项目比例显著提升。以 Dune Analytics 毕业率图表为准。', category: 'four-meme', yesPrice: 0.30, volume: 620000, endDays: 1, createdDays: 2 },
  { id: 'fm-013', title: '今日 Four.meme 新创建代币数量是否超过 10,000 个？', description: '10,000+ 创建量标志着 Meme 热潮回归，2025 年 10 月曾连续多日达到此水平。当前日均约 5,000-8,000。以 Dune Analytics 当日数据为准。', category: 'four-meme', yesPrice: 0.35, volume: 520000, endDays: 1, createdDays: 0 },

  // ==================== flap: 毕业数量预测 (11) ====================
  // --- 日预测 ---
  { id: 'fl-001', title: '今日 Flap 毕业代币数量是否超过 5 个？', description: 'Flap 是 BSC 上的 Meme 代币发射平台，bonding curve 达到 16 BNB 即自动毕业到 PancakeSwap V3。平台规模较小，日均毕业约 3-15 个。5 个是较低阈值。以 Flap Board 当日数据为准。', category: 'flap', yesPrice: 0.75, volume: 480000, endDays: 1, createdDays: 0 },
  { id: 'fl-002', title: '今日 Flap 毕业代币数量是否超过 10 个？', description: '10 个毕业是 Flap 的中等偏高水平。平台日均毕业约 3-15 个，超过 10 个说明市场活跃度不错。以 Flap Board 当日 Listed on Dex 数量为准。', category: 'flap', yesPrice: 0.45, volume: 370000, endDays: 1, createdDays: 0 },
  { id: 'fl-003', title: '今日 Flap 毕业代币数量是否超过 20 个？', description: '20+ 毕业属于 Flap 的高峰水平，通常只在 BSC Meme 热潮期间出现。PreLaunch 功能（2026.1.8 上线）是否带来更多优质项目？以 Flap Board 当日数据为准。', category: 'flap', yesPrice: 0.15, volume: 310000, endDays: 1, createdDays: 0 },
  { id: 'fl-004', title: '2月16日 Flap 毕业代币是否超过 8 个？', description: '周日链上活跃度通常下降。Flap 周日毕业量可能低于工作日。8 个是周日的中等预期。以 Flap Board 数据为准。', category: 'flap', yesPrice: 0.50, volume: 250000, endDays: 1, createdDays: 0 },
  { id: 'fl-005', title: '2月17日 Flap 毕业代币是否超过 10 个？', description: '周一回暖期。如果周末有新叙事（如新 Tax Vault 模板上线），周一可能迎来毕业小高峰。以 Flap Board 数据为准。', category: 'flap', yesPrice: 0.42, volume: 220000, endDays: 2, createdDays: 0 },
  { id: 'fl-006', title: '2月19日 Flap 毕业代币是否超过 5 个？', description: '黑客松截止当天，BSC 生态关注度可能提升。Flap 基础毕业量通常不低于 3-5 个。以 Flap Board 数据为准。', category: 'flap', yesPrice: 0.72, volume: 180000, endDays: 4, createdDays: 0 },
  // --- 周预测 ---
  { id: 'fl-007', title: '本周 (2/10-2/16) Flap 毕业代币总数是否超过 50 个？', description: 'Flap 日均毕业 3-15 个，7 天合计需日均 7+。50 个是中等偏高的一周目标。以 Flap Board 周统计数据为准。', category: 'flap', yesPrice: 0.60, volume: 580000, endDays: 1, createdDays: 3 },
  { id: 'fl-008', title: '本周 (2/10-2/16) Flap 毕业代币总数是否超过 100 个？', description: '100 个需日均 14+，接近 Flap 的上限水平。除非出现 BSC Meme 热潮，否则难以达到。以 Flap Board 数据为准。', category: 'flap', yesPrice: 0.20, volume: 430000, endDays: 1, createdDays: 3 },
  { id: 'fl-009', title: '下周 (2/17-2/23) Flap 毕业代币总数是否超过 80 个？', description: '黑客松结束后 BSC 生态可能迎来反弹。PreLaunch 功能持续吸引新项目。80 个需日均 11+。以 Flap Board 数据为准。', category: 'flap', yesPrice: 0.38, volume: 350000, endDays: 8, createdDays: 1 },
  // --- 创建量 + 毕业率 ---
  { id: 'fl-010', title: '今日 Flap 新创建代币数量是否超过 200 个？', description: 'Flap 日均创建量约 100-500 个，远低于 Four.meme。200 个是中等水平。Tax as Funds 功能是否吸引更多创作者？以 Flap Board Newly Created 数量为准。', category: 'flap', yesPrice: 0.55, volume: 260000, endDays: 1, createdDays: 0 },
  { id: 'fl-011', title: '本周 Flap 毕业率是否超过 5%？', description: 'Flap 毕业率 (毕业数/创建数) 通常高于 Four.meme (约 1.3%)，因为 Tax Token 机制吸引更认真的项目方。5% 是较高目标。以 Flap Board 数据计算。', category: 'flap', yesPrice: 0.28, volume: 230000, endDays: 1, createdDays: 2 },

  // ==================== nfa: NFA Agent 生态预测 (10) ====================
  // --- 日预测 ---
  { id: 'nf-001', title: '今日 NFA Agent 总交易量是否超过 500 笔？', description: 'NFA (Non-Fungible Agent) 系统中的 ERC-721 Agent 支持 5 种策略类型，日均交易量约 200-600 笔。500 笔是中等偏高水平。以 Flip Platform Dashboard 当日数据为准。', category: 'nfa', yesPrice: 0.55, volume: 640000, endDays: 1, createdDays: 0 },
  { id: 'nf-002', title: '今日 NFA Agent 预测总数是否超过 200 次？', description: 'NFA Agent 可以对市场进行自动预测记录。当前平台共有约 80 个活跃 Agent，日均预测约 120-250 次。200 次需要大部分 Agent 处于活跃状态。以 Flip Platform Dashboard 数据为准。', category: 'nfa', yesPrice: 0.48, volume: 420000, endDays: 1, createdDays: 0 },
  // --- 周预测 ---
  { id: 'nf-003', title: '本周 NFA Agent 排行榜 Top1 准确率是否超过 70%？', description: '排行榜 Top1 Agent 通常准确率在 55%-75% 之间。超过 70% 意味着表现极为出色，接近最优策略水平。以 Flip Platform Dashboard 本周排行数据为准。', category: 'nfa', yesPrice: 0.40, volume: 820000, endDays: 1, createdDays: 2 },
  { id: 'nf-004', title: '本周新铸造 NFA Agent 数量是否超过 50 个？', description: 'NFA Agent 采用 Free Mint 模式，每个地址最多 3 个。本周黑客松期间 BSC 生态关注度提升，可能带动 Agent 铸造量。以 Flip Platform Dashboard 数据为准。', category: 'nfa', yesPrice: 0.35, volume: 510000, endDays: 1, createdDays: 1 },
  { id: 'nf-005', title: '本周 NFA Agent 平均收益率是否为正？', description: '所有活跃 NFA Agent 在本周的平均收益率。正收益意味着 Agent 策略整体有效。以 Flip Platform Dashboard 数据为准。', category: 'nfa', yesPrice: 0.52, volume: 710000, endDays: 1, createdDays: 2 },
  { id: 'nf-006', title: '本周 NFA 跟单交易关注者是否超过 100 人？', description: 'NFA Agent 支持跟单功能，用户可以自动复制 Top Agent 的交易策略。当前跟单总人数约 60 人。黑客松期间新用户涌入可能推高这个数字。以 Flip Platform Dashboard 数据为准。', category: 'nfa', yesPrice: 0.30, volume: 380000, endDays: 1, createdDays: 1 },
  { id: 'nf-007', title: '本周是否有 NFA Agent 达成 5 连胜？', description: '5 连胜要求 Agent 连续 5 次预测全部正确。按平均 60% 准确率计算，5 连胜概率约 7.8%。但高水平 Agent 准确率可达 70%+。以 Flip Platform Dashboard 连胜记录为准。', category: 'nfa', yesPrice: 0.42, volume: 560000, endDays: 1, createdDays: 2 },
  { id: 'nf-008', title: 'NFA Agent 市场上架总数是否超过 30 个？', description: 'NFA Agent 支持出售和出租。当前市场上架约 15 个 Agent。随着平台用户增长和 Agent 价值被认可，上架数量可能增加。以 Flip Platform Dashboard Agent 市场数据为准。', category: 'nfa', yesPrice: 0.25, volume: 290000, endDays: 4, createdDays: 1 },
  // --- 下周预测 ---
  { id: 'nf-009', title: '下周 (2/17-2/23) NFA Agent 总交易量是否超过 3000 笔？', description: '黑客松结束后用户可能更多关注 NFA Agent 交易功能。日均 500 笔计算，7 天 3500 笔。但黑客松后可能有用户流失。以 Flip Platform Dashboard 数据为准。', category: 'nfa', yesPrice: 0.45, volume: 480000, endDays: 8, createdDays: 1 },
  { id: 'nf-010', title: '下周 (2/17-2/23) 激进策略 Agent 收益率是否跑赢稳健策略？', description: '激进策略偏好高风险高回报，稳健策略追求稳定收益。在波动较大的市场中激进策略通常占优。黑客松结束后市场波动方向不确定。以 Flip Platform Dashboard 策略对比数据为准。', category: 'nfa', yesPrice: 0.58, volume: 590000, endDays: 8, createdDays: 1 },

  // ==================== hackathon: Good Vibes Only 黑客松预测 (8) ====================
  { id: 'hk-001', title: 'Good Vibes Only 黑客松总提交项目数是否超过 200 个？', description: 'Good Vibes Only 是 BNB Chain 上的黑客松活动，截止日期 2026-02-19。BSC 生态近期活跃度较高，但 200 个提交是较高目标。以 DoraHacks 官方数据为准。', category: 'hackathon', yesPrice: 0.45, volume: 930000, endDays: 4, createdDays: 3 },
  { id: 'hk-002', title: '黑客松 DeFi 类别是否获得最多提交数？', description: 'BNB Chain 黑客松通常设有 DeFi、GameFi、AI+Blockchain 等赛道。DeFi 历来是 BSC 强项，但 AI+Blockchain 近期热度极高。以 DoraHacks 官方分类统计为准。', category: 'hackathon', yesPrice: 0.38, volume: 740000, endDays: 4, createdDays: 2 },
  { id: 'hk-003', title: '黑客松 AI + Blockchain 赛道提交数是否超过 50 个？', description: 'AI Agent 和链上 AI 是 2026 年最热门叙事之一。BSC 上已有 ERC-8004 等标准。50 个需要强劲参赛热情。以 DoraHacks 官方分类数据为准。', category: 'hackathon', yesPrice: 0.52, volume: 830000, endDays: 4, createdDays: 2 },
  { id: 'hk-004', title: '黑客松获奖项目是否全部开源？', description: '开源是 Web3 精神的核心。大多数黑客松获奖项目会在 GitHub 上公开代码，但也有部分项目选择闭源。以 DoraHacks 获奖项目 GitHub 链接验证为准。', category: 'hackathon', yesPrice: 0.65, volume: 530000, endDays: 8, createdDays: 1 },
  { id: 'hk-005', title: '是否有 BSC Meme 相关项目在黑客松中获奖？', description: 'BSC Meme 生态（Four.meme、Flap 等）是 BNB Chain 的重要组成部分。如果有 Meme 相关工具或协议获奖，将进一步验证 Meme 赛道价值。以 DoraHacks 官方获奖名单为准。', category: 'hackathon', yesPrice: 0.32, volume: 670000, endDays: 8, createdDays: 2 },
  { id: 'hk-006', title: '黑客松总奖金池是否超过 $50K？', description: 'BNB Chain 历史上黑客松奖金池通常在 $30K-$100K 之间。$50K 是中等偏高的预期。以 DoraHacks / Good Vibes Only 官方公告为准。', category: 'hackathon', yesPrice: 0.60, volume: 490000, endDays: 4, createdDays: 1 },
  { id: 'hk-007', title: '决赛入围项目中亚洲团队是否超过 5 支？', description: 'BNB Chain 在亚洲有强大的开发者社区。但全球化趋势下欧美团队参与度也在提升。5 支亚洲团队入围意味着亚洲开发者继续保持竞争力。以 DoraHacks 决赛名单为准。', category: 'hackathon', yesPrice: 0.70, volume: 400000, endDays: 8, createdDays: 1 },
  { id: 'hk-008', title: '黑客松是否催生超过 100 个新 GitHub 仓库？', description: '每个参赛项目通常至少创建 1 个 GitHub 仓库。100 个仓库大约对应 50-80 个参赛团队的代码产出。以 GitHub 搜索相关关键词统计为准。', category: 'hackathon', yesPrice: 0.55, volume: 360000, endDays: 8, createdDays: 1 },
];

function priceToReserves(yesPrice: number, baseLiquidity: number = 10000) {
  const total = 2 * baseLiquidity;
  const noReserve = yesPrice * total;
  const yesReserve = total - noReserve;
  return { yesReserve, noReserve };
}

export async function seedMarkets(pool: Pool) {
  const existing = (await pool.query('SELECT COUNT(*) as count FROM markets')).rows[0];
  if (parseInt(existing.count) > 0) {
    console.log(`Markets already seeded (${existing.count} markets found). Skipping.`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const m of MARKETS) {
      const { yesReserve, noReserve } = priceToReserves(m.yesPrice);
      const prices = getPrice(yesReserve, noReserve);
      await client.query(`
        INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at)
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12)
      `, [
        m.id, m.title, m.description, m.category,
        futureTs(m.endDays), prices.yesPrice, prices.noPrice,
        m.volume, 10000, yesReserve, noReserve, pastTs(m.createdDays)
      ]);
    }

    await client.query('COMMIT');
    console.log(`Seeded ${MARKETS.length} markets.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Seed market_resolution data
  const client2 = await pool.connect();
  try {
    await client2.query('BEGIN');

    for (const m of MARKETS) {
      const resType = m.resolutionType || 'manual';
      const oraclePair = m.oraclePair || null;
      const targetPrice = m.targetPrice ?? null;
      await client2.query(`
        INSERT INTO market_resolution (market_id, resolution_type, oracle_pair, target_price)
        VALUES ($1, $2, $3, $4) ON CONFLICT (market_id) DO NOTHING
      `, [m.id, resType, oraclePair, targetPrice]);
    }

    await client2.query('COMMIT');
  } catch (err) {
    await client2.query('ROLLBACK');
    throw err;
  } finally {
    client2.release();
  }

  console.log('Seeded market_resolution data.');

  // Seed price history
  await seedPriceHistory(pool);
}

async function seedPriceHistory(pool: Pool) {
  const existing = (await pool.query('SELECT COUNT(*) as count FROM price_history')).rows[0];
  if (parseInt(existing.count) > 0) {
    console.log(`Price history already seeded (${existing.count} records). Skipping.`);
    return;
  }

  const markets = (await pool.query('SELECT id, yes_price, no_price FROM markets')).rows;

  const now = Date.now();
  const HOUR = 3600000;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const market of markets) {
      // Simulate trades through CPMM to generate realistic price history
      const INIT = 10000;
      let yesReserve = INIT;
      let noReserve = INIT;
      const k = INIT * INIT;
      const targetYesPrice = Number(market.yes_price) || 0.5;

      for (let i = 168; i >= 0; i--) {
        const timestamp = new Date(now - i * HOUR).toISOString();

        // Current price from reserves
        const currentYesPrice = noReserve / (yesReserve + noReserve);

        // Bias trade direction toward target price
        const diff = targetYesPrice - currentYesPrice;
        const buyYesProb = Math.max(0.2, Math.min(0.8, 0.5 + diff * 2));
        const buyYes = Math.random() < buyYesProb;

        // Random trade size
        const tradeAmount = Math.random() * 200 + 50;

        if (buyYes) {
          noReserve += tradeAmount;
          yesReserve = k / noReserve;
        } else {
          yesReserve += tradeAmount;
          noReserve = k / yesReserve;
        }

        const total = yesReserve + noReserve;
        const yesPrice = Number((noReserve / total).toFixed(4));
        const noPrice = Number((yesReserve / total).toFixed(4));
        const volume = Number(tradeAmount.toFixed(2));

        await client.query(
          'INSERT INTO price_history (market_id, yes_price, no_price, volume, timestamp) VALUES ($1, $2, $3, $4, $5)',
          [market.id, Number(yesPrice.toFixed(4)), Number(noPrice.toFixed(4)), Number(volume.toFixed(2)), timestamp]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded price history for ${markets.length} markets (${markets.length * 169} records).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ========== Agent Seeding ==========

interface SeedAgent {
  id: string;
  name: string;
  owner: string;
  strategy: string;
  desc: string;
  balance: number;
  trades: number;
  wins: number;
  profit: number;
  roi: number;
  level: number;
  exp: number;
}

const SAMPLE_AGENTS: SeedAgent[] = [
  { id: 'agent-001', name: 'Alpha猎手', owner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8', strategy: 'aggressive', desc: '高风险高回报，专注极端事件', balance: 2450, trades: 32, wins: 15, profit: 450, roi: 45, level: 4, exp: 320 },
  { id: 'agent-002', name: '稳赢机器人', owner: '0x8f9e3d7a2b1c4e5f6a7b8c9d0e1f2a3b4c5d6e7f', strategy: 'conservative', desc: '低风险稳定收益，长期主义', balance: 1120, trades: 89, wins: 58, profit: 120, roi: 12, level: 6, exp: 890 },
  { id: 'agent-003', name: '反指大师', owner: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', strategy: 'contrarian', desc: '逆势操作，众人恐惧我贪婪', balance: 1280, trades: 45, wins: 26, profit: 280, roi: 28, level: 3, exp: 450 },
  { id: 'agent-004', name: '趋势追踪者', owner: '0x9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d', strategy: 'momentum', desc: '顺势而为，趋势是朋友', balance: 1350, trades: 56, wins: 33, profit: 350, roi: 35, level: 4, exp: 560 },
  { id: 'agent-005', name: '随机漫步', owner: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e', strategy: 'random', desc: '随机决策，市场实验', balance: 950, trades: 23, wins: 11, profit: -50, roi: -5, level: 2, exp: 230 },
];

const MARKET_IDS = [
  'fm-001', 'fm-002', 'fm-003', 'fm-004', 'fm-005',
  'fm-008', 'fm-009', 'fm-010', 'fm-011', 'fm-012', 'fm-013',
  'fl-001', 'fl-002', 'fl-004', 'fl-007', 'fl-009', 'fl-010', 'fl-011',
  'nf-001', 'nf-003', 'nf-005', 'nf-007', 'nf-009', 'nf-010',
  'hk-001', 'hk-002', 'hk-003', 'hk-005', 'hk-008',
];

export async function seedAgents(pool: Pool) {
  const existing = (await pool.query('SELECT COUNT(*) as count FROM agents')).rows[0];
  if (parseInt(existing.count) > 0) {
    console.log(`Agents already seeded (${existing.count} agents found). Skipping.`);
    return;
  }

  const now = Date.now();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const a of SAMPLE_AGENTS) {
      const winRate = a.trades > 0 ? Math.round((a.wins / a.trades) * 100) : 0;
      const isForSale = a.id === 'agent-003' ? 1 : 0;
      const salePrice = a.id === 'agent-003' ? 500 : null;
      const isForRent = a.id === 'agent-004' ? 1 : 0;
      const rentPrice = a.id === 'agent-004' ? 10 : null;
      const createdAt = now - Math.floor(Math.random() * 7 * 86400000);

      await client.query(`
        INSERT INTO agents (id, name, owner_address, strategy, description, status, wallet_balance,
          total_trades, winning_trades, total_profit, win_rate, roi, level, experience,
          is_for_sale, sale_price, is_for_rent, rent_price, created_at, last_trade_at)
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        a.id, a.name, a.owner, a.strategy, a.desc,
        a.balance, a.trades, a.wins, a.profit, winRate, a.roi,
        a.level, a.exp,
        isForSale, salePrice, isForRent, rentPrice,
        createdAt, now - Math.floor(Math.random() * 3600000)
      ]);

      // Insert 20~30 trades per agent
      const tradeCount = 20 + Math.floor(Math.random() * 11);
      for (let i = 0; i < tradeCount; i++) {
        const mid = MARKET_IDS[Math.floor(Math.random() * MARKET_IDS.length)];
        const side = Math.random() > 0.5 ? 'yes' : 'no';
        const amount = Math.round((10 + Math.random() * 90) * 100) / 100;
        const price = Math.round((0.2 + Math.random() * 0.6) * 10000) / 10000;
        const shares = Math.round((amount / price) * 100) / 100;
        const won = Math.random() < (a.wins / Math.max(a.trades, 1));
        const outcome = won ? 'win' : 'loss';
        const profit = won ? Math.round((amount * (1 / price - 1)) * 100) / 100 : -amount;
        const tradeTime = now - Math.floor(Math.random() * 10 * 86400000);

        await client.query(`
          INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price, outcome, profit, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, ['trade-' + a.id + '-' + i, a.id, mid, side, amount, shares, price, outcome, profit, tradeTime]);
      }
    }

    // Initialize style profiles for seeded agents
    for (const a of SAMPLE_AGENTS) {
      const riskPref = a.strategy === 'aggressive' ? 0.8 : a.strategy === 'conservative' ? 0.2 : a.strategy === 'contrarian' ? 0.6 : a.strategy === 'momentum' ? 0.5 : 0.5;
      const contrarian = a.strategy === 'contrarian' ? 0.8 : a.strategy === 'aggressive' ? 0.3 : 0.1;
      const fmTrades = Math.floor(a.trades * 0.40);
      const flTrades = Math.floor(a.trades * 0.25);
      const nfTrades = Math.floor(a.trades * 0.20);
      const hkTrades = a.trades - fmTrades - flTrades - nfTrades;
      const fmWins = Math.floor(a.wins * 0.40);
      const flWins = Math.floor(a.wins * 0.25);
      const nfWins = Math.floor(a.wins * 0.20);
      const hkWins = a.wins - fmWins - flWins - nfWins;
      const categoryStats = JSON.stringify({
        'four-meme': { total: fmTrades, correct: fmWins },
        'flap': { total: flTrades, correct: flWins },
        'nfa': { total: nfTrades, correct: nfWins },
        'hackathon': { total: hkTrades, correct: hkWins },
      });
      await client.query(`
        INSERT INTO agent_style_profile (agent_id, category_stats, risk_preference, confidence_calibration, contrarian_tendency, streak_current, streak_best, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (agent_id) DO NOTHING
      `, [a.id, categoryStats, riskPref, 0, contrarian, 0, 3, now]);
    }

    await client.query('COMMIT');
    console.log(`Seeded ${SAMPLE_AGENTS.length} agents with trade histories.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ========== Comment Seeding ==========

const SAMPLE_ADDRESSES = [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
  '0x8f9e3d7a2b1c4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
  '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
  '0x9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d',
  '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e',
  '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f',
  '0x6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
  '0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b',
];

interface SeedComment {
  marketId: string;
  comments: string[];
}

const SEED_COMMENTS: SeedComment[] = [
  // ==================== four-meme ====================
  {
    marketId: 'fm-001',
    comments: [
      '30 个太低了，除非 BSC 全网宕机否则不可能低于 30',
      '日均 80 左右，30 这个线基本是白送的 YES',
      '别小看周末效应，上个周六才毕业了 42 个',
      '看了下 Dune 数据，最近一个月最低一天也有 38 个',
      'YES 82% 已经很高了，但确定性强的市场就该这个价',
      '赚不了多少但几乎是无风险的，适合新手入场练手',
    ],
  },
  {
    marketId: 'fm-002',
    comments: [
      '80 是分水岭，超过 80 说明市场有正常活跃度',
      '今天 BTC 横盘，BSC 链上热度一般，80 有悬念',
      '下午 3 点到 9 点是毕业高峰期，现在判断还太早',
      '截至目前已经毕业 35 个了，按这速度 80 没问题',
      '这个价格很合理，55/45 的分歧正好说明市场有效',
      '我看 DexScreener 上今天新上线的代币不多，可能偏低',
    ],
  },
  {
    marketId: 'fm-003',
    comments: [
      '150 太高了，上一次超过 150 还是去年 10 月 Meme Season',
      '除非突然来一波 FOMO 叙事，否则 150 基本不可能',
      'NO 82% 我觉得合理，偶尔买点彩票仓 YES 也行',
      '链上 Gas 今天很低，说明整体活跃度不高',
      '想超 150 至少需要 Twitter 上出一个病毒式传播的 Meme',
    ],
  },
  {
    marketId: 'fm-008',
    comments: [
      '截至周五已经 380 了，还剩两天 120 日均 60 够了',
      '周末通常偏低但不至于断崖，500 大概率能到',
      '本周整体链上热度还行，Four.meme 新项目发射也不少',
      'YES 72% 合理，风险不大但收益也有限',
      '如果周六 + 周日合计不到 120 那就是极端冷清了',
      '上一次周合计低于 500 还是一个月前那次全网行情暴跌',
      '稳稳 YES，虽然赔率低但确定性高',
    ],
  },
  {
    marketId: 'fm-010',
    comments: [
      '下周黑客松结束，关注度回归 Meme 赛道，利好毕业数',
      '600 需要日均 85+，不算特别高但也不是躺赢',
      '得看 BTC 走势，大盘走好 BSC Meme 就活跃',
      '如果黑客松结束后有资金从黑客松项目流向 Meme，会很热闹',
      '52/48 的分歧说明市场真不确定，适合做波段',
      '我押 YES，黑客松后通常有一波 Meme 反弹',
    ],
  },
  {
    marketId: 'fm-012',
    comments: [
      '2% 毕业率历史上很少出现，1.75% 已经是高位了',
      '毕业率取决于创建数和毕业数的比值，创建数越少毕业率越高',
      '如果这周创建数下降但毕业数稳定，2% 有可能',
      '关注分母变化比分子更重要，创建数暴跌就会推高毕业率',
      '上周 1.75% 已经很亮眼了，连续两周高毕业率不太现实',
    ],
  },
  {
    marketId: 'fm-013',
    comments: [
      '10000 创建量需要超级 FOMO，目前日均 5000-8000',
      '上次破万是去年 10 月，当时 BNB 也在涨，整体情绪狂热',
      '今天看不到破万的迹象，除非下午突然来一波叙事',
      'NO 稳如狗，65% 甚至偏低了',
      '万一 CZ 发个推提到 Four.meme 那就不好说了',
    ],
  },
  // ==================== flap ====================
  {
    marketId: 'fl-001',
    comments: [
      '5 个对 Flap 来说不算高，基本每天都能到',
      'Flap 体量比 Four.meme 小很多，但毕业门槛也低（16 BNB）',
      '看了下 Board 上 Graduating 的有好几个了，5 个稳了',
      'PreLaunch 功能上线后确实多了不少新项目',
      'YES 75% 合理，Flap 毕业量虽少但很稳定',
    ],
  },
  {
    marketId: 'fl-002',
    comments: [
      '10 个要看今天市场情绪，Flap 高峰能到 15 低谷只有 3-4',
      '16 BNB 就能毕业，比 Four.meme 的 24 BNB 门槛低',
      '今天 Board 上 Graduating 状态的不多，10 个有点悬',
      'Tax Token 项目通常更认真，毕业概率更高',
      '45/55 这个赔率很有吸引力，值得小仓位 YES',
    ],
  },
  {
    marketId: 'fl-007',
    comments: [
      '本周还剩两天，看前几天平均 7-8 个/天，50 应该能到',
      'Flap 本周表现还行，创建量也在增长',
      '50 需要日均 7+，这是 Flap 的正常水平',
      '周末可能拖后腿，但前 5 天积累应该够了',
      'YES 60% 合理，不算确定但概率偏高',
      '我在 Flap 上观察了一周，感觉 50 问题不大',
    ],
  },
  {
    marketId: 'fl-009',
    comments: [
      '下周 80 个需要日均 11+，对 Flap 来说挑战不小',
      '黑客松结束后的反弹能不能带动 Flap 还不好说',
      'Flap 用户群和黑客松参赛者重叠度不高',
      '38% YES 偏低了，我觉得 45% 更合理',
      'PreLaunch 功能如果持续吸引项目方，80 有可能',
    ],
  },
  {
    marketId: 'fl-010',
    comments: [
      '200 个创建量对 Flap 来说是中等水平',
      'Tax as Funds 功能确实吸引了不少项目方来 Flap',
      '比 Four.meme 日创建量低一个数量级，但质量更高',
      '今天看 Board 上 Newly Created 的速度，200 应该能到',
    ],
  },
  // ==================== nfa ====================
  {
    marketId: 'nf-001',
    comments: [
      '500 笔交易量取决于活跃 Agent 数量，目前大概 80 个在跑',
      '最近几天 Agent 交易量明显上升，黑客松效应开始显现',
      '激进策略的 Agent 每天交易频次比稳健的高 3-4 倍',
      '看了下 Dashboard，今天截至目前已经 280 笔了，按这速度 500 没问题',
      '周末 Agent 也在跑，不受工作日影响，这个优势很大',
    ],
  },
  {
    marketId: 'nf-003',
    comments: [
      '70% 准确率相当高了，目前 Top1 的 Alpha猎手也才 68%',
      '稳赢机器人的策略虽然保守但胜率一直很稳，有可能冲上去',
      '如果整体市场走势明朗，Top Agent 准确率也会跟着提升',
      '关键看这周剩下的市场结算结果，如果大盘走稳准确率就容易高',
      '这种市场很有意思，押注别人是否能做得好',
    ],
  },
  {
    marketId: 'nf-005',
    comments: [
      '平均收益率为正说明 Agent 策略整体有效',
      '关键看激进策略和稳健策略的平衡',
      '如果市场波动太大，大部分 Agent 都可能亏',
      '本周黑客松带来新用户，交易量上升有利于策略执行',
    ],
  },
  {
    marketId: 'nf-007',
    comments: [
      '5 连胜概率算起来不高，但平台上有 80+ Agent 在跑',
      '只要有一个 Agent 达成就算 YES，所以概率比想象中高',
      'Alpha猎手上周有过 4 连胜，差一步就到了',
      '趋势追踪者在行情好的时候连胜概率最高',
    ],
  },
  // ==================== hackathon ====================
  {
    marketId: 'hk-001',
    comments: [
      '200 个项目对 BNB Chain 黑客松来说是高目标',
      '上一次 BNB Chain 黑客松提交了大概 150 个，这次热度更高',
      '还有 4 天截止，很多团队都是最后几天才提交的',
      '看 DoraHacks 上已经有不少团队注册了，200 有可能',
      'AI+Blockchain 赛道贡献了不少新项目',
    ],
  },
  {
    marketId: 'hk-003',
    comments: [
      'AI Agent 是今年最热的叙事，50 个 AI 项目完全有可能',
      'ERC-8004 刚上线 BSC，很多团队在围绕它构建',
      '不过很多 AI 项目质量参差不齐，是否算 AI+Blockchain 赛道要看官方分类',
      'ChatGPT 类工具让 AI 项目门槛降低了很多，提交数会偏高',
    ],
  },
  {
    marketId: 'hk-005',
    comments: [
      'Meme 赛道在黑客松中一般不占优，评委更看重技术创新',
      '但如果是 Meme 分析工具或者交易聚合器，有机会获奖',
      '预测市场本身也算 Meme 相关，我们自己不就是吗',
      '32% YES 偏低了，我觉得有 40% 的可能',
    ],
  },
];

export async function seedComments(pool: Pool) {
  const existing = (await pool.query('SELECT COUNT(*) as count FROM comments')).rows[0];
  if (parseInt(existing.count) > 0) {
    console.log(`Comments already seeded (${existing.count} comments found). Skipping.`);
    return;
  }

  const now = Date.now();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const sc of SEED_COMMENTS) {
      for (let i = 0; i < sc.comments.length; i++) {
        const id = crypto.randomUUID();
        const userAddress = SAMPLE_ADDRESSES[i % SAMPLE_ADDRESSES.length];
        const createdAt = now - Math.floor(Math.random() * 3 * 86400000);
        const likes = Math.floor(Math.random() * 12);
        const likedBy = SAMPLE_ADDRESSES.slice(0, likes % SAMPLE_ADDRESSES.length);

        await client.query(
          `INSERT INTO comments (id, market_id, user_address, content, likes, liked_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, sc.marketId, userAddress, sc.comments[i], likes, JSON.stringify(likedBy), createdAt]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded comments for ${SEED_COMMENTS.length} markets.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function reseed(pool: Pool) {
  console.log('Reseed: clearing old data...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear in dependency order
    await client.query('DELETE FROM settlement_log');
    await client.query('DELETE FROM resolution_challenges');
    await client.query('DELETE FROM resolution_proposals');
    await client.query('DELETE FROM market_resolution');
    await client.query('DELETE FROM price_history');
    await client.query('DELETE FROM option_price_history');
    await client.query('DELETE FROM agent_trades');
    await client.query('DELETE FROM agent_style_profile');
    await client.query('DELETE FROM agent_predictions');
    await client.query('DELETE FROM open_orders');
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM positions');
    await client.query('DELETE FROM comments');
    await client.query('DELETE FROM agents');
    await client.query('DELETE FROM market_options');
    await client.query('DELETE FROM markets');
    await client.query('COMMIT');
    console.log('Reseed: old data cleared.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Re-seed everything
  await seedMarkets(pool);
  await seedAgents(pool);
  await seedComments(pool);
  console.log('Reseed complete.');
}

// Allow running directly
if (require.main === module) {
  const isReseed = process.argv.includes('--reseed');
  (async () => {
    const pool = await initDatabase();
    if (isReseed) {
      await reseed(pool);
    } else {
      await seedMarkets(pool);
      await seedAgents(pool);
      await seedComments(pool);
      console.log('Seed complete.');
    }
    process.exit(0);
  })().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
