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
}

const MARKETS: SeedMarket[] = [
  // Four.meme
  { id: 'fm-001', title: '下一个Four.meme内盘毕业币会在24h内出现吗？', description: '四meme最近连续出了3个毕业币，势头猛猛的。赌一把今天还能不能再出一个。', category: 'four-meme', yesPrice: 0.72, volume: 234500, endDays: 1, createdDays: 1 },
  { id: 'fm-002', title: 'Four.meme本周内盘毕业数量能超过5个吗？', description: '上周出了4个，这周能不能破纪录？牛市信号看内盘。', category: 'four-meme', yesPrice: 0.45, volume: 189000, endDays: 5, createdDays: 2 },
  { id: 'fm-003', title: '下一个毕业币市值能破100万U吗？', description: '内盘毕业不算什么，毕业之后能不能冲才是关键。', category: 'four-meme', yesPrice: 0.33, volume: 156000, endDays: 3, createdDays: 1 },
  // Meme Arena
  { id: 'ma-001', title: '$PEPE vs $DOGE: 谁能在7天内涨幅更大？', description: '经典meme对决，老狗还能跑赢青蛙吗？押注你的信仰。', category: 'meme-arena', yesPrice: 0.58, volume: 567000, endDays: 5, createdDays: 2 },
  { id: 'ma-002', title: '今天会有新Meme币24h涨幅超过1000%吗？', description: '土狗乐园每天都有奇迹，今天轮到谁了？', category: 'meme-arena', yesPrice: 0.61, volume: 312000, endDays: 1, createdDays: 0 },
  { id: 'ma-003', title: '$WIF还能再创新高吗？', description: '狗头帽已经涨了这么多了，还有人敢冲吗？', category: 'meme-arena', yesPrice: 0.41, volume: 423000, endDays: 7, createdDays: 3 },
  // Narrative
  { id: 'nr-001', title: 'AI叙事能在Q1保持热度吗？', description: 'AI赛道已经火了一整个周期了，还能撑到Q1结束吗？看看大家怎么投。', category: 'narrative', yesPrice: 0.78, volume: 890000, endDays: 30, createdDays: 5 },
  { id: 'nr-002', title: 'RWA赛道会在2周内出现10亿市值项目吗？', description: 'Real World Assets越来越热，华尔街都在布局，链上能跟上吗？', category: 'narrative', yesPrice: 0.35, volume: 234000, endDays: 14, createdDays: 3 },
  { id: 'nr-003', title: 'DePIN会成为下一个爆发叙事吗？', description: '去中心化物理基础设施网络，听着就很Web3。但能涨吗？', category: 'narrative', yesPrice: 0.52, volume: 178000, endDays: 21, createdDays: 4 },
  // KOL
  { id: 'kol-001', title: '某顶级KOL的下一个喊单币会在48h内翻倍吗？', description: '这位KOL上次喊单直接3倍，这次还能复刻奇迹吗？', category: 'kol', yesPrice: 0.38, volume: 456000, endDays: 2, createdDays: 1 },
  { id: 'kol-002', title: '本周KOL推荐币种平均收益会是正的吗？', description: '跟着大V买币，本周能回本吗？历史胜率只有40%哦。', category: 'kol', yesPrice: 0.44, volume: 267000, endDays: 5, createdDays: 2 },
  { id: 'kol-003', title: '推特粉丝最多的华语KOL会在本周发新币吗？', description: 'KOL发币已经是常规操作了，问题是什么时候发。', category: 'kol', yesPrice: 0.55, volume: 189000, endDays: 6, createdDays: 1 },
  // On-chain
  { id: 'oc-001', title: '聪明钱地址今天会大量买入ETH吗？', description: '标记的50个聪明钱地址，今天net flow会是正的吗？', category: 'on-chain', yesPrice: 0.62, volume: 345000, endDays: 1, createdDays: 0 },
  { id: 'oc-002', title: '某巨鲸会在本周抛售BTC吗？', description: '这个地址持有超过1万枚BTC，最近有转到交易所的迹象。', category: 'on-chain', yesPrice: 0.29, volume: 678000, endDays: 5, createdDays: 2 },
  { id: 'oc-003', title: 'Uniswap V3今天的交易量会突破10亿U吗？', description: 'DEX交易量是链上活跃度的风向标，今天能破10亿吗？', category: 'on-chain', yesPrice: 0.55, volume: 234000, endDays: 1, createdDays: 0 },
  // Rug Alert
  { id: 'ra-001', title: '某新项目会在一周内Rug吗？', description: '合约没开源、LP没锁、团队匿名...经典三件套，你觉得呢？', category: 'rug-alert', yesPrice: 0.73, volume: 123000, endDays: 7, createdDays: 1 },
  { id: 'ra-002', title: '本周会有超过3个项目被确认Rug Pull吗？', description: '上周有5个，市场这么疯狂，跑路的只会更多。', category: 'rug-alert', yesPrice: 0.81, volume: 167000, endDays: 5, createdDays: 2 },
  { id: 'ra-003', title: '某热门项目的TVL会在72h内暴跌50%以上吗？', description: '有人在推特上爆料了一些不太好的事情，TVL已经开始跌了...', category: 'rug-alert', yesPrice: 0.47, volume: 345000, endDays: 3, createdDays: 1 },
  // BTC Weather
  { id: 'bw-001', title: 'BTC今天收盘会在$100K以上吗？', description: '大饼冲击10万大关，今天能站稳吗？', category: 'btc-weather', yesPrice: 0.56, volume: 1230000, endDays: 1, createdDays: 0 },
  { id: 'bw-002', title: 'BTC本周会出现超过5%的回调吗？', description: '涨太多了，该回调了？还是继续暴力拉盘？', category: 'btc-weather', yesPrice: 0.42, volume: 890000, endDays: 6, createdDays: 1 },
  { id: 'bw-003', title: 'ETH/BTC汇率本周会反弹吗？', description: '以太坊打折打了好久了，汇率还能起来吗？', category: 'btc-weather', yesPrice: 0.35, volume: 456000, endDays: 5, createdDays: 2 },
  // Fun
  { id: 'fun-001', title: 'CZ今天会发推吗？', description: '赵长鹏最近很安静，今天会不会整点活？', category: 'fun', yesPrice: 0.65, volume: 89000, endDays: 1, createdDays: 0 },
  { id: 'fun-002', title: '下一个爆火的Meme梗会是动物类的吗？', description: '狗、猫、青蛙都火过了，下一个会是什么？河马？企鹅？', category: 'fun', yesPrice: 0.58, volume: 67000, endDays: 14, createdDays: 3 },
  { id: 'fun-003', title: '今天Crypto Twitter上会有人晒超过100万U的盈利截图吗？', description: '牛市炫富日常，今天有没有大佬出来秀一把？', category: 'fun', yesPrice: 0.82, volume: 45000, endDays: 1, createdDays: 0 },
  // Daily
  { id: 'daily-001', title: '$SOL vs $AVAX: 今日涨幅之王', description: '两大L1公链今天谁涨得多？SOL生态火爆 vs AVAX机构入场。', category: 'daily', yesPrice: 0.67, volume: 345000, endDays: 1, createdDays: 0 },
  { id: 'daily-002', title: 'Arbitrum vs Optimism: 本周TVL增长对决', description: 'L2双雄每周必比的TVL大战，这周谁能赢？', category: 'daily', yesPrice: 0.52, volume: 234000, endDays: 6, createdDays: 1 },
  { id: 'daily-003', title: '$PEPE vs $FLOKI: 今日链上交易量谁更高？', description: '两大Meme王者今日DEX交易量对决，数据来源DEXScreener。', category: 'daily', yesPrice: 0.71, volume: 567000, endDays: 1, createdDays: 0 },
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

    // Oracle-resolved markets (btc-weather category)
    await client2.query(`
      INSERT INTO market_resolution (market_id, resolution_type, oracle_pair, target_price)
      VALUES ($1, $2, $3, $4) ON CONFLICT (market_id) DO NOTHING
    `, ['bw-001', 'price_above', 'BTC/USD', 100000]);
    await client2.query(`
      INSERT INTO market_resolution (market_id, resolution_type, oracle_pair, target_price)
      VALUES ($1, $2, $3, $4) ON CONFLICT (market_id) DO NOTHING
    `, ['bw-002', 'price_below', 'BTC/USD', 95000]);
    await client2.query(`
      INSERT INTO market_resolution (market_id, resolution_type, oracle_pair, target_price)
      VALUES ($1, $2, $3, $4) ON CONFLICT (market_id) DO NOTHING
    `, ['bw-003', 'price_above', 'BNB/USD', 700]);

    // Manual-resolved markets
    const manualIds = MARKETS.filter(m => !['bw-001', 'bw-002', 'bw-003'].includes(m.id)).map(m => m.id);
    for (const id of manualIds) {
      await client2.query(`
        INSERT INTO market_resolution (market_id, resolution_type, oracle_pair, target_price)
        VALUES ($1, $2, $3, $4) ON CONFLICT (market_id) DO NOTHING
      `, [id, 'manual', null, null]);
    }

    await client2.query('COMMIT');
  } catch (err) {
    await client2.query('ROLLBACK');
    throw err;
  } finally {
    client2.release();
  }

  // Set 2 markets to expired for Keeper testing
  await pool.query('UPDATE markets SET end_time = $1 WHERE id = $2', [Date.now() - 60000, 'bw-001']);
  await pool.query('UPDATE markets SET end_time = $1 WHERE id = $2', [Date.now() - 60000, 'fun-001']);

  console.log('Seeded market_resolution data and set 2 markets as expired for Keeper testing.');

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
      let yesPrice = market.yes_price;
      let noPrice = market.no_price;

      for (let i = 168; i >= 0; i--) {
        const timestamp = new Date(now - i * HOUR).toISOString();
        const volume = Math.random() * 500 + 50;

        const drift = (Math.random() - 0.5) * 0.04;
        yesPrice = Math.max(0.05, Math.min(0.95, yesPrice + drift));
        noPrice = 1 - yesPrice;

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
  { id: 'agent-001', name: 'Alpha猎手', owner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8', strategy: 'aggressive', desc: '高风险高回报，专注极端价格', balance: 2450, trades: 32, wins: 15, profit: 450, roi: 45, level: 4, exp: 320 },
  { id: 'agent-002', name: '稳赢机器人', owner: '0x8f9e3d7a2b1c4e5f6a7b8c9d0e1f2a3b4c5d6e7f', strategy: 'conservative', desc: '低风险稳定收益，长期主义', balance: 1120, trades: 89, wins: 58, profit: 120, roi: 12, level: 6, exp: 890 },
  { id: 'agent-003', name: '反指大师', owner: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', strategy: 'contrarian', desc: '逆势操作，众人恐惧我贪婪', balance: 1280, trades: 45, wins: 26, profit: 280, roi: 28, level: 3, exp: 450 },
  { id: 'agent-004', name: '趋势追踪者', owner: '0x9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d', strategy: 'momentum', desc: '顺势而为，趋势是朋友', balance: 1350, trades: 56, wins: 33, profit: 350, roi: 35, level: 4, exp: 560 },
  { id: 'agent-005', name: '随机漫步', owner: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e', strategy: 'random', desc: '随机决策，市场实验', balance: 950, trades: 23, wins: 11, profit: -50, roi: -5, level: 2, exp: 230 },
];

const MARKET_IDS = ['fm-001', 'fm-002', 'fm-003', 'ma-001', 'ma-002', 'ma-003', 'nr-001', 'nr-002', 'oc-001', 'oc-002', 'bw-001', 'bw-002'];

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

      // Insert 5~10 trades per agent
      const tradeCount = 5 + Math.floor(Math.random() * 6);
      for (let i = 0; i < tradeCount; i++) {
        const mid = MARKET_IDS[Math.floor(Math.random() * MARKET_IDS.length)];
        const side = Math.random() > 0.5 ? 'yes' : 'no';
        const amount = Math.round((10 + Math.random() * 90) * 100) / 100;
        const price = Math.round((0.2 + Math.random() * 0.6) * 10000) / 10000;
        const shares = Math.round((amount / price) * 100) / 100;
        const won = Math.random() < (a.wins / Math.max(a.trades, 1));
        const outcome = won ? 'win' : 'loss';
        const profit = won ? Math.round((amount * (1 / price - 1)) * 100) / 100 : -amount;
        const tradeTime = now - Math.floor(Math.random() * 5 * 86400000);

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
      const categoryStats = JSON.stringify({
        'meme-arena': { total: Math.floor(a.trades * 0.3), correct: Math.floor(a.wins * 0.3) },
        'btc-weather': { total: Math.floor(a.trades * 0.2), correct: Math.floor(a.wins * 0.25) },
        'four-meme': { total: Math.floor(a.trades * 0.2), correct: Math.floor(a.wins * 0.2) },
        'narrative': { total: Math.floor(a.trades * 0.15), correct: Math.floor(a.wins * 0.15) },
        'on-chain': { total: Math.floor(a.trades * 0.15), correct: Math.floor(a.wins * 0.1) },
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
];

interface SeedComment {
  marketId: string;
  comments: string[];
}

const SEED_COMMENTS: SeedComment[] = [
  {
    marketId: 'fm-001',
    comments: [
      '感觉今天内盘会很活跃，看好毕业！',
      '上一个毕业币我没赶上，这次一定要冲',
      '概率还是挺高的，最近内盘太猛了',
      '观望中，等确认信号再进',
    ],
  },
  {
    marketId: 'fm-002',
    comments: [
      '5个有点难，但这周势头确实猛',
      '上周才4个，这周想突破得看市场情绪',
      '我觉得能到，最近四meme热度太高了',
    ],
  },
  {
    marketId: 'ma-001',
    comments: [
      'PEPE生态最近太猛了，看好青蛙',
      'DOGE有马斯克加持，不能小看',
      '两边都买了一点，对冲一下',
      '经典对决，我押PEPE',
      '感觉这波DOGE要翻身',
    ],
  },
  {
    marketId: 'bw-001',
    comments: [
      '大饼冲10万就是时间问题',
      '今天看盘面有点犹豫，不敢重仓',
      '坚定看多，牛市还没结束',
      '小心回调，设好止损',
    ],
  },
  {
    marketId: 'nr-001',
    comments: [
      'AI赛道长期看好，Q1肯定没问题',
      '已经有点疲态了，不太确定',
      '大模型竞赛还在继续，热度不会这么快消退',
      '关注一下具体项目基本面再说',
      '我重仓YES了，AI叙事至少再火半年',
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
        const likes = Math.floor(Math.random() * 8);
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

// Allow running directly
if (require.main === module) {
  (async () => {
    const pool = await initDatabase();
    await seedMarkets(pool);
    await seedAgents(pool);
    await seedComments(pool);
    console.log('Seed complete.');
    process.exit(0);
  })().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
