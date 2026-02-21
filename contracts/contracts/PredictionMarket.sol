// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IBinanceOracle.sol";

/// @title PredictionMarket v2 - Non-custodial CPMM prediction market on BSC
/// @notice Users trade directly with on-chain AMM. No deposit/withdraw needed.
/// @dev CPMM (x*y=k) with LP support. ERC1155 YES/NO tokens.
contract PredictionMarket is ERC1155Supply, ReentrancyGuard, Ownable, Pausable {

    enum ResolutionPhase { NONE, PROPOSED, CHALLENGED, FINALIZED }

    struct Market {
        string title;
        uint256 endTime;
        uint256 totalCollateral;
        bool resolved;
        bool outcome;
        bool exists;
        bool cancelled;
        // Oracle fields
        bool oracleEnabled;
        address priceFeed;
        int256 targetPrice;
        uint8 resolutionType;
        int256 resolvedPrice;
        // Arbitration fields
        ResolutionPhase resolutionPhase;
        address proposer;
        bool proposedOutcome;
        uint256 challengeWindowEnd;
        uint256 challengeCount;
        // AMM reserves
        uint256 yesReserve;
        uint256 noReserve;
        uint256 totalLpShares;
        uint256 initialLiquidity;
    }

    IERC20 public usdtToken;

    mapping(uint256 => Market) internal markets;
    uint256 public nextMarketId;

    // LP shares: marketId => user => shares
    mapping(uint256 => mapping(address => uint256)) public lpShares;

    // User market creation
    uint256 public marketCreationFee;
    uint256 public maxMarketsPerDay;
    uint256 public constant MAX_CHALLENGES = 5;
    bool public strictArbitrationMode;
    address public nfaContract;

    uint256 public accumulatedFees;

    mapping(address => uint256) public dailyMarketCount;
    mapping(address => uint256) public lastMarketCreationDay;
    mapping(uint256 => address) public marketCreator;
    mapping(uint256 => mapping(address => bool)) public hasChallenged;

    // Agent sub-ledger
    mapping(uint256 => mapping(uint256 => uint256)) public agentYesBalance;
    mapping(uint256 => mapping(uint256 => uint256)) public agentNoBalance;

    // Constants
    uint256 public constant MIN_RESERVE = 1e18;         // 1 USDT minimum reserve
    uint256 public constant FEE_BPS = 100;               // 1% = 100 basis points
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant LP_FEE_SHARE = 8000;         // 80% of fee to LP
    uint256 public constant PROTOCOL_FEE_SHARE = 2000;   // 20% of fee to protocol
    uint256 public constant MIN_INITIAL_LIQUIDITY = 50e18; // 50 USDT minimum

    // Events
    event MarketCreated(uint256 indexed marketId, string title, uint256 endTime);
    event MarketResolved(uint256 indexed marketId, bool outcome);
    event Trade(uint256 indexed marketId, address indexed user, bool isBuy, bool side, uint256 amount, uint256 shares, uint256 fee);
    event LiquidityAdded(uint256 indexed marketId, address indexed user, uint256 amount, uint256 lpSharesMinted);
    event LiquidityRemoved(uint256 indexed marketId, address indexed user, uint256 sharesBurned, uint256 usdtOut);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event RefundClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event OracleMarketCreated(uint256 indexed marketId, address priceFeed, int256 targetPrice, uint8 resolutionType);
    event OracleResolution(uint256 indexed marketId, int256 price, bool outcome);
    event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee);
    event AgentPositionTaken(uint256 indexed marketId, uint256 indexed agentTokenId, bool isYes, uint256 amount);
    event AgentRefundClaimed(uint256 indexed marketId, uint256 indexed agentTokenId, uint256 amount);
    event MarketCreationFeeUpdated(uint256 newFee);
    event MaxMarketsPerDayUpdated(uint256 newMax);
    event NFAContractUpdated(address nfaContract);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event MarketCancelled(uint256 indexed marketId);
    event ResolutionProposed(uint256 indexed marketId, address indexed proposer, bool proposedOutcome, uint256 challengeWindowEnd);
    event ResolutionChallenged(uint256 indexed marketId, address indexed challenger, uint256 challengeCount, uint256 newWindowEnd);
    event ResolutionFinalized(uint256 indexed marketId, bool outcome);
    event StrictArbitrationModeUpdated(bool enabled);
    event PositionSplit(uint256 indexed marketId, address indexed user, uint256 amount);
    event PositionsMerged(uint256 indexed marketId, address indexed user, uint256 amount);

    constructor(address _usdtToken) ERC1155("") Ownable(msg.sender) {
        require(_usdtToken != address(0), "Invalid USDT address");
        usdtToken = IERC20(_usdtToken);
        marketCreationFee = 10 * 1e18;
        maxMarketsPerDay = 3;
        strictArbitrationMode = true;
    }

    // ============================================================
    //                      TOKEN ID HELPERS
    // ============================================================

    function getYesTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2;
    }

    function getNoTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2 + 1;
    }

    // ============================================================
    //                      CPMM TRADING
    // ============================================================

    /// @notice Buy YES or NO shares using USDT directly from wallet
    /// @param marketId The market to trade on
    /// @param buyYes true = buy YES, false = buy NO
    /// @param amount USDT amount to spend (before fee)
    /// @return sharesOut Number of outcome shares received
    function buy(
        uint256 marketId,
        bool buyYes,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        require(amount > 0, "Amount must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        require(block.timestamp < m.endTime, "Market ended");
        require(m.yesReserve > 0 && m.noReserve > 0, "No liquidity");

        // Transfer USDT from user
        require(usdtToken.transferFrom(msg.sender, address(this), amount), "USDT transfer failed");

        // Deduct fee
        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;

        // Distribute fee: 80% to LP reserves, 20% to protocol
        uint256 lpFee = (fee * LP_FEE_SHARE) / BPS_DENOMINATOR;
        uint256 protocolFee = fee - lpFee;
        accumulatedFees += protocolFee;

        // Add LP fee back to reserves proportionally
        if (m.totalLpShares > 0) {
            uint256 totalRes = m.yesReserve + m.noReserve;
            m.yesReserve += (lpFee * m.yesReserve) / totalRes;
            m.noReserve += (lpFee * m.noReserve) / totalRes;
        } else {
            // No LP providers — all fee to protocol
            accumulatedFees += lpFee;
        }

        // CPMM: x * y = k
        uint256 k = m.yesReserve * m.noReserve;

        if (buyYes) {
            // Buying YES: deposit into NO reserve, withdraw from YES reserve
            // Conceptually: mint netAmount YES+NO, add NO to pool, get YES out
            uint256 newNoReserve = m.noReserve + netAmount;
            uint256 newYesReserve = k / newNoReserve;
            sharesOut = netAmount + (m.yesReserve - newYesReserve);
            m.yesReserve = newYesReserve;
            m.noReserve = newNoReserve;
        } else {
            // Buying NO: deposit into YES reserve, withdraw from NO reserve
            uint256 newYesReserve = m.yesReserve + netAmount;
            uint256 newNoReserve = k / newYesReserve;
            sharesOut = netAmount + (m.noReserve - newNoReserve);
            m.noReserve = newNoReserve;
            m.yesReserve = newYesReserve;
        }

        require(sharesOut > 0, "Zero shares output");
        require(m.yesReserve >= MIN_RESERVE && m.noReserve >= MIN_RESERVE, "Trade too large");

        // Track collateral and mint tokens
        m.totalCollateral += netAmount;
        if (buyYes) {
            _mint(msg.sender, getYesTokenId(marketId), sharesOut, "");
        } else {
            _mint(msg.sender, getNoTokenId(marketId), sharesOut, "");
        }

        emit Trade(marketId, msg.sender, true, buyYes, amount, sharesOut, fee);
    }

    /// @notice Sell YES or NO shares back to the AMM for USDT
    /// @param marketId The market to trade on
    /// @param sellYes true = sell YES, false = sell NO
    /// @param shares Number of outcome shares to sell
    /// @return usdtOut USDT amount received (after fee)
    function sell(
        uint256 marketId,
        bool sellYes,
        uint256 shares
    ) external nonReentrant whenNotPaused returns (uint256 usdtOut) {
        require(shares > 0, "Shares must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        require(block.timestamp < m.endTime, "Market ended");
        require(m.yesReserve > 0 && m.noReserve > 0, "No liquidity");

        // Verify user has shares
        uint256 tokenId = sellYes ? getYesTokenId(marketId) : getNoTokenId(marketId);
        require(balanceOf(msg.sender, tokenId) >= shares, "Insufficient shares");

        // CPMM sell: quadratic formula
        // amountOut = (b - sqrt(b^2 - 4*c)) / 2
        uint256 b = m.yesReserve + m.noReserve + shares;
        uint256 c;
        if (sellYes) {
            c = shares * m.noReserve;
        } else {
            c = shares * m.yesReserve;
        }
        // b^2 - 4c: since b = R_y + R_n + shares and c = shares * R_opposite,
        // discriminant is always positive for valid inputs
        uint256 discriminant = b * b - 4 * c;
        uint256 sqrtDisc = Math.sqrt(discriminant);
        uint256 grossOut = (b - sqrtDisc) / 2;

        require(grossOut > 0, "Zero output");

        // Update reserves
        if (sellYes) {
            m.yesReserve = m.yesReserve + shares - grossOut;
            m.noReserve = m.noReserve - grossOut;
        } else {
            m.noReserve = m.noReserve + shares - grossOut;
            m.yesReserve = m.yesReserve - grossOut;
        }

        require(m.yesReserve >= MIN_RESERVE && m.noReserve >= MIN_RESERVE, "Trade too large");

        // Deduct fee from output
        uint256 fee = (grossOut * FEE_BPS) / BPS_DENOMINATOR;
        usdtOut = grossOut - fee;

        // Distribute fee
        uint256 lpFee = (fee * LP_FEE_SHARE) / BPS_DENOMINATOR;
        uint256 protocolFee = fee - lpFee;
        accumulatedFees += protocolFee;

        if (m.totalLpShares > 0) {
            uint256 totalRes = m.yesReserve + m.noReserve;
            m.yesReserve += (lpFee * m.yesReserve) / totalRes;
            m.noReserve += (lpFee * m.noReserve) / totalRes;
        } else {
            accumulatedFees += lpFee;
        }

        // Burn shares and transfer USDT
        _burn(msg.sender, tokenId, shares);
        m.totalCollateral -= grossOut;
        require(usdtToken.transfer(msg.sender, usdtOut), "USDT transfer failed");

        emit Trade(marketId, msg.sender, false, sellYes, usdtOut, shares, fee);
    }

    /// @notice Get current price for a market
    function getPrice(uint256 marketId) external view returns (uint256 yesPrice, uint256 noPrice) {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        if (m.yesReserve == 0 && m.noReserve == 0) {
            return (5e17, 5e17); // 0.5 / 0.5 default
        }
        uint256 total = m.yesReserve + m.noReserve;
        yesPrice = (m.noReserve * 1e18) / total;
        noPrice = 1e18 - yesPrice;
    }

    /// @notice Get AMM reserves for a market
    function getReserves(uint256 marketId) external view returns (uint256 yesReserve, uint256 noReserve) {
        Market storage m = markets[marketId];
        return (m.yesReserve, m.noReserve);
    }

    // ============================================================
    //                      LIQUIDITY PROVIDER
    // ============================================================

    /// @notice Add liquidity to a market's AMM pool
    /// @param marketId The market to provide liquidity for
    /// @param amount USDT amount to add
    /// @return newShares LP shares minted
    function addLiquidity(
        uint256 marketId,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 newShares) {
        require(amount > 0, "Amount must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        require(block.timestamp < m.endTime, "Market ended");
        require(m.yesReserve > 0 && m.noReserve > 0, "Market not initialized");

        require(usdtToken.transferFrom(msg.sender, address(this), amount), "USDT transfer failed");

        uint256 poolValue = m.yesReserve + m.noReserve;

        // Calculate LP shares proportional to pool value
        if (m.totalLpShares == 0) {
            newShares = amount;
        } else {
            newShares = (m.totalLpShares * amount) / poolValue;
        }
        require(newShares > 0, "Zero LP shares");

        // Add to reserves proportionally (maintains current price)
        uint256 addYes = (amount * m.yesReserve) / poolValue;
        uint256 addNo = amount - addYes;

        m.yesReserve += addYes;
        m.noReserve += addNo;
        m.totalLpShares += newShares;
        m.totalCollateral += amount;
        lpShares[marketId][msg.sender] += newShares;

        emit LiquidityAdded(marketId, msg.sender, amount, newShares);
    }

    /// @notice Remove liquidity from a market's AMM pool
    /// @param marketId The market to remove liquidity from
    /// @param sharesToBurn Number of LP shares to burn
    /// @return usdtOut USDT amount returned
    function removeLiquidity(
        uint256 marketId,
        uint256 sharesToBurn
    ) external nonReentrant whenNotPaused returns (uint256 usdtOut) {
        require(sharesToBurn > 0, "Shares must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(lpShares[marketId][msg.sender] >= sharesToBurn, "Insufficient LP shares");

        uint256 poolValue = m.yesReserve + m.noReserve;

        // Calculate withdrawal proportional to shares
        usdtOut = (sharesToBurn * poolValue) / m.totalLpShares;
        require(usdtOut > 0, "Zero output");

        // Calculate proportional reserve removal
        uint256 removeYes = (usdtOut * m.yesReserve) / poolValue;
        uint256 removeNo = usdtOut - removeYes;

        // Safety: reserves must stay above minimum
        uint256 minReserve = m.initialLiquidity / 2;
        if (minReserve < MIN_RESERVE) minReserve = MIN_RESERVE;
        require(m.yesReserve - removeYes >= minReserve, "Would deplete YES reserve");
        require(m.noReserve - removeNo >= minReserve, "Would deplete NO reserve");

        m.yesReserve -= removeYes;
        m.noReserve -= removeNo;
        m.totalLpShares -= sharesToBurn;
        m.totalCollateral -= usdtOut;
        lpShares[marketId][msg.sender] -= sharesToBurn;

        require(usdtToken.transfer(msg.sender, usdtOut), "USDT transfer failed");

        emit LiquidityRemoved(marketId, msg.sender, sharesToBurn, usdtOut);
    }

    /// @notice Get LP info for a market
    function getLpInfo(uint256 marketId, address user) external view returns (
        uint256 totalShares,
        uint256 userLpShares,
        uint256 poolValue,
        uint256 userValue,
        uint256 yesReserve,
        uint256 noReserve
    ) {
        Market storage m = markets[marketId];
        totalShares = m.totalLpShares;
        yesReserve = m.yesReserve;
        noReserve = m.noReserve;
        poolValue = yesReserve + noReserve;
        userLpShares = lpShares[marketId][user];
        if (totalShares > 0) {
            userValue = (userLpShares * poolValue) / totalShares;
        }
    }

    // ============================================================
    //                      CTF: SPLIT / MERGE (PUBLIC)
    // ============================================================

    /// @notice Split USDT into YES + NO tokens (1:1:1)
    function splitPosition(uint256 marketId, uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        require(block.timestamp < m.endTime, "Market ended");

        require(usdtToken.transferFrom(msg.sender, address(this), amount), "USDT transfer failed");
        m.totalCollateral += amount;

        _mint(msg.sender, getYesTokenId(marketId), amount, "");
        _mint(msg.sender, getNoTokenId(marketId), amount, "");

        emit PositionSplit(marketId, msg.sender, amount);
    }

    /// @notice Merge YES + NO tokens back into USDT (1:1:1)
    function mergePositions(uint256 marketId, uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);
        require(balanceOf(msg.sender, yesId) >= amount, "Insufficient YES tokens");
        require(balanceOf(msg.sender, noId) >= amount, "Insufficient NO tokens");

        _burn(msg.sender, yesId, amount);
        _burn(msg.sender, noId, amount);
        m.totalCollateral -= amount;

        require(usdtToken.transfer(msg.sender, amount), "USDT transfer failed");

        emit PositionsMerged(marketId, msg.sender, amount);
    }

    // ============================================================
    //                      CLAIM WINNINGS (PUBLIC)
    // ============================================================

    /// @notice Claim winnings from a resolved market — USDT sent directly to user
    function claimWinnings(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(m.resolved, "Market not resolved");
        require(!m.cancelled, "Market cancelled, use claimRefund");

        uint256 winningTokenId = m.outcome ? getYesTokenId(marketId) : getNoTokenId(marketId);
        uint256 winnerAmount = balanceOf(msg.sender, winningTokenId);
        require(winnerAmount > 0, "No winning position");

        uint256 winnerSupply = totalSupply(winningTokenId);
        _burn(msg.sender, winningTokenId, winnerAmount);

        uint256 reward = (winnerAmount * m.totalCollateral) / winnerSupply;
        m.totalCollateral -= reward;

        require(usdtToken.transfer(msg.sender, reward), "USDT transfer failed");
        emit WinningsClaimed(marketId, msg.sender, reward);
    }

    /// @notice Claim refund for a cancelled market — USDT sent directly to user
    function claimRefund(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(m.cancelled, "Market not cancelled");

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);
        uint256 userYes = balanceOf(msg.sender, yesId);
        uint256 userNo = balanceOf(msg.sender, noId);
        uint256 totalTokens = userYes + userNo;
        require(totalTokens > 0, "No position");

        if (userYes > 0) _burn(msg.sender, yesId, userYes);
        if (userNo > 0) _burn(msg.sender, noId, userNo);

        uint256 totalAllTokens = totalSupply(yesId) + totalSupply(noId) + totalTokens;
        uint256 refundAmount = (totalTokens * m.totalCollateral) / totalAllTokens;
        m.totalCollateral -= refundAmount;

        require(usdtToken.transfer(msg.sender, refundAmount), "USDT transfer failed");
        emit RefundClaimed(marketId, msg.sender, refundAmount);
    }

    // ============================================================
    //                      MARKET MANAGEMENT
    // ============================================================

    /// @notice Create a new manually-resolved market (owner only, no AMM)
    function createMarket(
        string calldata title,
        uint256 endTime
    ) external onlyOwner returns (uint256) {
        require(endTime > block.timestamp, "End time must be in future");
        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.title = title;
        m.endTime = endTime;
        m.exists = true;
        emit MarketCreated(marketId, title, endTime);
        return marketId;
    }

    /// @notice Create a new oracle-resolved market (owner only)
    function createOracleMarket(
        string calldata title,
        uint256 endTime,
        address priceFeed,
        int256 targetPrice,
        uint8 resolutionType
    ) external onlyOwner returns (uint256) {
        require(endTime > block.timestamp, "End time must be in future");
        require(priceFeed != address(0), "Invalid price feed");
        require(resolutionType == 1 || resolutionType == 2, "Invalid resolution type");
        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.title = title;
        m.endTime = endTime;
        m.exists = true;
        m.oracleEnabled = true;
        m.priceFeed = priceFeed;
        m.targetPrice = targetPrice;
        m.resolutionType = resolutionType;
        emit MarketCreated(marketId, title, endTime);
        emit OracleMarketCreated(marketId, priceFeed, targetPrice, resolutionType);
        return marketId;
    }

    /// @notice Create a user-generated market with CPMM liquidity
    /// @dev Caller must approve this contract for (marketCreationFee + initialLiquidity) USDT
    function createUserMarket(
        string calldata title,
        uint256 endTime,
        uint256 initialLiq
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(bytes(title).length >= 10, "Title too short");
        require(bytes(title).length <= 200, "Title too long");
        require(endTime > block.timestamp + 1 hours, "End time too soon");
        require(endTime <= block.timestamp + 90 days, "End time too far");
        require(initialLiq >= MIN_INITIAL_LIQUIDITY, "Initial liquidity too low");

        // Daily rate limit
        uint256 today = block.timestamp / 86400;
        if (lastMarketCreationDay[msg.sender] != today) {
            dailyMarketCount[msg.sender] = 0;
            lastMarketCreationDay[msg.sender] = today;
        }
        require(dailyMarketCount[msg.sender] < maxMarketsPerDay, "Daily market limit reached");
        dailyMarketCount[msg.sender]++;

        // Transfer creation fee + initial liquidity from user
        uint256 totalTransfer = marketCreationFee + initialLiq;
        require(usdtToken.transferFrom(msg.sender, address(this), totalTransfer), "USDT transfer failed");
        accumulatedFees += marketCreationFee;

        // Create market
        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.title = title;
        m.endTime = endTime;
        m.exists = true;

        // Initialize AMM reserves (50/50)
        m.yesReserve = initialLiq;
        m.noReserve = initialLiq;
        m.initialLiquidity = initialLiq;
        m.totalCollateral = initialLiq * 2; // Both reserves are backed
        m.totalLpShares = initialLiq;

        marketCreator[marketId] = msg.sender;
        lpShares[marketId][msg.sender] = initialLiq; // Creator gets initial LP shares

        emit MarketCreated(marketId, title, endTime);
        emit UserMarketCreated(marketId, msg.sender, title, marketCreationFee);
        emit LiquidityAdded(marketId, msg.sender, initialLiq, initialLiq);
        return marketId;
    }

    // ============================================================
    //                      RESOLUTION
    // ============================================================

    /// @notice Manually resolve a non-oracle market (owner only)
    function resolveMarket(uint256 marketId, bool outcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Already resolved");
        require(!m.oracleEnabled, "Use resolveByOracle for oracle markets");
        require(!strictArbitrationMode, "Direct manual resolve disabled");
        require(block.timestamp >= m.endTime, "Market not ended");
        require(
            m.resolutionPhase != ResolutionPhase.PROPOSED &&
            m.resolutionPhase != ResolutionPhase.CHALLENGED,
            "Active arbitration in progress"
        );
        m.resolved = true;
        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    /// @notice Resolve an oracle-enabled market
    function resolveByOracle(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Already resolved");
        require(m.oracleEnabled, "Not oracle market");
        require(block.timestamp >= m.endTime, "Market not ended");

        (, int256 currentPrice, , uint256 updatedAt, ) = AggregatorV2V3Interface(m.priceFeed).latestRoundData();
        require(currentPrice > 0, "Invalid oracle price");
        require(block.timestamp - updatedAt < 1 hours, "Stale oracle price");

        bool outcome;
        if (m.resolutionType == 1) {
            outcome = currentPrice >= m.targetPrice;
        } else {
            outcome = currentPrice <= m.targetPrice;
        }

        m.resolved = true;
        m.outcome = outcome;
        m.resolvedPrice = currentPrice;
        emit MarketResolved(marketId, outcome);
        emit OracleResolution(marketId, currentPrice, outcome);
    }

    // --- Arbitration ---

    function proposeResolution(uint256 marketId, bool _outcome) external {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Already resolved");
        require(block.timestamp >= m.endTime, "Market not ended");
        require(m.resolutionPhase == ResolutionPhase.NONE, "Proposal already exists");
        require(
            msg.sender == owner() || msg.sender == marketCreator[marketId],
            "Only owner or market creator"
        );
        m.resolutionPhase = ResolutionPhase.PROPOSED;
        m.proposer = msg.sender;
        m.proposedOutcome = _outcome;
        m.challengeWindowEnd = block.timestamp + 6 hours;
        emit ResolutionProposed(marketId, msg.sender, _outcome, m.challengeWindowEnd);
    }

    function challengeResolution(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(
            m.resolutionPhase == ResolutionPhase.PROPOSED ||
            m.resolutionPhase == ResolutionPhase.CHALLENGED,
            "No active proposal"
        );
        require(block.timestamp < m.challengeWindowEnd, "Challenge window closed");
        require(msg.sender != m.proposer, "Proposer cannot challenge");
        require(m.challengeCount < MAX_CHALLENGES, "Max challenges reached");
        require(!hasChallenged[marketId][msg.sender], "Already challenged this market");
        m.resolutionPhase = ResolutionPhase.CHALLENGED;
        m.challengeCount++;
        hasChallenged[marketId][msg.sender] = true;
        m.challengeWindowEnd = block.timestamp + 3 hours;
        emit ResolutionChallenged(marketId, msg.sender, m.challengeCount, m.challengeWindowEnd);
    }

    /// @notice Finalize unchallenged resolution (public — uses proposedOutcome)
    function finalizeResolution(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Already resolved");
        require(m.resolutionPhase == ResolutionPhase.PROPOSED, "Not in PROPOSED phase");
        require(block.timestamp >= m.challengeWindowEnd, "Challenge window not closed");
        m.resolved = true;
        m.outcome = m.proposedOutcome;
        m.resolutionPhase = ResolutionPhase.FINALIZED;
        emit MarketResolved(marketId, m.proposedOutcome);
        emit ResolutionFinalized(marketId, m.proposedOutcome);
    }

    /// @notice Admin finalize after challenge (owner only — can override outcome)
    function adminFinalizeResolution(uint256 marketId, bool _outcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Already resolved");
        require(m.resolutionPhase == ResolutionPhase.CHALLENGED, "Not in CHALLENGED phase");
        require(block.timestamp >= m.challengeWindowEnd, "Challenge window not closed");
        m.resolved = true;
        m.outcome = _outcome;
        m.resolutionPhase = ResolutionPhase.FINALIZED;
        emit MarketResolved(marketId, _outcome);
        emit ResolutionFinalized(marketId, _outcome);
    }

    // ============================================================
    //                      CANCEL / REFUND
    // ============================================================

    function cancelMarket(uint256 marketId) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        m.resolved = true;
        m.cancelled = true;
        emit MarketCancelled(marketId);
    }

    // ============================================================
    //                      AGENT FUNCTIONS
    // ============================================================

    /// @notice Agent buys shares via NFA contract (uses CPMM)
    function agentBuy(
        uint256 agentTokenId,
        uint256 marketId,
        bool buyYes,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        require(msg.sender == nfaContract, "Only NFA contract");
        require(amount > 0, "Amount must be > 0");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(!m.resolved, "Market already resolved");
        require(block.timestamp < m.endTime, "Market ended");
        require(m.yesReserve > 0 && m.noReserve > 0, "No liquidity");

        // NFA contract must have approved USDT
        require(usdtToken.transferFrom(nfaContract, address(this), amount), "USDT transfer failed");

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        accumulatedFees += fee; // Simplified: all fee to protocol for agent trades

        uint256 k = m.yesReserve * m.noReserve;

        if (buyYes) {
            uint256 newNoReserve = m.noReserve + netAmount;
            uint256 newYesReserve = k / newNoReserve;
            sharesOut = netAmount + (m.yesReserve - newYesReserve);
            m.yesReserve = newYesReserve;
            m.noReserve = newNoReserve;
        } else {
            uint256 newYesReserve = m.yesReserve + netAmount;
            uint256 newNoReserve = k / newYesReserve;
            sharesOut = netAmount + (m.noReserve - newNoReserve);
            m.noReserve = newNoReserve;
            m.yesReserve = newYesReserve;
        }

        require(sharesOut > 0, "Zero shares output");
        require(m.yesReserve >= MIN_RESERVE && m.noReserve >= MIN_RESERVE, "Trade too large");

        m.totalCollateral += netAmount;
        if (buyYes) {
            _mint(nfaContract, getYesTokenId(marketId), sharesOut, "");
            agentYesBalance[marketId][agentTokenId] += sharesOut;
        } else {
            _mint(nfaContract, getNoTokenId(marketId), sharesOut, "");
            agentNoBalance[marketId][agentTokenId] += sharesOut;
        }

        emit AgentPositionTaken(marketId, agentTokenId, buyYes, amount);
        emit Trade(marketId, nfaContract, true, buyYes, amount, sharesOut, fee);
    }

    /// @notice Agent claim winnings
    function agentClaimWinnings(uint256 agentTokenId, uint256 marketId) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(m.resolved, "Market not resolved");
        require(!m.cancelled, "Market cancelled");

        uint256 winnerAmount;
        uint256 winningTokenId;

        if (m.outcome) {
            winnerAmount = agentYesBalance[marketId][agentTokenId];
            winningTokenId = getYesTokenId(marketId);
        } else {
            winnerAmount = agentNoBalance[marketId][agentTokenId];
            winningTokenId = getNoTokenId(marketId);
        }
        require(winnerAmount > 0, "No winning position");

        uint256 winnerSupply = totalSupply(winningTokenId);

        if (m.outcome) {
            agentYesBalance[marketId][agentTokenId] = 0;
        } else {
            agentNoBalance[marketId][agentTokenId] = 0;
        }

        _burn(nfaContract, winningTokenId, winnerAmount);
        uint256 reward = (winnerAmount * m.totalCollateral) / winnerSupply;
        m.totalCollateral -= reward;

        require(usdtToken.transfer(nfaContract, reward), "USDT transfer failed");
        emit WinningsClaimed(marketId, nfaContract, reward);
    }

    /// @notice Agent claim refund for cancelled market
    function agentClaimRefund(uint256 agentTokenId, uint256 marketId) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        require(m.cancelled, "Market not cancelled");

        uint256 yesAmount = agentYesBalance[marketId][agentTokenId];
        uint256 noAmount = agentNoBalance[marketId][agentTokenId];
        uint256 totalTokens = yesAmount + noAmount;
        require(totalTokens > 0, "No position");

        agentYesBalance[marketId][agentTokenId] = 0;
        agentNoBalance[marketId][agentTokenId] = 0;

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);

        if (yesAmount > 0) _burn(nfaContract, yesId, yesAmount);
        if (noAmount > 0) _burn(nfaContract, noId, noAmount);

        uint256 totalAllTokens = totalSupply(yesId) + totalSupply(noId) + totalTokens;
        uint256 refundAmount = (totalTokens * m.totalCollateral) / totalAllTokens;
        m.totalCollateral -= refundAmount;

        require(usdtToken.transfer(nfaContract, refundAmount), "USDT transfer failed");
        emit AgentRefundClaimed(marketId, agentTokenId, refundAmount);
    }

    // ============================================================
    //                      VIEW FUNCTIONS
    // ============================================================

    function getMarket(uint256 marketId) external view returns (
        string memory title,
        uint256 endTime,
        uint256 totalYes,
        uint256 totalNo,
        bool resolved,
        bool outcome,
        bool cancelled,
        bool oracleEnabled,
        address priceFeed,
        int256 targetPrice,
        uint8 resolutionType,
        int256 resolvedPrice
    ) {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        title = m.title;
        endTime = m.endTime;
        totalYes = totalSupply(marketId * 2);
        totalNo = totalSupply(marketId * 2 + 1);
        resolved = m.resolved;
        outcome = m.outcome;
        cancelled = m.cancelled;
        oracleEnabled = m.oracleEnabled;
        priceFeed = m.priceFeed;
        targetPrice = m.targetPrice;
        resolutionType = m.resolutionType;
        resolvedPrice = m.resolvedPrice;
    }

    function getMarketAmm(uint256 marketId) external view returns (
        uint256 yesReserve,
        uint256 noReserve,
        uint256 totalLpShares_,
        uint256 initialLiquidity,
        uint256 totalCollateral
    ) {
        Market storage m = markets[marketId];
        require(m.exists, "Market does not exist");
        yesReserve = m.yesReserve;
        noReserve = m.noReserve;
        totalLpShares_ = m.totalLpShares;
        initialLiquidity = m.initialLiquidity;
        totalCollateral = m.totalCollateral;
    }

    function isMarketCancelled(uint256 marketId) external view returns (bool) {
        require(markets[marketId].exists, "Market does not exist");
        return markets[marketId].cancelled;
    }

    function getPosition(uint256 marketId, address user) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        yesAmount = balanceOf(user, getYesTokenId(marketId));
        noAmount = balanceOf(user, getNoTokenId(marketId));
        claimed = false;
    }

    function getAgentPosition(uint256 marketId, uint256 agentTokenId) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        yesAmount = agentYesBalance[marketId][agentTokenId];
        noAmount = agentNoBalance[marketId][agentTokenId];
        claimed = false;
    }

    // ============================================================
    //                      ADMIN
    // ============================================================

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setNFAContract(address _nfa) external onlyOwner {
        require(_nfa != address(0), "Invalid NFA address");
        nfaContract = _nfa;
        emit NFAContractUpdated(_nfa);
    }

    function setMarketCreationFee(uint256 _fee) external onlyOwner {
        marketCreationFee = _fee;
        emit MarketCreationFeeUpdated(_fee);
    }

    function setMaxMarketsPerDay(uint256 _max) external onlyOwner {
        maxMarketsPerDay = _max;
        emit MaxMarketsPerDayUpdated(_max);
    }

    function setStrictArbitrationMode(bool enabled) external onlyOwner {
        strictArbitrationMode = enabled;
        emit StrictArbitrationModeUpdated(enabled);
    }

    function withdrawFees(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= accumulatedFees, "Exceeds accumulated fees");
        accumulatedFees -= amount;
        require(usdtToken.transfer(msg.sender, amount), "USDT transfer failed");
        emit FeesWithdrawn(msg.sender, amount);
    }

    // ============================================================
    //                      ERC1155 OVERRIDE
    // ============================================================

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
