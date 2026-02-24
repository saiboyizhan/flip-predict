# PredictionMarket Contract v2 - Fixes Needed

## Summary
The test file shows that the PredictionMarket contract needs to be updated from v1 (pari-mutuel) to v2 (CTF - Conditional Token Framework). The v2 implementation should:

1. Implement ERC1155 for YES/NO token minting
2. Replace `takePosition` with token-based operations
3. Implement `splitPosition` (collateral → 1 YES + 1 NO token)
4. Implement `mergePositions` (1 YES + 1 NO token → collateral)
5. Implement free transfer of YES/NO tokens before/after resolution
6. Update winnings calculation to CTF model
7. Maintain agent/NFA token support with ERC1155
8. Add strict arbitration mode settings

## Key Functions to Implement/Fix

### Core CTF Operations
- `splitPosition(uint256 marketId, uint256 amount)` - onlyOwner
- `mergePositions(uint256 marketId, uint256 amount)` - onlyOwner
- `getYesTokenId(uint256 marketId)` - returns marketId * 2
- `getNoTokenId(uint256 marketId)` - returns marketId * 2 + 1

### Token ID Encoding
- YES token ID: `marketId * 2`
- NO token ID: `marketId * 2 + 1`

### Existing Functions to Update
- `takePosition()` - keep for backward compatibility but update to use ERC1155
- `claimWinnings()` - update to CTF calculation: `amount = (userTokens * totalCollateral) / tokenSupply`
- `claimRefund()` - when market is cancelled
- Agent functions: `agentTakePosition()`, `agentSplitPosition()`, `agentClaimWinnings()`

### New Settings
- `setStrictArbitrationMode(bool enabled)` - for arbitration behavior control

## Mathematical Model

### CTF Claim Calculation
When market resolves with outcome = true:
- Winning tokens = YES tokens
- User reward = (userYesTokens * totalCollateral) / yesTokenSupply
- Loser compensation: 0
- Potential dust: minimal rounding errors

## Test Categories Covered
1. Basic operations: deposit, withdraw, createMarket
2. CTF splitPosition/mergePositions
3. Free token transfer before/after resolution
4. Agent/NFA ERC1155 token support
5. Arbitrage scenarios
6. Token ID encoding validation
7. ERC1155 compliance
8. Mathematical equivalence testing
9. Rounding dust verification
10. Challenge/arbitration system with max challenges limit

## Key Test Cases
- splitPosition creates 1:1 YES and NO tokens
- mergePositions consumes 1:1 YES and NO tokens to restore collateral
- Free transfer of tokens between any addresses
- Owner can claim with remaining YES tokens after transfers
- Agent positions tracked separately with sub-ledger
- Token supply must equal amount split initially
- Dust should be < 2 (minimal rounding errors)
