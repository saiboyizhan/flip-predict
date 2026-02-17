import { Pool } from 'pg';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const TEST_DB = 'prediction_test';
const TEST_PORT = 3099;
const ADMIN_MNEMONIC = 'test test test test test test test test test test test junk';

let serverProcess: ChildProcess | null = null;

export async function setup() {
  // 1. Create test database if it doesn't exist
  const adminPool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: 'postgres',
  });

  try {
    const exists = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [TEST_DB]
    );
    if (exists.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      console.log(`Created test database: ${TEST_DB}`);
    }
  } finally {
    await adminPool.end();
  }

  // 2. Compute admin wallet address from deterministic HD wallet (index 99)
  // We use ethers dynamically to get the admin address
  const { ethers } = await import('ethers');
  const adminWallet = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(ADMIN_MNEMONIC),
    `m/44'/60'/0'/0/99`
  );
  const adminAddress = adminWallet.address.toLowerCase();

  // 3. Start the server as a child process
  const serverRoot = path.resolve(__dirname, '../../..');
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(TEST_PORT),
    JWT_SECRET: 'test-secret-for-e2e',
    PG_DB: TEST_DB,
    PG_HOST: process.env.PG_HOST || 'localhost',
    PG_PORT: process.env.PG_PORT || '5432',
    PG_USER: process.env.PG_USER || 'postgres',
    PG_PASSWORD: process.env.PG_PASSWORD || 'postgres',
    NFA_CONTRACT_ADDRESS: '',
    USDT_ADDRESS: '',
    PREDICTION_MARKET_ADDRESS: '',
    ADMIN_ADDRESSES: adminAddress,
    NODE_ENV: 'test',
    INITIAL_SIGNUP_BALANCE: '0',
  };

  serverProcess = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[server] ${msg}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('ExperimentalWarning')) {
      console.error(`[server:err] ${msg}`);
    }
  });

  // 4. Wait for server to be ready (poll /api/health)
  const baseUrl = `http://localhost:${TEST_PORT}`;
  const maxWait = 30000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        console.log(`Server ready at ${baseUrl} (took ${Date.now() - start}ms)`);
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Server failed to start within ${maxWait}ms`);
}

export async function teardown() {
  // 1. Kill server process
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        serverProcess?.kill('SIGKILL');
        resolve();
      }, 5000);
      serverProcess?.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    serverProcess = null;
  }

  // 2. Drop test database
  const adminPool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: 'postgres',
  });

  try {
    // Terminate existing connections
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [TEST_DB]);
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    console.log(`Dropped test database: ${TEST_DB}`);
  } catch (err) {
    console.error('Failed to drop test DB:', err);
  } finally {
    await adminPool.end();
  }
}
