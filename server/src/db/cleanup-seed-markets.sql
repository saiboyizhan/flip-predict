-- ============================================
-- Cleanup seed markets with no on_chain_market_id
-- These markets were seeded for demo purposes but have no on-chain backing,
-- making them impossible to settle. Safe to delete: 0 orders, 0 positions.
-- Run once: psql -f cleanup-seed-markets.sql
-- ============================================

BEGIN;

-- Identify target market IDs
CREATE TEMP TABLE _seed_market_ids AS
  SELECT id FROM markets WHERE on_chain_market_id IS NULL;

-- Delete from child tables first (FK constraints)
DELETE FROM agent_trades       WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM price_history       WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM market_resolution   WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM comments            WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM settlement_log      WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM user_created_markets WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM market_options      WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM option_price_history WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM user_favorites      WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM resolution_proposals WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM resolution_challenges WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM orders              WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM positions           WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM open_orders         WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM fee_records         WHERE market_id IN (SELECT id FROM _seed_market_ids);
DELETE FROM copy_trades         WHERE market_id IN (SELECT id FROM _seed_market_ids);

-- Delete the seed markets themselves
DELETE FROM markets WHERE id IN (SELECT id FROM _seed_market_ids);

-- Cleanup
DROP TABLE _seed_market_ids;

-- Verify
SELECT COUNT(*) AS remaining_null_on_chain FROM markets WHERE on_chain_market_id IS NULL;

COMMIT;
