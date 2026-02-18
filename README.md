# Flip Predict

**Prediction Market for the BSC Ecosystem -- Trade on Meme Tokens, AI Agents, and Hackathon Outcomes**

| | |
|---|---|
| **Live App** | https://flippredict.net |
| **Backend API** | https://flip-backend-production.up.railway.app |
| **Chain** | BNB Smart Chain Testnet (Chain ID: 97) |
| **Docs** | [PROJECT.md](./docs/PROJECT.md) -- [TECHNICAL.md](./docs/TECHNICAL.md) -- [EXTRAS.md](./docs/EXTRAS.md) |
| **Contracts** | [bsc.address](./bsc.address) |

---

## Problem

BSC has massive predictable activity -- Four.meme token launches, Flap.sh bonding curve graduations, AI agent performance, hackathon results -- but no structured way to trade on these outcomes. Polymarket and Azuro ignore the BSC ecosystem entirely.

## Solution

Flip Predict is a full-stack prediction market built specifically for BSC. Users create and trade binary markets (YES/NO) with instant execution, zero gas fees, and AI-powered trading agents.

**Core features:**

- **Instant Trading** -- Constant product AMM (`x * y = k`) for zero-gas binary market execution, plus limit order book for price discovery and LMSR for multi-option markets
- **NFA (Non-Fungible Agent)** -- ERC-721 AI agents (BAP-578 standard) that autonomously trade on prediction markets. 5 strategy types, auto-trading, copy-trading, and 10% revenue sharing for agent owners
- **Owner Learning** -- Agents learn from their owner's trading history and replicate their style. The trained "trading personality" becomes the asset -- agents can be sold or rented on the NFA marketplace
- **Polymarket-style Hybrid Architecture** -- Off-chain AMM for instant execution + on-chain settlement (deposit, withdraw, resolve, claim) on BSC. Same model used by Polymarket and Gnosis CTF
- **4 BSC Categories** -- Four.meme token predictions, Flap bonding curve events, NFA agent performance, BNB Chain hackathon outcomes
- **Bilingual** -- Full English/Chinese localization

---

## NFA Owner Learning -- The Core Differentiator

The most unique feature: **your agent becomes you**.

When `learn_from_owner` is enabled, the agent reads the owner's complete trading history and builds a real-time Owner Profile:

| Metric | What It Captures | Agent Influence |
|--------|-----------------|-----------------|
| YES/NO Ratio | Directional bias (e.g. 70% YES) | Up to 40% side flip probability |
| Category Weights | Preferred categories | Prioritizes owner's favorite markets |
| Average Amount | Typical position size | 0.5x - 2.0x sizing multiplier |
| Risk Score | Bet variance and concentration | Risk adjustment |
| Contrarian Score | Frequency of betting against consensus | Contrarian strategy weight |
| Win Rate | Settled position accuracy | Public reputation metric |

**Flywheel:**
1. Owner trades actively on the platform
2. Agent learns the owner's pattern and mimics their style
3. Agent builds a public track record (win rate, ROI, profit)
4. Other users discover high-performing agents and start copy-trading
5. Owner earns 10% revenue share on profitable copy trades
6. Trained agents can be sold or rented on the NFA marketplace

Optional: Owners can connect their own LLM API key (OpenAI, Anthropic, DeepSeek, Google, ZhiPu) to upgrade the agent's decision-making. The Owner Profile is injected into the LLM prompt so it reasons with awareness of the owner's style.

---

## Architecture

```
Frontend (React 18 + Vite)              Backend (Express 5 + PostgreSQL)         Contracts (Solidity 0.8.20)
+--------------------------+            +-------------------------------+         +-------------------------+
|  15 pages, 30+ components|   REST    |  20 route modules             |  ethers |  PredictionMarket.sol   |
|  wagmi v2 + RainbowKit   |<-------->|  AMM + LMSR + OrderBook       |<------->|  NFA.sol (BAP-578)      |
|  Zustand + i18n (en/zh)  |   + WS   |  Agent auto-trade + copy      |         |  BAP578Base.sol         |
|  Tailwind CSS + shadcn   |           |  Keeper (background jobs)     |         |  MockOracle.sol         |
+--------------------------+            +-------------------------------+         +-------------------------+
                                                                                           |
                                                                                    BNB Smart Chain
```

**Hybrid model (same as Polymarket):**

| On-chain (verifiable on BscScan) | Off-chain (instant, zero gas) |
|----------------------------------|-------------------------------|
| Deposit / Withdraw USDT | Buy / Sell YES/NO shares (AMM) |
| Mint NFA Agent (ERC-721) | Limit orders (OrderBook) |
| Resolve market | Multi-option markets (LMSR) |
| Claim winnings | Agent auto-trading + copy-trading |
| Split / Merge positions | Price history, comments, social |

---

## Deployed Contracts (BSC Testnet)

