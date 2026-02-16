# Project

## Problem

BSC 生态 (Four.meme, Flap.sh, NFA agents, 黑客松) 有大量可预测事件 -- 代币毕业率、价格走势、AI Agent 表现、黑客松结果 -- 但用户缺乏结构化的预测和交易工具。现有预测市场 (Polymarket, Azuro) 完全不覆盖 BSC 生态，用户只能在群里喊单，没有可量化的表达方式。

The BSC ecosystem (Four.meme, Flap.sh, NFA agents, hackathons) generates countless predictable events -- token graduation rates, price movements, AI agent performance, hackathon outcomes -- yet users lack structured prediction and trading instruments. Existing prediction markets (Polymarket, Azuro) ignore the BSC ecosystem entirely, leaving users to speculate in group chats with no quantifiable way to express views.

## Solution

Synapse is a prediction market purpose-built for the BSC ecosystem. It combines:

- **AMM + Order Book hybrid trading** -- Constant product AMM for instant execution, limit order book for price discovery, LMSR for multi-option markets
- **NFA (Non-Fungible Agent)** -- ERC-721 AI agents (BAP-578 standard) with 5 strategy types, auto-trading, copy-trading, and revenue sharing. Agents track prediction accuracy and evolve over time
- **On-chain settlement** -- PredictionMarket.sol handles deposits, position taking, resolution, and claims on BSC
- **4 market categories** -- Four.meme token predictions, Flap bonding curve graduations, NFA agent performance, and BNB Chain hackathon outcomes

Users create or trade on binary prediction markets (YES/NO) with real-time price charts, threaded comments, and a Polymarket-style UI.

## Business & Ecosystem Impact

- **BSC-native** -- Deployed on BNB Smart Chain, serving the chain's largest meme token communities
- **NFA creator economy** -- Agent owners earn 10% revenue share on profitable copy trades, incentivizing high-quality agent strategies
- **BSC ecosystem closed loop** -- Four.meme/Flap 用户对冲代币风险、NFA 持有者预测 Agent 表现、黑客松参与者押注项目结果
- **Market creation with approval** -- Community-driven market creation with admin review, ensuring quality and relevance
- **Bilingual** -- Full English and Chinese localization, serving BSC's global and Asian user bases

## Limitations & Future Work

- **Testnet stage** -- Currently deployed on BSC Testnet with MockUSDT; mainnet migration pending audit
- **Manual settlement** -- Most markets require manual resolution; automated oracle coverage (DexScreener, BSCScan event monitoring) is limited
- **No CTF tokens** -- Positions are contract-level mappings, not freely transferable ERC-1155 outcome tokens (planned for Phase 1)
- **Future directions** -- UMA-style disputable arbitration, real-time settlement APIs, agent-created markets from on-chain signal detection
