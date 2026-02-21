-- Seed markets for flip-predict (2026-02-21)
-- Categories: four-meme, flap, nfa (no hackathon)
BEGIN;

-- Helper: compute reserves from yesPrice
-- yesPrice → noReserve = yesPrice * 20000, yesReserve = 20000 - noReserve
-- Prices: yesPrice = noReserve/(yesReserve+noReserve), noPrice = yesReserve/(yesReserve+noReserve)

-- ==================== four-meme (12) ====================
INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at)
VALUES
('fm-001', '2月21日 Four.meme 毕业代币数量是否超过 30 个？', 'Four.meme 日均毕业 50-150 个代币，bonding curve 达到 24 BNB 即自动毕业到 PancakeSwap。低于 30 个通常意味着市场极度冷清。周六链上活跃度可能偏低。以 Dune Analytics Four.meme Dashboard 当日 UTC 0:00-23:59 数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.82, 0.18, 1180000, 10000, 3600, 16400, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-002', '2月21日 Four.meme 毕业代币数量是否超过 80 个？', '80 个毕业是 Four.meme 的中等活跃水平。周末通常低于工作日平均值。近 7 日有 4 天超过 80，3 天低于 80。以 Dune Analytics 当日数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.48, 0.52, 1010000, 10000, 10400, 9600, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-003', '2月22日 Four.meme 毕业代币数量是否超过 60 个？', '周日通常是链上活跃度的低谷。过去 4 个周日平均毕业 62 个，但波动较大（最低 38，最高 91）。60 个是中等预期。以 Dune Analytics 数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '2 days')::BIGINT * 1000, 'active', 0.55, 0.45, 580000, 10000, 9000, 11000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-004', '2月23日 Four.meme 毕业代币是否超过 100 个？', '周日链上活跃度偏低，100 个是较高目标。过去 4 个周日最高 91 个。除非突发 FOMO 叙事，否则较难达到。以 Dune Analytics 数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.25, 0.75, 490000, 10000, 15000, 5000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-005', '2月24日 Four.meme 毕业代币是否超过 100 个？', '周一通常迎来链上活跃度回升。如果周末有新叙事发酵，周一容易出现毕业高峰。过去 4 个周一平均毕业 95 个。以 Dune Analytics 数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '4 days')::BIGINT * 1000, 'active', 0.47, 0.53, 640000, 10000, 10600, 9400, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-006', '2月25日 Four.meme 毕业代币是否超过 80 个？', '周二历史平均毕业约 88 个，属于正常偏高水平。BNB 价格走势和 BSC 整体热度是关键影响因素。以 Dune Analytics 数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '5 days')::BIGINT * 1000, 'active', 0.58, 0.42, 400000, 10000, 8400, 11600, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-007', '本周 (2/17-2/23) Four.meme 毕业代币总数是否超过 500 个？', '日均 50-150 计算，本周 7 天合计需日均 71+。截至 2/20 已毕业约 350 个，剩余 3 天需 150+（日均 50），难度不大。以 Dune Analytics 周统计数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.75, 0.25, 1480000, 10000, 5000, 15000, (EXTRACT(EPOCH FROM NOW())::BIGINT - 172800) * 1000),
('fm-008', '本周 (2/17-2/23) Four.meme 毕业代币总数是否超过 700 个？', '700 需要日均 100+，属于较高水平。截至 2/20 已毕业约 350 个，剩 3 天需 350+（日均 117），有一定挑战。以 Dune Analytics 周统计数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.32, 0.68, 890000, 10000, 13600, 6400, (EXTRACT(EPOCH FROM NOW())::BIGINT - 172800) * 1000),
('fm-009', '下周 (2/24-3/2) Four.meme 毕业代币总数是否超过 600 个？', '下周 BSC 生态进入常态化运行，600 需日均 85+，为中等偏高水平。BNB 价格走势将直接影响 Meme 热度。以 Dune Analytics 周统计数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '10 days')::BIGINT * 1000, 'active', 0.50, 0.50, 740000, 10000, 10000, 10000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-010', '下周 (2/24-3/2) Four.meme 毕业代币总数是否超过 1000 个？', '1000 需日均 143+，接近历史高峰水平。除非出现 Meme Season 级别的 FOMO 行情，否则很难达到。以 Dune Analytics 周统计数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '10 days')::BIGINT * 1000, 'active', 0.15, 0.85, 1080000, 10000, 17000, 3000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fm-011', '本周 Four.meme 毕业率是否超过 2%？', '毕业率 = 毕业数 / 新创建数。历史平均约 1.3%，近期最高达 1.75%。超过 2% 意味着质量项目比例显著提升。以 Dune Analytics 毕业率图表为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.28, 0.72, 620000, 10000, 14400, 5600, (EXTRACT(EPOCH FROM NOW())::BIGINT - 86400) * 1000),
('fm-012', '2月21日 Four.meme 新创建代币数量是否超过 10,000 个？', '10,000+ 创建量标志着 Meme 热潮回归，2025 年 10 月曾连续多日达到此水平。当前日均约 5,000-8,000。周六可能偏低。以 Dune Analytics 当日数据为准。', 'four-meme', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.30, 0.70, 520000, 10000, 14000, 6000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000);

-- ==================== flap (10) ====================
INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at)
VALUES
('fl-001', '2月21日 Flap 毕业代币数量是否超过 5 个？', 'Flap 是 BSC 上的 Meme 代币发射平台，bonding curve 达到 16 BNB 即自动毕业到 PancakeSwap V3。平台规模较小，日均毕业约 3-15 个。5 个是较低阈值。以 Flap Board 当日数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.75, 0.25, 480000, 10000, 5000, 15000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-002', '2月21日 Flap 毕业代币数量是否超过 10 个？', '10 个毕业是 Flap 的中等偏高水平。平台日均毕业约 3-15 个，周六活跃度可能偏低。以 Flap Board 当日 Listed on Dex 数量为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.40, 0.60, 370000, 10000, 12000, 8000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-003', '2月22日 Flap 毕业代币数量是否超过 8 个？', '周日链上活跃度通常下降。Flap 周日毕业量可能低于工作日。8 个是周日的中等预期。以 Flap Board 数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '2 days')::BIGINT * 1000, 'active', 0.45, 0.55, 250000, 10000, 11000, 9000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-004', '2月24日 Flap 毕业代币是否超过 10 个？', '周一回暖期。如果周末有新叙事（如新 Tax Vault 模板上线），周一可能迎来毕业小高峰。以 Flap Board 数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '4 days')::BIGINT * 1000, 'active', 0.42, 0.58, 220000, 10000, 11600, 8400, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-005', '2月21日 Flap 毕业代币数量是否超过 20 个？', '20+ 毕业属于 Flap 的高峰水平，通常只在 BSC Meme 热潮期间出现。PreLaunch 功能是否带来更多优质项目？以 Flap Board 当日数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.15, 0.85, 310000, 10000, 17000, 3000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-006', '本周 (2/17-2/23) Flap 毕业代币总数是否超过 50 个？', 'Flap 日均毕业 3-15 个，7 天合计需日均 7+。50 个是中等偏高的一周目标。以 Flap Board 周统计数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.58, 0.42, 580000, 10000, 8400, 11600, (EXTRACT(EPOCH FROM NOW())::BIGINT - 172800) * 1000),
('fl-007', '本周 (2/17-2/23) Flap 毕业代币总数是否超过 100 个？', '100 个需日均 14+，接近 Flap 的上限水平。除非出现 BSC Meme 热潮，否则难以达到。以 Flap Board 数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.18, 0.82, 430000, 10000, 16400, 3600, (EXTRACT(EPOCH FROM NOW())::BIGINT - 172800) * 1000),
('fl-008', '下周 (2/24-3/2) Flap 毕业代币总数是否超过 80 个？', 'BSC 生态进入常态运行。PreLaunch 功能持续吸引新项目。80 个需日均 11+。以 Flap Board 数据为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '10 days')::BIGINT * 1000, 'active', 0.35, 0.65, 350000, 10000, 13000, 7000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-009', '2月21日 Flap 新创建代币数量是否超过 200 个？', 'Flap 日均创建量约 100-500 个，远低于 Four.meme。200 个是中等水平。Tax as Funds 功能是否吸引更多创作者？以 Flap Board Newly Created 数量为准。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.50, 0.50, 260000, 10000, 10000, 10000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('fl-010', '本周 Flap 毕业率是否超过 5%？', 'Flap 毕业率 (毕业数/创建数) 通常高于 Four.meme (约 1.3%)，因为 Tax Token 机制吸引更认真的项目方。5% 是较高目标。以 Flap Board 数据计算。', 'flap', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.28, 0.72, 230000, 10000, 14400, 5600, (EXTRACT(EPOCH FROM NOW())::BIGINT - 86400) * 1000);

-- ==================== nfa (10) ====================
INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at)
VALUES
('nf-001', '2月21日 NFA Agent 总交易量是否超过 500 笔？', 'NFA (Non-Fungible Agent) 系统中的 ERC-721 Agent 支持 5 种策略类型，日均交易量约 200-600 笔。500 笔是中等偏高水平。周六交易量可能偏低。以 Flip Platform Dashboard 当日数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.50, 0.50, 640000, 10000, 10000, 10000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('nf-002', '2月21日 NFA Agent 预测总数是否超过 200 次？', 'NFA Agent 可以对市场进行自动预测记录。当前平台共有约 80 个活跃 Agent，日均预测约 120-250 次。200 次需要大部分 Agent 处于活跃状态。以 Flip Platform Dashboard 数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '1 day')::BIGINT * 1000, 'active', 0.48, 0.52, 420000, 10000, 10400, 9600, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('nf-003', '本周 NFA Agent 排行榜 Top1 准确率是否超过 70%？', '排行榜 Top1 Agent 通常准确率在 55%-75% 之间。超过 70% 意味着表现极为出色，接近最优策略水平。以 Flip Platform Dashboard 本周排行数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.40, 0.60, 820000, 10000, 12000, 8000, (EXTRACT(EPOCH FROM NOW())::BIGINT - 86400) * 1000),
('nf-004', '本周新铸造 NFA Agent 数量是否超过 50 个？', 'NFA Agent 采用 Free Mint 模式，每个地址最多 3 个。BSC 生态关注度持续提升，可能带动 Agent 铸造量。以 Flip Platform Dashboard 数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.35, 0.65, 510000, 10000, 13000, 7000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('nf-005', '本周 NFA Agent 平均收益率是否为正？', '所有活跃 NFA Agent 在本周的平均收益率。正收益意味着 Agent 策略整体有效。以 Flip Platform Dashboard 数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.52, 0.48, 710000, 10000, 9600, 10400, (EXTRACT(EPOCH FROM NOW())::BIGINT - 86400) * 1000),
('nf-006', '本周 NFA 跟单交易关注者是否超过 100 人？', 'NFA Agent 支持跟单功能，用户可以自动复制 Top Agent 的交易策略。当前跟单总人数约 60 人。新用户涌入可能推高这个数字。以 Flip Platform Dashboard 数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.30, 0.70, 380000, 10000, 14000, 6000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('nf-007', '本周是否有 NFA Agent 达成 5 连胜？', '5 连胜要求 Agent 连续 5 次预测全部正确。按平均 60% 准确率计算，5 连胜概率约 7.8%。但高水平 Agent 准确率可达 70%+。以 Flip Platform Dashboard 连胜记录为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT * 1000, 'active', 0.42, 0.58, 560000, 10000, 11600, 8400, (EXTRACT(EPOCH FROM NOW())::BIGINT - 86400) * 1000),
('nf-008', 'NFA Agent 市场上架总数是否超过 30 个？', 'NFA Agent 支持出售和出租。当前市场上架约 15 个 Agent。随着平台用户增长和 Agent 价值被认可，上架数量可能增加。以 Flip Platform Dashboard Agent 市场数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '5 days')::BIGINT * 1000, 'active', 0.25, 0.75, 290000, 10000, 15000, 5000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('nf-009', '下周 (2/24-3/2) NFA Agent 总交易量是否超过 3000 笔？', 'BSC 生态进入常态运行，用户关注 NFA Agent 交易功能。日均 500 笔计算，7 天 3500 笔。以 Flip Platform Dashboard 数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '10 days')::BIGINT * 1000, 'active', 0.45, 0.55, 480000, 10000, 11000, 9000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
('nf-010', '下周 (2/24-3/2) 激进策略 Agent 收益率是否跑赢稳健策略？', '激进策略偏好高风险高回报，稳健策略追求稳定收益。在波动较大的市场中激进策略通常占优。市场波动方向不确定。以 Flip Platform Dashboard 策略对比数据为准。', 'nfa', EXTRACT(EPOCH FROM NOW() + INTERVAL '10 days')::BIGINT * 1000, 'active', 0.55, 0.45, 590000, 10000, 9000, 11000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000);

-- Seed market_resolution for all markets
INSERT INTO market_resolution (market_id, resolution_type) VALUES
('fm-001', 'manual'), ('fm-002', 'manual'), ('fm-003', 'manual'), ('fm-004', 'manual'),
('fm-005', 'manual'), ('fm-006', 'manual'), ('fm-007', 'manual'), ('fm-008', 'manual'),
('fm-009', 'manual'), ('fm-010', 'manual'), ('fm-011', 'manual'), ('fm-012', 'manual'),
('fl-001', 'manual'), ('fl-002', 'manual'), ('fl-003', 'manual'), ('fl-004', 'manual'),
('fl-005', 'manual'), ('fl-006', 'manual'), ('fl-007', 'manual'), ('fl-008', 'manual'),
('fl-009', 'manual'), ('fl-010', 'manual'),
('nf-001', 'manual'), ('nf-002', 'manual'), ('nf-003', 'manual'), ('nf-004', 'manual'),
('nf-005', 'manual'), ('nf-006', 'manual'), ('nf-007', 'manual'), ('nf-008', 'manual'),
('nf-009', 'manual'), ('nf-010', 'manual');

-- Verify
SELECT COUNT(*) AS total_markets FROM markets;
SELECT category, COUNT(*) AS count FROM markets GROUP BY category ORDER BY category;

COMMIT;
