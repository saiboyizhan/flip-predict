# Synapse -- Prediction Market for BSC Ecosystem

> **Hackathon Starter Kit Navigation**
>
> | Document | Description |
> |----------|-------------|
> | [bsc.address](./bsc.address) | Deployed contract addresses + explorer links |
> | [docs/PROJECT.md](./docs/PROJECT.md) | Problem, solution, business impact, limitations |
> | [docs/TECHNICAL.md](./docs/TECHNICAL.md) | Architecture, setup guide, demo walkthrough |
> | [docs/EXTRAS.md](./docs/EXTRAS.md) | Demo video + slide deck |
>
> **Live**: https://flippredict.net | **API**: https://flip-backend-production.up.railway.app | **Chain**: BSC Testnet

An application-level prediction market on BSC with NFA (Non-Fungible Agent) integration, hybrid order execution (AMM + CLOB + LMSR), and on-chain settlement.

Built for the BSC ecosystem: Four.meme token launches, Flap.sh bonding curve graduations, NFA agent performance, and BNB Chain hackathon outcomes.

## Architecture

```
+------------------------------------------------------------------+
|                        Frontend Layer                             |
|  React 18 + Vite + TypeScript + Tailwind CSS 4 + shadcn/ui       |
|  wagmi v2 + RainbowKit + Zustand + react-i18next (en/zh)         |
|                                                                    |
|  Pages: Home, MarketDetail, AgentDashboard, AgentDetail,           |
|         Portfolio, Leaderboard, CreateMarket, MintAgent,           |
|         Dashboard, Feed, Profile, Rewards, Wallet, Notifications   |
|                                                                    |
|  Components: MarketCard, TradePanel, OrderBook, LimitOrderForm,    |
|              AgentCard, CopyTradePanel, PriceChart, TimeFilter     |
+------------------------------|-------------------------------------+
                               | REST + WebSocket
+------------------------------|-------------------------------------+
|                        Backend Layer                               |
|  Express 5 + TypeScript + PostgreSQL + WebSocket                   |
|                                                                    |
|  Routes: markets, trading, orderbook, settlement, agents,          |
|          copy-trading, portfolio, leaderboard, auth, fees,         |
|          market-creation, achievements, rewards, social,           |
|          comments, favorites, notifications, wallet, profile       |
|                                                                    |
|  Engine: AMM (constant product) + LMSR (multi-option) +           |
|          OrderBook (limit orders) + Oracle (Binance/DexScreener)   |
|          Agent Strategy (5 types) + Auto-Trader + Copy-Trade +     |
|          Revenue Share + Agent Learning + Agent Cards (A2A)        |
+------------------------------|-------------------------------------+
                               | ethers.js v6 / RPC
+------------------------------|-------------------------------------+
|                       Contract Layer                               |
|  Solidity 0.8.20 + OpenZeppelin v5 + Hardhat                      |
|                                                                    |
|  PredictionMarket.sol  -- Markets, positions, deposits, claims     |
|  NFA.sol               -- ERC-721 agents (BAP-578 standard)       |
|  BAP578Base.sol        -- Agent lifecycle, metadata, funding       |
|  MockOracle.sol        -- Binance Oracle adapter for testing       |
+------------------------------------------------------------------+
                               |
                          BNB Smart Chain
```

## Key Features

**NFA (Non-Fungible Agent)** -- ERC-721 agents built on the BAP-578 standard. Each NFA has a prediction profile tracking accuracy and reputation, 5 strategy types (conservative, aggressive, contrarian, momentum, random), auto-trade authorization with daily caps, copy-trading for followers, and revenue sharing on profitable copy trades. Agents learn from outcomes and evolve their weights over time.

**Hybrid Trading Engine** -- Three execution paths working together:
- On-chain: `PredictionMarket.sol` handles deposits, position taking (`takePosition`), resolution, and claims (`claimWinnings`)
- AMM: Constant product market maker (`x * y = k`) for instant binary market execution with complementary pricing (yes + no = 1)
- CLOB: Limit order book with bid/ask matching for price discovery at specific levels
- LMSR: Logarithmic Market Scoring Rule (`b * ln(sum(exp(q_i / b)))`) for multi-option markets with guaranteed liquidity

