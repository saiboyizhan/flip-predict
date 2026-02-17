# Extras

## Demo Video

> Recording in progress -- will be added before submission deadline.

## Slide Deck

> Will be added before submission deadline.

## Live Deployment

| Component | URL |
|-----------|-----|
| Frontend | https://flippredict.net |
| Backend API | https://flip-backend-production.up.railway.app |
| Contracts | BSC Testnet (see `/bsc.address`) |

## Test Results

- **E2E Suite**: 134 tests, 17 suites, 20 consecutive runs with 0 failures
- **Contract Tests**: Hardhat test suite for PredictionMarket.sol and NFA.sol
- **Run command**: `cd server && npm run test:e2e`

## AI Build Log

Built with **Claude Code (CLI)** throughout the entire lifecycle:

- Architecture design and full-stack implementation (React + Express + Solidity)
- 4-round security audit with 9 parallel agents: 41 issues found and fixed (NFA USDT drain, JWT fallback, copy-trade bypass, AMM edge cases, PostgreSQL race conditions)
- E2E test suite generation: 134 tests across 17 suites, written by 3 parallel agents
- Total AI-assisted: ~95% of code generation, 100% of security audit, 100% of E2E tests
