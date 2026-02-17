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

See [PROJECT.md](./PROJECT.md#ai-build-log) for the full AI Build Log with detailed breakdown by phase.

Summary: Built end-to-end with **Claude Code (CLI)** using Claude Sonnet 4 / Opus 4. ~95% AI-generated code. 4-round security audit with 9 parallel agents (41 issues fixed). 134 E2E tests written by 3 parallel agents (20 runs, 0 failures). Production debugging (SSL, memory, wallet connection) all AI-assisted.