**Settlement Pipeline** -- Multi-step resolution flow: preview (oracle price snapshot) -> propose (with evidence hash) -> optional challenge window -> finalize. Supports manual resolution, price oracle resolution (`price_above` / `price_below` with target), and backend evidence verification with proof digest.

**BSC Ecosystem Focus** -- Four purpose-built market categories:

| Category | Focus |
|----------|-------|
| Four.meme | Meme token price predictions on Four.meme launch platform |
| Flap | Bonding curve progression and token graduation events on Flap.sh |
| NFA | AI agent ecosystem performance and on-chain metrics |
| Hackathon | BNB Chain hackathon and community event outcomes |

**A2A Protocol Compatible** -- Each NFA agent publishes a standard A2A Agent Card declaring capabilities, skills, and input/output modes, following the A2A protocol specification.

**Bilingual Interface** -- Full English and Chinese localization via react-i18next. Language auto-detected from browser with manual toggle.

**Polymarket-style UI** -- Time-based sidebar filters (ending today / this week / this month), category navigation, real-time price charts with 30-second refresh, threaded comments, and market countdown timers.

## How It Differs from Polymarket

| Dimension | Polymarket | Synapse |
|-----------|-----------|---------|
| **Trading** | Hybrid decentralized CLOB: off-chain matching engine, on-chain settlement, EIP-712 signed orders | On-chain `takePosition`/`claimWinnings` + backend AMM (constant product) + CLOB (limit orders) + LMSR (multi-option) |
| **Position Assets** | YES/NO are CTF ERC-1155 outcome tokens -- freely transferable, composable, split/merge/redeem | Positions stored in contract mappings (`mapping(uint256 => mapping(address => Position))`), not freely transferable tokens |
| **Settlement** | UMA Optimistic Oracle: propose answer -> challenge window -> dispute escalation -> DVM vote | Manual + price oracle with backend evidence hash, propose/challenge/finalize flow, on-chain `resolveMarket` |
| **Pricing** | Orderbook bid/ask midpoint determines probability | AMM complementary pricing (`yesPrice + noPrice = 1`) + LMSR cost function for multi-option |
| **AI Integration** | None -- pure infrastructure | Core differentiator: NFA agents with strategy types, auto-trading, copy-trading, revenue sharing, and learning |
| **Scope** | General-purpose prediction infrastructure (any topic) | BSC ecosystem vertical: Four.meme, Flap, NFA agents, BNB hackathons |
| **Architecture** | Standardized market infrastructure (CLOB + CTF + UMA) | Application-level closed loop (PredictionMarket contract + NFA integration + hybrid trading paths) |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS 4 |
| UI Components | Radix UI + shadcn/ui + Recharts + motion/react |
| Web3 | wagmi v2 + viem + RainbowKit |
| State Management | Zustand |
| Internationalization | react-i18next (English + Chinese) |
| Backend | Express 5 + TypeScript + PostgreSQL |
| Real-time | WebSocket (ws) + Server-Sent Events |
| AI Engine | OpenAI SDK with ZhiPu GLM |
| Oracle | Binance Oracle feeds (Chainlink-compatible) + DexScreener API |
| Market Engine | AMM (constant product) + LMSR + Order Book matching |
| Smart Contracts | Solidity 0.8.20 + OpenZeppelin v5 + Hardhat |
| Chain | BNB Smart Chain (BSC mainnet + testnet) |

## Quick Start

### Prerequisites

- Node.js >= 18
- PostgreSQL running locally
- MetaMask or compatible wallet with BSC network configured

### 1. Smart Contracts

```bash
cd contracts
npm install

# Run tests
npx hardhat test

# Deploy to BSC testnet
cp .env.example .env   # Add DEPLOYER_KEY and BSCSCAN_API_KEY
npm run deploy:bscTestnet
```

### 2. Backend

```bash
cd server
npm install

# Configure environment
cp .env.example .env   # Add DATABASE_URL, ZHIPU_API_KEY, BSC_NETWORK/BSC_RPC_URL, NFA_CONTRACT_ADDRESS, PREDICTION_MARKET_ADDRESS, USDT_ADDRESS

# Initialize database
npm run seed

# Start development server (http://localhost:3001)
npm run dev
```

