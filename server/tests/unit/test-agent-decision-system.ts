/**
 * Standalone component test for Agent Autonomous Decision System (Phase 1).
 * Tests: schema migration, agent-runner pending trades, agent-settlement,
 *        LLM adapter enriched queries, feedback loop.
 *
 * Run: npx tsx tests/unit/test-agent-decision-system.ts
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const TEST_DB = 'prediction_test_agent';

let pool: Pool;
let adminPool: Pool;

// ======== Helpers ========

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function log(msg: string) {
  console.log(`  [ok] ${msg}`);
}

const roundTo = (n: number, decimals: number): number => {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
};

// ======== Setup / Teardown ========

async function setup() {
  adminPool = new Pool({
    host: 'localhost', port: 5432,
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: 'postgres',
  });

  // Drop & recreate test DB
  await adminPool.query(`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()
  `).catch(() => {});
  await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await adminPool.query(`CREATE DATABASE ${TEST_DB}`);

  pool = new Pool({
    host: 'localhost', port: 5432,
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: TEST_DB,
  });

  // Apply schema
  const fs = await import('fs');
  const path = await import('path');
  const schemaPath = path.resolve(__dirname, '../../src/db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
}

async function teardown() {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()
    `).catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminPool.end();
  }
}

// ======== Seed Data ========

async function seedTestData() {
  const now = Date.now();
  const futureEnd = Math.floor(now / 1000) + 86400;

  // User
  await pool.query(
    `INSERT INTO users (address, nonce, created_at) VALUES ($1, 'test', $2)`,
    ['0xtest_owner', now]
  );

  // Markets (2 active, 1 resolved for settlement test)
  await pool.query(
    `INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at, market_type)
     VALUES
       ('m1', 'Will BTC hit 100k?', 'Bitcoin price prediction', 'flap', $1, 'active', 0.65, 0.35, 5000, 10000, 5000, 5000, $2, 'binary'),
       ('m2', 'ETH merge success?', 'Ethereum merge prediction', 'nfa', $3, 'active', 0.80, 0.20, 3000, 8000, 4000, 4000, $2, 'binary'),
       ('m3', 'SOL above 200?', 'Solana price prediction', 'four-meme', $4, 'resolved', 1, 0, 2000, 6000, 3000, 3000, $2, 'binary')`,
    [futureEnd, now, futureEnd + 3600, futureEnd - 100]
  );

  // Price history for trends
  for (let i = 0; i < 6; i++) {
    const ts = new Date(now - i * 3600 * 1000);
    await pool.query(
      `INSERT INTO price_history (market_id, yes_price, no_price, timestamp) VALUES ($1, $2, $3, $4)`,
      ['m1', 0.65 - i * 0.02, 0.35 + i * 0.02, ts]  // rising trend
    );
    await pool.query(
      `INSERT INTO price_history (market_id, yes_price, no_price, timestamp) VALUES ($1, $2, $3, $4)`,
      ['m2', 0.80 + i * 0.001, 0.20 - i * 0.001, ts]  // stable
    );
  }

  // Comments
  await pool.query(
    `INSERT INTO comments (id, market_id, user_address, content, created_at) VALUES ($1, 'm1', '0xtest_owner', 'Bullish!', $2)`,
    [randomUUID(), now]
  );
  await pool.query(
    `INSERT INTO comments (id, market_id, user_address, content, created_at) VALUES ($1, 'm1', '0xtest_owner', 'Very bullish!', $2)`,
    [randomUUID(), now]
  );

  // Agent
  await pool.query(
    `INSERT INTO agents (id, name, owner_address, strategy, wallet_balance, total_trades, winning_trades, total_profit, win_rate, roi, level, experience, created_at)
     VALUES ('agent1', 'TestBot', '0xtest_owner', 'momentum', 1000, 0, 0, 0, 0, 0, 1, 0, $1)`,
    [now]
  );

  // Owner profile
  await pool.query(
    `INSERT INTO agent_owner_profile (agent_id, owner_address, yes_ratio, risk_score, contrarian_score, updated_at)
     VALUES ('agent1', '0xtest_owner', 0.7, 0.6, 0.3, $1)`,
    [now]
  );

  // Market resolution for m3
  await pool.query(
    `INSERT INTO market_resolution (market_id, outcome, resolved_at, resolved_by)
     VALUES ('m3', 'yes', $1, 'oracle')
     ON CONFLICT (market_id) DO NOTHING`,
    [now]
  );
}

// ======== Test 1: Schema Migration ========

async function testSchema() {
  console.log('\n=== Test 1: Schema — agent_trades new columns ===');

  // Check columns exist
  const cols = await pool.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'agent_trades' AND column_name IN ('status', 'reasoning', 'settled_at')
    ORDER BY column_name
  `);

  const colMap = new Map(cols.rows.map((r: any) => [r.column_name, r]));

  assert(colMap.has('reasoning'), 'reasoning column exists');
  log('reasoning TEXT column exists');

  assert(colMap.has('settled_at'), 'settled_at column exists');
  log('settled_at BIGINT column exists');

  assert(colMap.has('status'), 'status column exists');
  const statusCol = colMap.get('status');
  assert(statusCol.column_default === "'settled'::character varying", `status default is 'settled', got: ${statusCol.column_default}`);
  log(`status column exists with default='settled'`);

  // Check index
  const idx = await pool.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'agent_trades' AND indexname = 'idx_agent_trades_market'
  `);
  assert(idx.rows.length === 1, 'idx_agent_trades_market index exists');
  log('idx_agent_trades_market index exists');
}

// ======== Test 2: Agent Runner — Pending Trades ========

async function testRunnerPendingTrades() {
  console.log('\n=== Test 2: agent-runner — pending trade creation ===');

  const { runAgentCycle } = await import('../../src/engine/agent-runner');

  // Get agent balance before
  const beforeAgent = (await pool.query('SELECT wallet_balance, total_trades FROM agents WHERE id=$1', ['agent1'])).rows[0];
  const balanceBefore = Number(beforeAgent.wallet_balance);
  assert(balanceBefore === 1000, `Initial balance should be 1000, got ${balanceBefore}`);
  log(`Agent initial balance: $${balanceBefore}`);

  // Run cycle (will use rule-based since no LLM config)
  await runAgentCycle(pool, 'agent1');

  // Check trades created
  const trades = (await pool.query(
    "SELECT * FROM agent_trades WHERE agent_id = 'agent1' ORDER BY created_at"
  )).rows;

  assert(trades.length > 0, `Should have created at least 1 trade, got ${trades.length}`);
  log(`Created ${trades.length} trade(s)`);

  for (const t of trades) {
    assert(t.status === 'pending', `Trade ${t.id} status should be 'pending', got '${t.status}'`);
    assert(t.outcome === null, `Trade ${t.id} outcome should be NULL, got '${t.outcome}'`);
    assert(t.profit === null, `Trade ${t.id} profit should be NULL, got '${t.profit}'`);
    assert(t.amount > 0, `Trade ${t.id} amount should be > 0`);
    assert(t.shares > 0, `Trade ${t.id} shares should be > 0`);
    assert(t.price > 0, `Trade ${t.id} price should be > 0`);
  }
  log('All trades have status=pending, outcome=NULL, profit=NULL');

  // Check balance deducted
  const afterAgent = (await pool.query('SELECT wallet_balance, total_trades, winning_trades, total_profit FROM agents WHERE id=$1', ['agent1'])).rows[0];
  const totalBet = trades.reduce((s: number, t: any) => s + Number(t.amount), 0);
  const expectedBalance = roundTo(balanceBefore - totalBet, 2);
  assert(
    Math.abs(Number(afterAgent.wallet_balance) - expectedBalance) < 0.02,
    `Balance should be ~${expectedBalance}, got ${afterAgent.wallet_balance}`
  );
  log(`Balance deducted: $${balanceBefore} -> $${afterAgent.wallet_balance} (bet $${totalBet.toFixed(2)})`);

  assert(Number(afterAgent.total_trades) === trades.length, `total_trades should be ${trades.length}`);
  log(`total_trades updated to ${afterAgent.total_trades}`);

  // winning_trades and total_profit should NOT be updated by runner
  assert(Number(afterAgent.winning_trades) === 0, `winning_trades should still be 0, got ${afterAgent.winning_trades}`);
  assert(Number(afterAgent.total_profit) === 0, `total_profit should still be 0, got ${afterAgent.total_profit}`);
  log('winning_trades=0, total_profit=0 (not touched by runner)');
}

// ======== Test 3: Agent Settlement ========

async function testSettlement() {
  console.log('\n=== Test 3: agent-settlement — real outcome settlement ===');

  const { settleAgentTrades } = await import('../../src/engine/agent-settlement');

  // First, insert some known pending trades for market m3 (resolved to 'yes')
  const tradeYes = randomUUID();
  const tradeNo = randomUUID();
  const now = Date.now();

  // Trade 1: bet YES at price 0.6, amount 100 -> should WIN
  await pool.query(`
    INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price, outcome, profit, status, reasoning, created_at)
    VALUES ($1, 'agent1', 'm3', 'yes', 100, 166.67, 0.6, NULL, NULL, 'pending', 'Test YES bet', $2)
  `, [tradeYes, now]);

  // Trade 2: bet NO at price 0.4, amount 50 -> should LOSE
  await pool.query(`
    INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price, outcome, profit, status, reasoning, created_at)
    VALUES ($1, 'agent1', 'm3', 'no', 50, 125, 0.4, NULL, NULL, 'pending', 'Test NO bet', $2)
  `, [tradeNo, now]);

  // Record balance before settlement
  const beforeBal = Number((await pool.query('SELECT wallet_balance FROM agents WHERE id=$1', ['agent1'])).rows[0].wallet_balance);
  log(`Balance before settlement: $${beforeBal}`);

  // Settle: market m3 outcome = 'yes'
  const settled = await settleAgentTrades(pool, 'm3', 'yes');
  assert(settled >= 2, `Should settle at least 2 trades, got ${settled}`);
  log(`Settled ${settled} trades for market m3`);

  // Check trade YES: should be win
  const tYes = (await pool.query('SELECT * FROM agent_trades WHERE id=$1', [tradeYes])).rows[0];
  assert(tYes.status === 'settled', `YES trade status should be 'settled', got '${tYes.status}'`);
  assert(tYes.outcome === 'win', `YES trade outcome should be 'win', got '${tYes.outcome}'`);
  const expectedProfit = roundTo(100 * (1 / 0.6 - 1), 2);
  assert(
    Math.abs(Number(tYes.profit) - expectedProfit) < 0.02,
    `YES trade profit should be ~${expectedProfit}, got ${tYes.profit}`
  );
  assert(tYes.settled_at !== null, 'YES trade settled_at should be set');
  log(`YES trade: outcome=win, profit=$${tYes.profit}, settled_at=${tYes.settled_at}`);

  // Check trade NO: should be loss
  const tNo = (await pool.query('SELECT * FROM agent_trades WHERE id=$1', [tradeNo])).rows[0];
  assert(tNo.status === 'settled', `NO trade status should be 'settled', got '${tNo.status}'`);
  assert(tNo.outcome === 'loss', `NO trade outcome should be 'loss', got '${tNo.outcome}'`);
  assert(Number(tNo.profit) === -50, `NO trade profit should be -50, got ${tNo.profit}`);
  log(`NO trade: outcome=loss, profit=$${tNo.profit}`);

  // Check balance: should have gained back (100 + expectedProfit) for YES win, nothing for NO loss
  const afterBal = Number((await pool.query('SELECT wallet_balance FROM agents WHERE id=$1', ['agent1'])).rows[0].wallet_balance);
  const expectedBal = roundTo(beforeBal + 100 + expectedProfit, 2);
  assert(
    Math.abs(afterBal - expectedBal) < 0.05,
    `Balance should be ~${expectedBal}, got ${afterBal}`
  );
  log(`Balance after settlement: $${afterBal} (was $${beforeBal}, gained $${roundTo(afterBal - beforeBal, 2)})`);

  // Check agent stats recalculated
  const agentStats = (await pool.query('SELECT winning_trades, total_profit, win_rate, roi FROM agents WHERE id=$1', ['agent1'])).rows[0];
  assert(Number(agentStats.winning_trades) > 0, `winning_trades should be > 0, got ${agentStats.winning_trades}`);
  assert(Number(agentStats.total_profit) !== 0, `total_profit should be non-zero, got ${agentStats.total_profit}`);
  assert(Number(agentStats.win_rate) > 0, `win_rate should be > 0, got ${agentStats.win_rate}`);
  log(`Agent stats: winning_trades=${agentStats.winning_trades}, total_profit=$${agentStats.total_profit}, win_rate=${agentStats.win_rate}%, roi=${agentStats.roi}%`);
}

// ======== Test 4: Enriched Market Query ========

async function testEnrichedMarketQuery() {
  console.log('\n=== Test 4: LLM adapter — enriched market query ===');

  // Run the same query used in agent-llm-adapter.ts
  const markets = (await pool.query(`
    SELECT m.id, m.title, m.yes_price, m.category, m.description, m.end_time,
           m.volume, m.total_liquidity as liquidity, m.total_lp_shares,
           (SELECT COUNT(*) FROM comments c WHERE c.market_id = m.id) as comment_count
    FROM markets m WHERE m.status = 'active'
  `)).rows;

  assert(markets.length >= 2, `Should have at least 2 active markets, got ${markets.length}`);
  log(`Found ${markets.length} active markets`);

  const m1 = markets.find((m: any) => m.id === 'm1');
  assert(m1 !== undefined, 'Market m1 should be active');
  assert(m1.description === 'Bitcoin price prediction', `m1 description should match, got: ${m1.description}`);
  assert(Number(m1.end_time) > 0, `m1 end_time should be > 0`);
  assert(Number(m1.volume) === 5000, `m1 volume should be 5000, got ${m1.volume}`);
  assert(Number(m1.liquidity) === 10000, `m1 liquidity should be 10000, got ${m1.liquidity}`);
  assert(Number(m1.comment_count) === 2, `m1 comment_count should be 2, got ${m1.comment_count}`);
  log(`m1: description="${m1.description}", volume=$${m1.volume}, liquidity=$${m1.liquidity}, comments=${m1.comment_count}`);
}

// ======== Test 5: Price Trends ========

async function testPriceTrends() {
  console.log('\n=== Test 5: LLM adapter — fetchPriceTrends ===');

  // Import and call directly
  // We can't easily import the private function, so replicate the logic
  const result = await pool.query(`
    SELECT market_id, yes_price, timestamp
    FROM price_history
    WHERE market_id = ANY($1)
    ORDER BY market_id, timestamp DESC
  `, [['m1', 'm2']]);

  const byMarket = new Map<string, number[]>();
  for (const row of result.rows) {
    const arr = byMarket.get(row.market_id) || [];
    arr.push(Number(row.yes_price));
    byMarket.set(row.market_id, arr);
  }

  // m1: prices go 0.65, 0.63, 0.61, 0.59, 0.57, 0.55 (newest first) -> rising (newest > oldest)
  const m1Prices = byMarket.get('m1')!;
  assert(m1Prices.length >= 5, `m1 should have >= 5 price points, got ${m1Prices.length}`);
  const m1Recent5 = m1Prices.slice(0, 5);
  const m1Diff = m1Recent5[0] - m1Recent5[m1Recent5.length - 1];
  const m1Trend = m1Diff > 0.05 ? 'rising' : m1Diff < -0.05 ? 'falling' : 'stable';
  assert(m1Trend === 'rising', `m1 trend should be 'rising', got '${m1Trend}' (diff=${m1Diff.toFixed(3)})`);
  log(`m1 trend: ${m1Trend} (diff=${m1Diff.toFixed(3)}, prices: [${m1Recent5.map(p => p.toFixed(2)).join(', ')}])`);

  // m2: prices barely change -> stable
  const m2Prices = byMarket.get('m2')!;
  const m2Recent5 = m2Prices.slice(0, 5);
  const m2Diff = m2Recent5[0] - m2Recent5[m2Recent5.length - 1];
  const m2Trend = m2Diff > 0.05 ? 'rising' : m2Diff < -0.05 ? 'falling' : 'stable';
  assert(m2Trend === 'stable', `m2 trend should be 'stable', got '${m2Trend}' (diff=${m2Diff.toFixed(4)})`);
  log(`m2 trend: ${m2Trend} (diff=${m2Diff.toFixed(4)})`);
}

// ======== Test 6: Agent History ========

async function testAgentHistory() {
  console.log('\n=== Test 6: LLM adapter — fetchAgentHistory ===');

  const trades = await pool.query(`
    SELECT market_id, side, amount, outcome, profit, created_at
    FROM agent_trades WHERE agent_id = $1 AND status = 'settled'
    ORDER BY created_at DESC LIMIT 10
  `, ['agent1']);

  assert(trades.rows.length > 0, 'Should have settled trades for history');
  const wins = trades.rows.filter((t: any) => t.outcome === 'win').length;
  const totalProfit = trades.rows.reduce((s: number, t: any) => s + Number(t.profit || 0), 0);
  const summary = `Recent ${trades.rows.length} trades: ${wins} wins, ${trades.rows.length - wins} losses, net P&L: $${totalProfit.toFixed(2)}`;
  log(summary);
}

// ======== Test 7: Owner Profile ========

async function testOwnerProfile() {
  console.log('\n=== Test 7: LLM adapter — fetchOwnerProfile ===');

  const profile = await pool.query(
    'SELECT * FROM agent_owner_profile WHERE agent_id = $1', ['agent1']
  );
  assert(profile.rows.length === 1, 'Should have owner profile');
  const p = profile.rows[0];
  const summary = `Owner profile: yes_ratio=${p.yes_ratio}, risk_score=${p.risk_score}, contrarian=${p.contrarian_score}`;
  assert(summary.includes('0.7'), 'yes_ratio should be 0.7');
  assert(summary.includes('0.6'), 'risk_score should be 0.6');
  assert(summary.includes('0.3'), 'contrarian should be 0.3');
  log(summary);
}

// ======== Test 8: Feedback Loop — Second Cycle ========

async function testFeedbackLoop() {
  console.log('\n=== Test 8: Feedback loop — second runner cycle uses updated history ===');

  const { runAgentCycle } = await import('../../src/engine/agent-runner');

  // Count trades before
  const beforeCount = Number((await pool.query("SELECT COUNT(*) as c FROM agent_trades WHERE agent_id = 'agent1'")).rows[0].c);

  // Run another cycle
  await runAgentCycle(pool, 'agent1');

  // Should create new pending trades
  const afterCount = Number((await pool.query("SELECT COUNT(*) as c FROM agent_trades WHERE agent_id = 'agent1'")).rows[0].c);
  assert(afterCount > beforeCount, `Should create new trades: before=${beforeCount}, after=${afterCount}`);
  log(`Second cycle created ${afterCount - beforeCount} new trade(s) (total: ${afterCount})`);

  // New trades should all be pending
  const newPending = await pool.query(
    "SELECT COUNT(*) as c FROM agent_trades WHERE agent_id = 'agent1' AND status = 'pending'"
  );
  assert(Number(newPending.rows[0].c) > 0, 'Should have pending trades from second cycle');
  log(`Pending trades after second cycle: ${newPending.rows[0].c}`);

  // Settled trades should still exist
  const settledCount = Number((await pool.query(
    "SELECT COUNT(*) as c FROM agent_trades WHERE agent_id = 'agent1' AND status = 'settled'"
  )).rows[0].c);
  assert(settledCount > 0, 'Settled trades should still exist');
  log(`Settled trades still intact: ${settledCount}`);
}

// ======== Test 9: Double Settlement Idempotency ========

async function testDoubleSettlement() {
  console.log('\n=== Test 9: Double settlement idempotency ===');

  const { settleAgentTrades } = await import('../../src/engine/agent-settlement');

  // Try settling m3 again — should return 0 (no pending trades left)
  const count = await settleAgentTrades(pool, 'm3', 'yes');
  assert(count === 0, `Double settlement should return 0, got ${count}`);
  log('Double settlement returns 0 (no pending trades)');
}

// ======== Test 10: Settlement for non-existent market ========

async function testSettlementNonExistentMarket() {
  console.log('\n=== Test 10: Settlement for non-existent market ===');

  const { settleAgentTrades } = await import('../../src/engine/agent-settlement');

  const count = await settleAgentTrades(pool, 'non-existent-market', 'yes');
  assert(count === 0, `Should return 0 for non-existent market, got ${count}`);
  log('Non-existent market settlement returns 0');
}

// ======== Main ========

async function main() {
  console.log('=== Agent Autonomous Decision System — Component Tests ===\n');

  try {
    console.log('Setting up test database...');
    await setup();
    log('Test DB created and schema applied');

    await seedTestData();
    log('Test data seeded');

    await testSchema();
    await testRunnerPendingTrades();
    await testSettlement();
    await testEnrichedMarketQuery();
    await testPriceTrends();
    await testAgentHistory();
    await testOwnerProfile();
    await testFeedbackLoop();
    await testDoubleSettlement();
    await testSettlementNonExistentMarket();

    console.log('\n========================================');
    console.log('  ALL 10 TESTS PASSED');
    console.log('========================================\n');
  } catch (err: any) {
    console.error('\n========================================');
    console.error(`  TEST FAILED: ${err.message}`);
    console.error('========================================\n');
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await teardown();
    log('Test DB cleaned up');
  }
}

main();