| Contract | Address |
|----------|---------|
| PredictionMarket | [`0x1c2702Ce1A66Ca1225f85AFC75925795e8DA58Da`](https://testnet.bscscan.com/address/0x1c2702Ce1A66Ca1225f85AFC75925795e8DA58Da) |
| NFA (ERC-721) | [`0x1a303032E49b7A0C395C938d73ff09cecE295081`](https://testnet.bscscan.com/address/0x1a303032E49b7A0C395C938d73ff09cecE295081) |
| MockUSDT | [`0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F`](https://testnet.bscscan.com/address/0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui |
| Web3 | wagmi v2 + viem + RainbowKit |
| State | Zustand + react-i18next (en/zh) |
| Backend | Express 5 + TypeScript + PostgreSQL + WebSocket |
| Trading Engine | AMM (constant product) + LMSR + Order Book |
| NFA Agents | 5 strategies + Owner Learning + LLM adapter + auto-trade + copy-trade |
| Contracts | Solidity 0.8.20 + OpenZeppelin v5 + Hardhat |
| Testing | Vitest E2E (134 cases, 17 suites, 20 runs 0 failures) |
| Deployment | Cloudflare Pages (frontend) + Railway (backend + PostgreSQL) |
| Chain | BNB Smart Chain Testnet |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- PostgreSQL running locally
- MetaMask with BSC Testnet configured

### Backend

```bash
cd server
npm install
cp .env.example .env
# Edit .env: set JWT_SECRET, PG_* database credentials
npm run seed              # Create tables + seed 24 markets
npm run dev               # http://localhost:3001
```

### Frontend

```bash
npm install
cp .env.example .env
# Edit .env: set VITE_API_URL=http://localhost:3001
npm run dev               # http://localhost:5173
```

### Contracts (optional -- already deployed)

```bash
cd contracts
npm install
npx hardhat test          # Run contract tests
```

### E2E Tests

```bash
cd server
npm run test:e2e          # 134 tests, auto-creates test DB
```

---

## Demo Walkthrough

### 1. Connect Wallet and Get Test USDT

- Open https://flippredict.net
- Click **Connect Wallet**, select MetaMask, switch to BSC Testnet (Chain ID 97)
- Click **Sign In** to authenticate via wallet signature
- Navigate to **Wallet** page, click **Faucet** to claim 1,000 test USDT

### 2. Browse and Trade on Markets

- Home page shows 24 active markets across 4 categories: Four.meme / Flap / NFA / Hackathon
- Use sidebar time filters (Today / This Week / This Month) to narrow results
- Click any market to open the detail page with real-time price chart
- Enter an amount (e.g. 50 USDT), choose **YES** or **NO**, confirm trade
- Price updates instantly via AMM -- no gas fee, no on-chain transaction
- Switch to **Sell** tab to exit a position and see funds return to balance
- Try the **Order Book** tab to place a limit order at a specific price

### 3. Check Portfolio

- Navigate to **Portfolio** page
- View active positions with current value and unrealized PnL
- Review complete trade history with timestamps and prices

### 4. Mint and Train an NFA Agent

- Navigate to **Mint Agent** page
- Choose a strategy type (Conservative / Aggressive / Contrarian / Momentum / Random)
- Mint the agent -- this creates an ERC-721 NFA on BSC
- On the agent detail page, enable **Learn from Owner** so the agent starts learning your trading style
- Use **Fund Agent** to transfer USDT from your platform balance to the agent
- Enable **Auto Trade** -- the agent will now autonomously trade based on its strategy + your learned profile

### 5. Copy Trading

- Navigate to **Agent Dashboard** to browse all NFA agents
- Sort by win rate, total profit, or ROI to find top performers
- Click an agent and press **Follow** to start copy-trading
- When the agent executes a trade, the same trade is automatically copied to your portfolio
- Agent owner earns 10% revenue share on your profitable copy trades

### 6. Agent Marketplace

- Agents with strong track records can be listed for **sale** or **rent**
- Buyers acquire the trained agent including its learned trading personality
- Renters get temporary access to the agent's auto-trading capabilities
- Sellers should withdraw agent balance before listing (Fund/Withdraw panel)

---

## AI Build Log

Built end-to-end with **Claude Code** (Anthropic CLI) using Claude Sonnet 4 / Opus 4.

| Phase | What | Result |
|-------|------|--------|
| Architecture + Implementation | Full-stack design and code generation | ~22,000 lines across contracts, backend, frontend |
| Security Audit | 9 parallel agents scanning all modules | 4 rounds, 41 issues found and fixed |
| E2E Testing | 3 parallel agents writing test suites | 134 tests, 17 suites, 20 runs 0 failures |
| Production Debugging | SSL certs, memory, wallet connection | Deployed and running on Railway + Cloudflare |

AI coverage: ~95% code generation, 100% security audit, 100% E2E test suite. Human role: product direction, UX decisions, deployment configuration.

See [PROJECT.md](./docs/PROJECT.md#ai-build-log) for the full build log with screenshots of parallel agent workflows.

---

## Roadmap

- **CTF Tokenization** -- Convert positions into ERC-1155 outcome tokens for secondary market trading
- **Disputable Arbitration** -- UMA-style optimistic resolution with bond-based incentives
- **Auto Settlement** -- DexScreener price feeds + BSCScan event monitoring for data-verifiable markets
- **Agent Autonomy** -- NFA agents create markets from on-chain signal detection, reputation staking

## License

MIT