### 3. Frontend

```bash
# From project root
npm install

# Start development server (http://localhost:5173)
npm run dev
```

### 4. Production Build

```bash
npm run build          # Frontend production build -> dist/
```

## Project Structure

```
synapse/
|-- src/                              # Frontend (React + Vite)
|   |-- app/
|   |   |-- pages/                    # 15 page components
|   |   |   |-- HomePage.tsx          # Market grid with category/time filters
|   |   |   |-- MarketDetailPage.tsx  # Price chart, order book, trade panel
|   |   |   |-- AgentDashboardPage.tsx # NFA marketplace and leaderboard
|   |   |   |-- AgentDetailPage.tsx   # Individual agent stats and history
|   |   |   |-- PortfolioPage.tsx     # Active positions and trade history
|   |   |   |-- CreateMarketPage.tsx  # Market creation with oracle config
|   |   |   |-- MintAgentPage.tsx     # NFA minting interface
|   |   |   |-- LeaderboardPage.tsx   # Top traders by PnL
|   |   |   +-- ...                   # Dashboard, Feed, Profile, Rewards, Wallet
|   |   |-- components/
|   |   |   |-- market/               # MarketCard, MarketDetail, PriceChart, CommentSection
|   |   |   |-- agent/                # AgentCard, AgentDashboard, CopyTradePanel, MintAgent
|   |   |   |-- trading/              # TradePanel, OrderBook, LimitOrderForm, OpenOrders
|   |   |   |-- explore/              # CategoryNav, MarketGrid, TimeFilter
|   |   |   |-- portfolio/            # PositionList, PositionCard
|   |   |   |-- layout/              # AppHeader, NotificationBell
|   |   |   +-- ui/                   # shadcn/ui primitives
|   |   |-- stores/                   # Zustand stores
|   |   |   |-- useMarketStore.ts     # Markets, filters, categories
|   |   |   |-- useAgentStore.ts      # NFA agents, strategies
|   |   |   |-- useTradeStore.ts      # Orders, positions
|   |   |   |-- usePortfolioStore.ts  # Portfolio tracking
|   |   |   +-- useAuthStore.ts       # Wallet authentication
|   |   |-- engine/                   # Frontend pricing logic
|   |   |   |-- amm.ts               # Constant product calculations
|   |   |   +-- lmsr.ts              # LMSR pricing
|   |   |-- services/
|   |   |   |-- api.ts               # API client (100+ methods)
|   |   |   +-- ws.ts                # WebSocket client
|   |   |-- i18n/                     # en.json + zh.json
|   |   +-- config/                   # wagmi + RainbowKit setup
|   +-- main.tsx
|-- server/                           # Backend (Express + PostgreSQL)
|   +-- src/
|       |-- index.ts                  # Server entry point
|       |-- config.ts                 # Environment configuration
|       |-- routes/                   # 20 route modules
|       |   |-- markets.ts           # CRUD + filters + resolution
|       |   |-- trading.ts           # Buy/sell execution
|       |   |-- orderbook.ts         # Limit orders + matching
|       |   |-- settlement.ts        # Propose/challenge/finalize
|       |   |-- agents.ts            # NFA CRUD + strategies
|       |   |-- copy-trading.ts      # Follow/unfollow + copy execution
|       |   +-- ...                   # auth, portfolio, leaderboard, fees, etc.
|       |-- engine/                   # Core business logic
|       |   |-- amm.ts               # Constant product AMM (x * y = k)
|       |   |-- lmsr.ts              # LMSR market maker (multi-option)
|       |   |-- orderbook.ts         # Order book matching engine
|       |   |-- oracle.ts            # Binance Oracle + DexScreener feeds
|       |   |-- agent-strategy.ts    # 5 strategy types (conservative..random)
|       |   |-- agent-autotrader.ts  # Automated trade execution
|       |   |-- agent-prediction.ts  # Prediction profile tracking
|       |   |-- agent-learning.ts    # Weight evolution from outcomes
|       |   |-- agent-advisor.ts     # Advisory recommendations
|       |   |-- agent-runner.ts      # Agent execution loop
|       |   |-- agent-cards.ts       # A2A protocol agent cards
|       |   |-- copy-trade.ts        # Copy trade execution + capping
|       |   |-- revenue-share.ts     # Profit sharing with agent owners
|       |   |-- matching.ts          # Binary market matching
|       |   |-- matching-multi.ts    # Multi-option matching
|       |   |-- dexscreener.ts       # Real-time BSC token prices
|       |   +-- keeper.ts            # Background task runner
|       |-- db/
|       |   |-- index.ts             # PostgreSQL connection pool
|       |   |-- schema.sql           # Full database schema
|       |   +-- seed.ts              # Seed data for all 4 categories
|       +-- ws/                       # WebSocket handlers
|-- contracts/                        # Smart Contracts (Hardhat)
|   |-- contracts/
|   |   |-- PredictionMarket.sol     # Binary markets, positions, claims
|   |   |-- NFA.sol                  # Non-Fungible Agent (BAP-578)
|   |   |-- BAP578Base.sol           # Agent standard base contract
|   |   |-- MockOracle.sol           # Oracle adapter for testing
|   |   |-- MockUSDT.sol             # Test token
|   |   +-- interfaces/              # IBAP578, IBinanceOracle, ILearningModule, etc.
|   |-- test/
|   |   |-- PredictionMarket.test.ts
|   |   +-- NFA.test.ts
|   |-- scripts/deploy.ts
|   +-- hardhat.config.ts
|-- public/                           # Static assets
|-- index.html                        # Vite entry point
|-- vite.config.ts
+-- package.json
```

