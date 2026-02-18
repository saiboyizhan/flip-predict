CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  nonce TEXT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  on_chain_market_id BIGINT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  end_time BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  yes_price DOUBLE PRECISION DEFAULT 0.5,
  no_price DOUBLE PRECISION DEFAULT 0.5,
  volume DOUBLE PRECISION DEFAULT 0,
  total_liquidity DOUBLE PRECISION DEFAULT 10000,
  yes_reserve DOUBLE PRECISION DEFAULT 10000,
  no_reserve DOUBLE PRECISION DEFAULT 10000,
  created_at BIGINT NOT NULL
);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS on_chain_market_id BIGINT;

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  shares DOUBLE PRECISION,
  price DOUBLE PRECISION,
  status TEXT DEFAULT 'filled',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  shares DOUBLE PRECISION NOT NULL,
  avg_cost DOUBLE PRECISION NOT NULL,
  created_at BIGINT,
  UNIQUE(user_address, market_id, side)
);

CREATE TABLE IF NOT EXISTS balances (
  user_address TEXT PRIMARY KEY,
  available DOUBLE PRECISION DEFAULT 0,
  locked DOUBLE PRECISION DEFAULT 0
);

CREATE TABLE IF NOT EXISTS open_orders (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  order_side TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  cost_basis DOUBLE PRECISION,
  amount DOUBLE PRECISION NOT NULL,
  filled DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_at BIGINT NOT NULL
);
ALTER TABLE open_orders ADD COLUMN IF NOT EXISTS cost_basis DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_open_orders_market ON open_orders(market_id, side, status);
CREATE INDEX IF NOT EXISTS idx_open_orders_user ON open_orders(user_address, status);

CREATE TABLE IF NOT EXISTS market_resolution (
  market_id TEXT PRIMARY KEY,
  resolution_type TEXT DEFAULT 'manual',
  oracle_pair TEXT,
  target_price DOUBLE PRECISION,
  resolved_price DOUBLE PRECISION,
  outcome TEXT,
  resolved_at BIGINT,
  resolved_by TEXT,
  winning_option_id TEXT,
  rule_text TEXT,
  data_source_url TEXT,
  resolution_time_utc BIGINT,
  evidence_url TEXT,
  evidence_hash TEXT,
  resolve_tx_hash TEXT,
  proposer_address TEXT,
  proposed_outcome TEXT,
  proposed_winning_option_id TEXT,
  proposed_at BIGINT,
  challenge_window_ends_at BIGINT
);

