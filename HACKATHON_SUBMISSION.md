# Hackathon Submission Package (OpenClaw / BSC)

## 1. Project

- Project name:
- Team / solo:
- Track:
- Repo URL:
- Demo URL:
- Demo video URL (optional):

## 2. On-chain Proof (Required)

Chain must be `BSC` or `opBNB`.

- Chain:
- PredictionMarket contract address:
- NFA contract address:
- Block explorer links:

Core transaction hashes (at least one full flow):

1. Deploy `PredictionMarket` tx:
2. Create market tx:
3. Take position tx (YES/NO):
4. Propose/finalize settlement tx (manual or oracle):
5. Claim winnings/refund tx:

### 2.2 Canonical Contracts (For Judges)

- Prediction market main contract: `contracts/contracts/PredictionMarket.sol`
- NFA (BAP-578 compatible) canonical contract for this submission: `contracts/contracts/NFA.sol`
- Reference/standalone BAP-578 implementation (not canonical judging target): `non-fungible-agents-BAP-578/contracts/BAP578.sol`

Notes:
- Frontend/back-end use `token_id` + `mint_tx_hash` for agent mint proof.
- User-created markets are linked by `on_chain_market_id` + `create_tx_hash`.

Suggested verification commands (replace addresses/network):

```bash
cd contracts
npx hardhat verify --network bscTestnet <PredictionMarketAddress>
npx hardhat verify --network bscTestnet <NFAAddress> <USDTAddress>
```

## 2.1 Live Demo Order (Recommended)

Use this exact order for judging:

1. Open explorer links first (3 contracts verified on BSC/opBNB).
2. Show deploy tx hash, then market create tx hash.
3. Show position tx hash (YES/NO).
4. Show resolve tx hash and claim tx hash.
5. Show NFA mint tx hash (BAP-578 agent).
6. Show `/api/settlement/<marketId>/proof` with `overallPass=true` and `proofDigest`.
   - Mandatory pass includes `resolve_tx_on_chain_verified`.
7. If manual market: show `/propose` -> `/challenge` (optional) -> `/finalize` evidence chain.

## 3. Settlement Verification (Judge-friendly)

This project exposes two verification APIs for transparent settlement checks:

1. `GET /api/settlement/:marketId/preview`
2. `GET /api/settlement/:marketId/proof`
3. `POST /api/settlement/:marketId/propose`
4. `POST /api/settlement/:marketId/challenge`
5. `POST /api/settlement/:marketId/finalize`

### 3.1 Preview API

Purpose:
- Verify whether a market is ready to resolve
- Show current oracle price and expected outcome (`price_above` / `price_below`)

Example:

```bash
curl "http://localhost:3001/api/settlement/<marketId>/preview"
```

### 3.2 Proof API

Purpose:
- Return settlement totals and consistency checks
- Return reproducible `proofDigest` (sha256 over verification payload)

Example:

```bash
curl "http://localhost:3001/api/settlement/<marketId>/proof"
```

Expected fields:
- `summary.netDeposits`
- `summary.winnerTotal`
- `checks[]`
- `overallPass`
- `proofDigest`
- `arbitration.challengeCount`
- `arbitration.resolveTxHash` (when provided)

### 3.3 Manual Event Arbitration Loop (Recommended for entity/sports/hackathon events)

1. Create market with:
   - `resolutionType=manual`
   - `resolutionRule` (clear deterministic rule text)
   - `resolutionSourceUrl` (official source)
2. After market end:
   - proposer submits `/propose` with evidence URL/hash or resolve tx hash
3. During challenge window:
   - anyone can submit `/challenge` with reason + evidence
4. Admin calls `/finalize`:
   - writes final outcome + evidence/tx hash
   - triggers payout settlement

Example API calls:

```bash
# 1) Propose (creator/admin)
curl -X POST "http://localhost:3001/api/settlement/<marketId>/propose" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "outcome":"yes",
    "sourceUrl":"https://official-source.example/result",
    "evidenceUrl":"https://official-source.example/screenshot.png",
    "evidenceHash":"sha256:...",
    "resolveTxHash":"0x...",
    "notes":"Official announcement link and capture",
    "challengeWindowHours":6
  }'

# 2) Challenge (any non-proposer account)
curl -X POST "http://localhost:3001/api/settlement/<marketId>/challenge" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason":"Source link is outdated, latest post says opposite outcome.",
    "evidenceUrl":"https://official-source.example/new-post"
  }'

# 3) Finalize (admin)
curl -X POST "http://localhost:3001/api/settlement/<marketId>/finalize" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "outcome":"yes",
    "resolveTxHash":"0x...",
    "evidenceUrl":"https://official-source.example/final-proof"
  }'
```

## 4. Reproducibility (Required)

### 4.1 Prerequisites

- Node.js 20+ (recommended)
- PostgreSQL 14+

### 4.2 Backend

```bash
cd server
npm install
cp .env.example .env
npm run seed
npm run dev
```

### 4.3 Frontend

```bash
cd ..
npm install
cp .env.example .env
npm run dev
```

### 4.4 Contracts

```bash
cd contracts
npm install
cp .env.example .env
npx hardhat compile
npx hardhat test
```

## 5. Compliance Statement (Required)

Before final submission, confirm all boxes:

- [ ] No token issuance during event period
- [ ] No fundraising during event period
- [ ] No liquidity launch during event period
- [ ] No airdrop-driven promotion during event period

Statement:

`This submission does not conduct token issuance, fundraising, liquidity opening, or airdrop-driven promotion before official result announcement.`

## 6. Final Checklist

- [ ] Contract addresses are real and accessible on explorer
- [ ] All tx hashes are valid and publicly verifiable
- [ ] Demo link is working
- [ ] Repo is public (or judge-accessible)
- [ ] Reproduction steps run successfully
- [ ] Settlement verification API returns `overallPass=true` for resolved demo market