## API Endpoints

```
Markets
  GET    /api/markets                          List markets with category/status filters
  GET    /api/markets/:id                      Market detail with prices and volume
  POST   /api/markets/create                   Create market (resolution rule + oracle config)

Trading
  POST   /api/orders                           Place buy order (AMM execution)
  POST   /api/orders/sell                      Place sell order
  GET    /api/orderbook/:marketId              Order book snapshot (bids/asks/spread)
  POST   /api/orderbook/limit                  Place limit order

Settlement
  GET    /api/settlement/:marketId/preview     Pre-resolution snapshot (oracle price + expected outcome)
  GET    /api/settlement/:marketId/proof       Settlement proof (payout totals, digest)
  POST   /api/settlement/:marketId/propose     Propose resolution with evidence
  POST   /api/settlement/:marketId/challenge   Challenge a proposal
  POST   /api/settlement/:marketId/finalize    Finalize from accepted proposal

Agents
  GET    /api/agents                           List NFA agents
  GET    /api/agents/:id                       Agent detail + prediction profile
  POST   /api/copy-trading/follow              Follow an agent for copy trading
  POST   /api/copy-trading/unfollow            Stop following

Portfolio
  GET    /api/portfolio/:address               User positions and history
  GET    /api/leaderboard                      Trader rankings by PnL

Auth
  POST   /api/auth/nonce                       Request signing nonce
  POST   /api/auth/verify                      Verify wallet signature
```

## Roadmap

**Phase 1: CTF Tokenization** -- Convert contract-level positions into ERC-1155 outcome tokens. This enables free transfer, secondary market trading, and composability with other DeFi protocols. Positions become liquid assets rather than locked contract state.

**Phase 2: Disputable Arbitration** -- Implement UMA-style optimistic oracle resolution. Anyone can propose an outcome, challengers can dispute with a bond, and unresolved disputes escalate to a decentralized voting mechanism. Replaces manual resolution for trustless settlement.

**Phase 3: Real Settlement APIs** -- Integrate DexScreener price feeds for automatic resolution of price-target markets. Add BSCScan API monitoring for on-chain event tracking: Four.meme token launches, Flap bonding curve graduations, and contract deployment events. Eliminates manual settlement for data-verifiable markets.

**Phase 4: Agent Autonomy** -- NFA agents autonomously create markets from sentiment analysis and on-chain signal detection. Introduce agent reputation staking where agents lock tokens proportional to their confidence. High-performing agents earn delegation from users, creating a self-reinforcing prediction ecosystem.

## License

MIT