CREATE TABLE IF NOT EXISTS settlement_log (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  action TEXT NOT NULL,
  user_address TEXT,
  amount DOUBLE PRECISION,
  details JSONB,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS resolution_proposals (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  proposed_by TEXT NOT NULL,
  proposed_outcome TEXT,
  proposed_winning_option_id TEXT,
  notes TEXT,
  evidence_url TEXT,
  evidence_hash TEXT,
  source_url TEXT,
  resolve_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  challenge_window_ends_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  finalized_at BIGINT,
  finalized_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_resolution_proposals_market ON resolution_proposals(market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolution_proposals_status ON resolution_proposals(status, challenge_window_ends_at);

CREATE TABLE IF NOT EXISTS resolution_challenges (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  proposal_id TEXT NOT NULL REFERENCES resolution_proposals(id),
  challenger_address TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_url TEXT,
  evidence_hash TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resolution_challenges_market ON resolution_challenges(market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolution_challenges_proposal ON resolution_challenges(proposal_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolution_challenges_unique_per_address
  ON resolution_challenges(proposal_id, LOWER(challenger_address));

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  avatar TEXT,
  strategy TEXT DEFAULT 'conservative',
  description TEXT,
  status TEXT DEFAULT 'active',
  wallet_balance DOUBLE PRECISION DEFAULT 1000,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  total_profit DOUBLE PRECISION DEFAULT 0,
  win_rate DOUBLE PRECISION DEFAULT 0,
  roi DOUBLE PRECISION DEFAULT 0,
  level INTEGER DEFAULT 1,
  experience INTEGER DEFAULT 0,
  is_for_sale INTEGER DEFAULT 0,
  sale_price DOUBLE PRECISION,
  is_for_rent INTEGER DEFAULT 0,
  rent_price DOUBLE PRECISION,
  rented_by TEXT,
  rent_expires BIGINT,
  token_id BIGINT,
  mint_tx_hash TEXT,
  persona TEXT,
  voice_hash TEXT,
  animation_uri TEXT,
  prediction_mode TEXT DEFAULT 'observe',
  auto_trade_enabled INTEGER DEFAULT 0,
  max_per_trade DOUBLE PRECISION DEFAULT 100,
  max_daily_amount DOUBLE PRECISION DEFAULT 500,
  daily_trade_used DOUBLE PRECISION DEFAULT 0,
  auto_trade_expires BIGINT,
  reputation_score DOUBLE PRECISION DEFAULT 0,
  style_root TEXT,
  vault_uri TEXT,
  vault_hash TEXT,
  created_at BIGINT NOT NULL,
  last_trade_at BIGINT
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_id BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mint_tx_hash TEXT;
DO $$ BEGIN
  ALTER TABLE agents ALTER COLUMN token_id TYPE BIGINT USING token_id::bigint;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_trades (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  shares DOUBLE PRECISION,
  price DOUBLE PRECISION,
  outcome TEXT,
  profit DOUBLE PRECISION,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_trades_agent ON agent_trades(agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_token_id_unique
  ON agents(token_id)
  WHERE token_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_mint_tx_hash_unique
  ON agents ((LOWER(mint_tx_hash)))
  WHERE mint_tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  yes_price DOUBLE PRECISION NOT NULL,
  no_price DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION DEFAULT 0,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_history_market ON price_history(market_id, timestamp);

-- ============================================
-- BAP-578 Agent 扩展 + 用户创建市场
-- ============================================

-- Agent predictions 预测记录
CREATE TABLE IF NOT EXISTS agent_predictions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  prediction TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  reasoning TEXT,
  actual_outcome TEXT,
  is_correct INTEGER,
  category TEXT,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_agent_predictions_agent ON agent_predictions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_predictions_market ON agent_predictions(market_id);

-- Agent style profile 风格画像
CREATE TABLE IF NOT EXISTS agent_style_profile (
  agent_id TEXT PRIMARY KEY,
  category_stats JSONB DEFAULT '{}',
  risk_preference DOUBLE PRECISION DEFAULT 0.5,
  confidence_calibration DOUBLE PRECISION DEFAULT 0,
  contrarian_tendency DOUBLE PRECISION DEFAULT 0,
  streak_current INTEGER DEFAULT 0,
  streak_best INTEGER DEFAULT 0,
  learning_root TEXT,
  updated_at BIGINT
);

-- Agent trade suggestions 交易建议
CREATE TABLE IF NOT EXISTS agent_trade_suggestions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  suggested_side TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  reasoning TEXT,
  risk_level TEXT DEFAULT 'medium',
  potential_profit DOUBLE PRECISION,
  potential_loss DOUBLE PRECISION,
  user_action TEXT,
  created_at BIGINT NOT NULL,
  acted_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_suggestions_agent ON agent_trade_suggestions(agent_id);

-- User created markets 用户创建市场追踪
CREATE TABLE IF NOT EXISTS user_created_markets (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL UNIQUE,
  creator_address TEXT NOT NULL,
  creation_fee DOUBLE PRECISION NOT NULL DEFAULT 10,
  create_tx_hash TEXT,
  flag_count INTEGER DEFAULT 0,
  flagged_by JSONB DEFAULT '[]',
  status TEXT DEFAULT 'active',
  created_at BIGINT NOT NULL
);
ALTER TABLE user_created_markets ADD COLUMN IF NOT EXISTS create_tx_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_user_markets_creator ON user_created_markets(creator_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_created_markets_create_tx_hash
  ON user_created_markets ((LOWER(create_tx_hash)))
  WHERE create_tx_hash IS NOT NULL;

-- Market creation ratelimit 创建频率限制
CREATE TABLE IF NOT EXISTS market_creation_ratelimit (
  user_address TEXT PRIMARY KEY,
  daily_count INTEGER DEFAULT 0,
  last_reset_day INTEGER NOT NULL,
  total_created INTEGER DEFAULT 0
);

-- Comments 评论系统
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  user_address TEXT NOT NULL,
  content TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  liked_by JSONB DEFAULT '[]',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_market ON comments(market_id, created_at);

-- ============================================
-- 通知系统
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_address, is_read, created_at);

-- ============================================
-- 邀请/奖励系统
-- ============================================
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_address TEXT NOT NULL,
  referee_address TEXT NOT NULL,
  reward_amount DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_address);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rewards_user ON rewards(user_address);

-- ============================================
-- 手续费追踪
-- ============================================
CREATE TABLE IF NOT EXISTS fee_records (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  market_id TEXT,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fee_records_user ON fee_records(user_address);

-- ============================================
-- 充值/提现记录
-- ============================================
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  tx_hash TEXT,
  status TEXT DEFAULT 'completed',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_address);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  to_address TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_address);

-- ============================================
-- 成就系统
-- ============================================
CREATE TABLE IF NOT EXISTS user_achievements (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at BIGINT NOT NULL,
  UNIQUE(user_address, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements ON user_achievements(user_address);

-- ============================================
-- Performance indexes (M1)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_address);
CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
-- Bug D30 Fix: Composite index for portfolio history queries (ORDER BY created_at DESC LIMIT/OFFSET).
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address);
CREATE INDEX IF NOT EXISTS idx_markets_status_endtime ON markets(status, end_time);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_markets_on_chain_market_id
  ON markets(on_chain_market_id)
  WHERE on_chain_market_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_log_market_user ON settlement_log(market_id, user_address, action);
CREATE INDEX IF NOT EXISTS idx_deposits_txhash ON deposits(tx_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_txhash_unique ON deposits ((LOWER(tx_hash))) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_address);
CREATE INDEX IF NOT EXISTS idx_open_orders_market ON open_orders(market_id, status);

-- Bug D14 Fix: Composite index for orderbook matching queries which filter on
-- (market_id, side, order_side, status) and ORDER BY price. Without this, the
-- matching engine performs sequential scans on large open_orders tables.
CREATE INDEX IF NOT EXISTS idx_open_orders_matching
  ON open_orders(market_id, side, order_side, status, price);

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referee_unique
    ON referrals ((LOWER(referee_address))) WHERE referee_address IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_log_claim_unique
    ON settlement_log (market_id, user_address)
    WHERE action = 'claimed' AND user_address IS NOT NULL;
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- ============================================
-- Foreign key constraints (M3)
-- ============================================
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT fk_orders_market FOREIGN KEY (market_id) REFERENCES markets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_address) REFERENCES users(address);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE positions ADD CONSTRAINT fk_positions_market FOREIGN KEY (market_id) REFERENCES markets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE positions ADD CONSTRAINT fk_positions_user FOREIGN KEY (user_address) REFERENCES users(address);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE agent_trades ADD CONSTRAINT fk_agent_trades_agent FOREIGN KEY (agent_id) REFERENCES agents(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE market_resolution ADD CONSTRAINT fk_market_resolution_market FOREIGN KEY (market_id) REFERENCES markets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE settlement_log ADD CONSTRAINT fk_settlement_log_market FOREIGN KEY (market_id) REFERENCES markets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE comments ADD CONSTRAINT fk_comments_market FOREIGN KEY (market_id) REFERENCES markets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE fee_records ADD CONSTRAINT fk_fee_records_user FOREIGN KEY (user_address) REFERENCES users(address);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE deposits ADD CONSTRAINT fk_deposits_user FOREIGN KEY (user_address) REFERENCES users(address);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE withdrawals ADD CONSTRAINT fk_withdrawals_user FOREIGN KEY (user_address) REFERENCES users(address);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- Phase 12A: 多选项市场
-- ============================================
ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_type TEXT DEFAULT 'binary';

CREATE TABLE IF NOT EXISTS market_options (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  option_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  color TEXT,
  reserve DOUBLE PRECISION DEFAULT 10000,
  price DOUBLE PRECISION DEFAULT 0.5,
  UNIQUE(market_id, option_index)
);
CREATE INDEX IF NOT EXISTS idx_market_options_market ON market_options(market_id);

CREATE TABLE IF NOT EXISTS option_price_history (
  id SERIAL PRIMARY KEY,
  market_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION DEFAULT 0,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_option_price_history_market ON option_price_history(market_id, timestamp);

ALTER TABLE positions ADD COLUMN IF NOT EXISTS option_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS option_id TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS winning_option_id TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS rule_text TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS data_source_url TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS resolution_time_utc BIGINT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS evidence_url TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS evidence_hash TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS resolve_tx_hash TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS proposer_address TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS proposed_outcome TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS proposed_winning_option_id TEXT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS proposed_at BIGINT;
ALTER TABLE market_resolution ADD COLUMN IF NOT EXISTS challenge_window_ends_at BIGINT;
ALTER TABLE agent_trades ADD COLUMN IF NOT EXISTS option_id TEXT;

-- ============================================
-- Phase 12B: 社交系统
-- ============================================
CREATE TABLE IF NOT EXISTS user_profiles (
  address TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS user_follows (
  id TEXT PRIMARY KEY,
  follower_address TEXT NOT NULL,
  followed_address TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(follower_address, followed_address),
  CHECK (follower_address != followed_address)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_address);
CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_address);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id TEXT;

-- ============================================
-- Phase 12C: Agent 跟单 + 组合策略 + 收益分成
-- ============================================
CREATE TABLE IF NOT EXISTS agent_followers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  follower_address TEXT NOT NULL,
  copy_percentage DOUBLE PRECISION DEFAULT 100,
  max_per_trade DOUBLE PRECISION DEFAULT 100,
  daily_limit DOUBLE PRECISION DEFAULT 500,
  daily_used DOUBLE PRECISION DEFAULT 0,
  revenue_share_pct DOUBLE PRECISION DEFAULT 10,
  status TEXT DEFAULT 'active',
  created_at BIGINT NOT NULL,
  UNIQUE(agent_id, follower_address)
);
CREATE INDEX IF NOT EXISTS idx_agent_followers_agent ON agent_followers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_followers_follower ON agent_followers(follower_address);

CREATE TABLE IF NOT EXISTS copy_trades (
  id TEXT PRIMARY KEY,
  follower_address TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_trade_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  option_id TEXT,
  amount DOUBLE PRECISION NOT NULL,
  shares DOUBLE PRECISION,
  price DOUBLE PRECISION,
  status TEXT DEFAULT 'open',
  outcome TEXT,
  profit DOUBLE PRECISION,
  revenue_share DOUBLE PRECISION DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copy_trades_follower ON copy_trades(follower_address);
CREATE INDEX IF NOT EXISTS idx_copy_trades_agent ON copy_trades(agent_id);

CREATE TABLE IF NOT EXISTS agent_earnings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  source TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  follower_address TEXT,
  claimed INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_earnings_agent ON agent_earnings(agent_id);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS combo_weights JSONB DEFAULT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS learn_from_owner INTEGER DEFAULT 0;

-- Phase 13: On-Chain Copy Trading
-- ============================================
ALTER TABLE agent_followers ADD COLUMN IF NOT EXISTS on_chain INTEGER DEFAULT 0;
ALTER TABLE copy_trades ADD COLUMN IF NOT EXISTS on_chain INTEGER DEFAULT 0;
ALTER TABLE copy_trades ADD COLUMN IF NOT EXISTS tx_hash TEXT;

-- Bug fix: Store rejection reason in a dedicated column instead of appending to description
ALTER TABLE markets ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Migration: add missing columns to copy_trades for existing databases
ALTER TABLE copy_trades ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
ALTER TABLE copy_trades ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';

-- ============================================
-- Agent Owner Learning Profile (观察学习 owner 交易)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_owner_profile (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  owner_address TEXT NOT NULL,
  total_trades INTEGER DEFAULT 0,
  yes_ratio DOUBLE PRECISION DEFAULT 0.5,
  category_weights JSONB DEFAULT '{}',
  avg_amount DOUBLE PRECISION DEFAULT 0,
  risk_score DOUBLE PRECISION DEFAULT 0.5,
  contrarian_score DOUBLE PRECISION DEFAULT 0,
  win_rate DOUBLE PRECISION DEFAULT 0,
  top_market_ids JSONB DEFAULT '[]',
  last_synced_order_at BIGINT DEFAULT 0,
  updated_at BIGINT
);

-- Migration: prevent negative balances via CHECK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_available_nonneg') THEN
    ALTER TABLE balances ADD CONSTRAINT chk_available_nonneg CHECK (available >= -0.0001);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_locked_nonneg') THEN
    ALTER TABLE balances ADD CONSTRAINT chk_locked_nonneg CHECK (locked >= -0.0001);
  END IF;
END $$;

-- ============================================
-- 市场收藏/关注系统
-- ============================================
CREATE TABLE IF NOT EXISTS user_favorites (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  market_id TEXT NOT NULL REFERENCES markets(id),
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
  UNIQUE(user_address, market_id)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_favorites_market ON user_favorites(market_id);

-- ============================================
-- NFA Agent LLM Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS agent_llm_config (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  system_prompt TEXT,
  temperature DOUBLE PRECISION DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1024,
  enabled INTEGER DEFAULT 1,
  last_used_at BIGINT,
  total_calls INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Migration: add tx_hash to withdrawals for on-chain tracking
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS tx_hash TEXT;
-- Migration: add request_tx_hash to withdrawals for user's on-chain requestWithdraw tx
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS request_tx_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_request_tx_hash
  ON withdrawals (LOWER(request_tx_hash)) WHERE request_tx_hash IS NOT NULL;

-- Migration: add permit columns for withdrawWithPermit flow
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS permit_nonce BIGINT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS permit_deadline BIGINT;

-- Round 3: Data integrity constraints
DO $$ BEGIN
  ALTER TABLE markets ADD CONSTRAINT chk_markets_yes_reserve_pos CHECK (yes_reserve > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE markets ADD CONSTRAINT chk_markets_no_reserve_pos CHECK (no_reserve > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE positions ADD CONSTRAINT chk_positions_shares_nonneg CHECK (shares >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE open_orders ADD CONSTRAINT chk_open_orders_amount_pos CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE open_orders ADD CONSTRAINT chk_open_orders_price_range CHECK (price >= 0.01 AND price <= 0.99);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Round 3: Performance indexes
CREATE INDEX IF NOT EXISTS idx_copy_trades_follower_time ON copy_trades(follower_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_log_action_time ON settlement_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_trades_market ON agent_trades(market_id);
