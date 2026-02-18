// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IBinanceOracle.sol";

/// @title PredictionMarket - CTF-style binary prediction market on BSC
/// @notice Polymarket/Gnosis CTF model: splitPosition mints YES+NO tokens,
///         mergePositions burns them back, free transfer, redeem on resolution.
/// @dev Uses USDT (ERC-20) for collateral. ERC1155 tokens represent positions.
///      YES tokenId = marketId * 2, NO tokenId = marketId * 2 + 1.
contract PredictionMarket is ERC1155Supply, ReentrancyGuard, Ownable, Pausable {

    enum ResolutionPhase { NONE, PROPOSED, CHALLENGED, FINALIZED }

    struct Market {
        string title;
        uint256 endTime;
        uint256 totalCollateral;  // Total USDT locked in this market
        bool resolved;
        bool outcome; // true = Yes wins, false = No wins
        bool exists;
        bool cancelled;
        // Oracle fields
        bool oracleEnabled;
        address priceFeed;        // Oracle adapter address
        int256 targetPrice;       // Target price (8 decimals)
        uint8 resolutionType;     // 0=manual, 1=price_above, 2=price_below
        int256 resolvedPrice;     // Actual price at resolution
        // Arbitration fields
        ResolutionPhase resolutionPhase;
        address proposer;
        bool proposedOutcome;
        uint256 challengeWindowEnd;
        uint256 challengeCount;
    }

    IERC20 public usdtToken;

    mapping(address => uint256) public balances;
    mapping(uint256 => Market) internal markets;
    uint256 public nextMarketId;

    // User market creation
    uint256 public marketCreationFee;
    uint256 public maxMarketsPerDay;
    uint256 public constant MAX_CHALLENGES = 5;
    bool public strictArbitrationMode;
    address public nfaContract;

    uint256 public accumulatedFees;
    uint256 public nextWithdrawRequestId;

    mapping(address => uint256) public dailyMarketCount;
    mapping(address => uint256) public lastMarketCreationDay;
    mapping(uint256 => address) public marketCreator;
    mapping(uint256 => mapping(address => bool)) public hasChallenged;

    // Agent sub-ledger (multiple agents share nfaContract address)
    mapping(uint256 => mapping(uint256 => uint256)) public agentYesBalance;
    mapping(uint256 => mapping(uint256 => uint256)) public agentNoBalance;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event MarketCreated(uint256 indexed marketId, string title, uint256 endTime);
    event MarketResolved(uint256 indexed marketId, bool outcome);
    event PositionTaken(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount);
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
    event WithdrawRequested(address indexed user, uint256 amount, uint256 indexed requestId);
    // CTF events
    event PositionSplit(uint256 indexed marketId, address indexed user, uint256 amount);
    event PositionsMerged(uint256 indexed marketId, address indexed user, uint256 amount);
    event WinningsRedeemed(uint256 indexed marketId, address indexed user, uint256 amount);

    constructor(address _usdtToken) ERC1155("") Ownable(msg.sender) {
        require(_usdtToken != address(0), "Invalid USDT address");
        usdtToken = IERC20(_usdtToken);
        marketCreationFee = 10 * 1e18; // 10 USDT (18 decimals)
        maxMarketsPerDay = 3;
        strictArbitrationMode = true;
    }

    // --- Token ID Helpers ---

    /// @notice Get the YES token ID for a market
    /// @param marketId The market ID
    /// @return YES token ID = marketId * 2
    function getYesTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2;
    }

    /// @notice Get the NO token ID for a market
    /// @param marketId The market ID
    /// @return NO token ID = marketId * 2 + 1
    function getNoTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2 + 1;
    }

    // --- Deposit / Withdraw ---

    /// @notice Deposit USDT into the prediction market balance
    /// @param amount Amount of USDT to deposit (18 decimals)
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(usdtToken.transferFrom(msg.sender, address(this), amount), "USDT transfer failed");
        balances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @notice Withdraw USDT -- restricted to owner (relayer).
    /// All user withdrawals go through the backend /api/wallet/withdraw -> adminWithdraw.
    /// Public withdraw was removed because off-chain AMM balances diverge from on-chain
    /// balances, allowing users to double-withdraw via BscScan.
    function withdraw(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        require(usdtToken.transfer(msg.sender, amount), "USDT transfer failed");
        emit Withdraw(msg.sender, amount);
    }

    /// @notice Relayer withdrawal: owner sends USDT from the contract pool to a user.
    /// Used by the off-chain backend to process withdrawals for users whose profits
    /// exist only in the DB (off-chain AMM trading profits are not reflected in on-chain balances).
    /// @param user Recipient address
    /// @param amount Amount of USDT to send (18 decimals)
    function adminWithdraw(address user, uint256 amount) external onlyOwner nonReentrant {
        require(user != address(0), "Invalid address");
        require(amount > 0, "Amount must be > 0");
        require(usdtToken.transfer(user, amount), "USDT transfer failed");
        emit Withdraw(user, amount);
    }

    /// @notice NFA contract withdraws its own balance back to itself.
    /// Required because withdraw() is onlyOwner (relayer model).
    function nfaWithdraw(uint256 amount) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        require(usdtToken.transfer(msg.sender, amount), "USDT transfer failed");
        emit Withdraw(msg.sender, amount);
    }

    /// @notice User submits on-chain withdraw request. Keeper processes actual USDT transfer.
    /// @dev No on-chain balance check -- DB balance is the authority. Only emits event for gas efficiency.
    /// @param amount Amount of USDT the user wants to withdraw (18 decimals)
    function requestWithdraw(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        uint256 requestId = nextWithdrawRequestId++;
        emit WithdrawRequested(msg.sender, amount, requestId);
    }

    // --- Market Management ---

    /// @notice Create a new manually-resolved prediction market (owner only)
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

    /// @notice Create a new oracle-resolved prediction market (owner only)
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

    /// @notice Manually resolve a non-oracle market (owner only)
    function resolveMarket(
        uint256 marketId,
        bool outcome
    ) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Already resolved");
        require(!market.oracleEnabled, "Use resolveByOracle for oracle markets");
        require(!strictArbitrationMode, "Direct manual resolve disabled");
        require(block.timestamp >= market.endTime, "Market not ended");
        require(
            market.resolutionPhase != ResolutionPhase.PROPOSED &&
            market.resolutionPhase != ResolutionPhase.CHALLENGED,
            "Active arbitration in progress"
        );
        market.resolved = true;
        market.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    /// @notice Resolve an oracle-enabled market by reading the price feed
    function resolveByOracle(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Already resolved");
        require(market.oracleEnabled, "Not oracle market");
        require(block.timestamp >= market.endTime, "Market not ended");

        (, int256 currentPrice, , uint256 updatedAt, ) = AggregatorV2V3Interface(market.priceFeed).latestRoundData();
        require(currentPrice > 0, "Invalid oracle price");
        require(block.timestamp - updatedAt < 1 hours, "Stale oracle price");

        bool outcome;
        if (market.resolutionType == 1) {
            outcome = currentPrice >= market.targetPrice;
        } else {
            outcome = currentPrice <= market.targetPrice;
        }

        market.resolved = true;
        market.outcome = outcome;
        market.resolvedPrice = currentPrice;
        emit MarketResolved(marketId, outcome);
        emit OracleResolution(marketId, currentPrice, outcome);
    }

    // --- Arbitration State Machine ---

    /// @notice Propose a resolution outcome (market creator or owner)
    function proposeResolution(uint256 marketId, bool _outcome) external {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Already resolved");
        require(block.timestamp >= market.endTime, "Market not ended");
        require(market.resolutionPhase == ResolutionPhase.NONE, "Proposal already exists");
        require(
            msg.sender == owner() || msg.sender == marketCreator[marketId],
            "Only owner or market creator"
        );
        market.resolutionPhase = ResolutionPhase.PROPOSED;
        market.proposer = msg.sender;
        market.proposedOutcome = _outcome;
        market.challengeWindowEnd = block.timestamp + 6 hours;
        emit ResolutionProposed(marketId, msg.sender, _outcome, market.challengeWindowEnd);
    }

    /// @notice Challenge an active resolution proposal
    function challengeResolution(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(
            market.resolutionPhase == ResolutionPhase.PROPOSED ||
            market.resolutionPhase == ResolutionPhase.CHALLENGED,
            "No active proposal"
        );
        require(block.timestamp < market.challengeWindowEnd, "Challenge window closed");
        require(msg.sender != market.proposer, "Proposer cannot challenge");
        require(market.challengeCount < MAX_CHALLENGES, "Max challenges reached");
        require(!hasChallenged[marketId][msg.sender], "Already challenged this market");
        market.resolutionPhase = ResolutionPhase.CHALLENGED;
        market.challengeCount++;
        hasChallenged[marketId][msg.sender] = true;
        market.challengeWindowEnd = block.timestamp + 3 hours;
        emit ResolutionChallenged(marketId, msg.sender, market.challengeCount, market.challengeWindowEnd);
    }

    /// @notice Finalize resolution after challenge window closes (owner only)
    function finalizeResolution(uint256 marketId, bool _outcome) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Already resolved");
        require(
            market.resolutionPhase == ResolutionPhase.PROPOSED ||
            market.resolutionPhase == ResolutionPhase.CHALLENGED,
            "No active proposal"
        );
        require(block.timestamp >= market.challengeWindowEnd, "Challenge window not closed");
        market.resolved = true;
        market.outcome = _outcome;
        market.resolutionPhase = ResolutionPhase.FINALIZED;
        emit MarketResolved(marketId, _outcome);
        emit ResolutionFinalized(marketId, _outcome);
    }

    // --- CTF: Split / Merge ---

    /// @notice Split collateral into YES + NO tokens (1:1:1)
    /// @dev Restricted to owner (Relayer) to prevent bypassing off-chain AMM.
    /// @param marketId The market to split into
    /// @param amount Amount of USDT (from balance) to split
    function splitPosition(uint256 marketId, uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market ended");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        market.totalCollateral += amount;

        _mint(msg.sender, getYesTokenId(marketId), amount, "");
        _mint(msg.sender, getNoTokenId(marketId), amount, "");

        emit PositionSplit(marketId, msg.sender, amount);
    }

    /// @notice Merge YES + NO tokens back into collateral (1:1:1)
    /// @dev Restricted to owner (Relayer) to prevent bypassing off-chain AMM.
    /// @param marketId The market to merge from
    /// @param amount Amount of YES+NO token pairs to merge
    function mergePositions(uint256 marketId, uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market already resolved");

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);
        require(balanceOf(msg.sender, yesId) >= amount, "Insufficient YES tokens");
        require(balanceOf(msg.sender, noId) >= amount, "Insufficient NO tokens");

        _burn(msg.sender, yesId, amount);
        _burn(msg.sender, noId, amount);

        market.totalCollateral -= amount;
        balances[msg.sender] += amount;

        emit PositionsMerged(marketId, msg.sender, amount);
    }

    /// @notice Agent version of splitPosition (called by NFA contract only)
    function agentSplitPosition(uint256 agentTokenId, uint256 marketId, uint256 amount) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        require(amount > 0, "Amount must be > 0");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market ended");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        market.totalCollateral += amount;

        // Mint to nfaContract address
        _mint(nfaContract, getYesTokenId(marketId), amount, "");
        _mint(nfaContract, getNoTokenId(marketId), amount, "");

        // Track in agent sub-ledger
        agentYesBalance[marketId][agentTokenId] += amount;
        agentNoBalance[marketId][agentTokenId] += amount;

        emit PositionSplit(marketId, nfaContract, amount);
    }

    // --- Trading ---

    /// @notice Take a YES or NO position on a market using deposited balance
    /// @dev Restricted to owner (Relayer) to prevent bypassing off-chain AMM pricing.
    ///      Users trade via the backend AMM; only the Relayer syncs state on-chain.
    function takePosition(
        uint256 marketId,
        bool isYes,
        uint256 amount
    ) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market ended");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        market.totalCollateral += amount;

        if (isYes) {
            _mint(msg.sender, getYesTokenId(marketId), amount, "");
        } else {
            _mint(msg.sender, getNoTokenId(marketId), amount, "");
        }

        emit PositionTaken(marketId, msg.sender, isYes, amount);
    }

    // --- Claim Winnings ---

    /// @notice Claim winnings from a resolved (non-cancelled) market
    /// @dev Restricted to owner (Relayer). Settlement is handled off-chain by keeper.
    function claimWinnings(uint256 marketId) external onlyOwner nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.resolved, "Market not resolved");
        require(!market.cancelled, "Market cancelled, use claimRefund");

        uint256 winningTokenId;
        if (market.outcome) {
            winningTokenId = getYesTokenId(marketId);
        } else {
            winningTokenId = getNoTokenId(marketId);
        }

        uint256 winnerAmount = balanceOf(msg.sender, winningTokenId);
        require(winnerAmount > 0, "No winning position");

        uint256 winnerSupply = totalSupply(winningTokenId);

        // Burn all winning tokens
        _burn(msg.sender, winningTokenId, winnerAmount);

        // payout = tokens * totalCollateral / winnerSupply
        uint256 reward = (winnerAmount * market.totalCollateral) / winnerSupply;
        market.totalCollateral -= reward;

        balances[msg.sender] += reward;
        emit WinningsClaimed(marketId, msg.sender, reward);
    }

    // --- View ---

    /// @notice Get full market data
    function getMarket(
        uint256 marketId
    )
        external
        view
        returns (
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
        )
    {
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

    /// @notice Check if a market has been cancelled
    function isMarketCancelled(uint256 marketId) external view returns (bool) {
        require(markets[marketId].exists, "Market does not exist");
        return markets[marketId].cancelled;
    }

    /// @notice Get a user's position on a market (reads ERC1155 balances)
    function getPosition(
        uint256 marketId,
        address user
    ) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        yesAmount = balanceOf(user, getYesTokenId(marketId));
        noAmount = balanceOf(user, getNoTokenId(marketId));
        claimed = false; // In CTF model, claimed = (balance == 0 after resolution)
    }

    // --- Admin ---

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- User Market Creation ---

    /// @notice Create a user-generated market with a USDT creation fee
    /// @dev Caller must approve this contract for at least marketCreationFee USDT before calling
    function createUserMarket(
        string calldata title,
        uint256 endTime,
        uint256 initialLiquidity
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(bytes(title).length >= 10, "Title too short");
        require(bytes(title).length <= 200, "Title too long");
        require(endTime > block.timestamp + 1 hours, "End time too soon");
        require(endTime <= block.timestamp + 90 days, "End time too far");

        // Daily rate limit
        uint256 today = block.timestamp / 86400;
        if (lastMarketCreationDay[msg.sender] != today) {
            dailyMarketCount[msg.sender] = 0;
            lastMarketCreationDay[msg.sender] = today;
        }
        require(dailyMarketCount[msg.sender] < maxMarketsPerDay, "Daily market limit reached");
        dailyMarketCount[msg.sender]++;

        // Collect creation fee in USDT
        require(usdtToken.transferFrom(msg.sender, address(this), marketCreationFee), "Fee transfer failed");
        accumulatedFees += marketCreationFee;

        // Create market
        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.title = title;
        m.endTime = endTime;
        m.exists = true;

        marketCreator[marketId] = msg.sender;

        // Initial liquidity: split into YES + NO tokens (CTF 1:1:1 -- 1 USDT = 1 YES + 1 NO)
        if (initialLiquidity > 0) {
            require(balances[msg.sender] >= initialLiquidity, "Insufficient balance for liquidity");
            balances[msg.sender] -= initialLiquidity;
            markets[marketId].totalCollateral += initialLiquidity;

            _mint(msg.sender, getYesTokenId(marketId), initialLiquidity, "");
            _mint(msg.sender, getNoTokenId(marketId), initialLiquidity, "");
        }

        emit MarketCreated(marketId, title, endTime);
        emit UserMarketCreated(marketId, msg.sender, title, marketCreationFee);
        return marketId;
    }

    // --- Agent Position ---

    /// @notice Take a position on behalf of an NFA agent (called by NFA contract only)
    function agentTakePosition(
        uint256 agentTokenId,
        uint256 marketId,
        bool isYes,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        require(amount > 0, "Amount must be > 0");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market ended");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        market.totalCollateral += amount;

        if (isYes) {
            _mint(nfaContract, getYesTokenId(marketId), amount, "");
            agentYesBalance[marketId][agentTokenId] += amount;
        } else {
            _mint(nfaContract, getNoTokenId(marketId), amount, "");
            agentNoBalance[marketId][agentTokenId] += amount;
        }

        emit AgentPositionTaken(marketId, agentTokenId, isYes, amount);
    }

    /// @notice Claim agent winnings from a resolved market (called by NFA contract only)
    function agentClaimWinnings(uint256 agentTokenId, uint256 marketId) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.resolved, "Market not resolved");
        require(!market.cancelled, "Market cancelled");

        uint256 winnerAmount;
        uint256 winningTokenId;

        if (market.outcome) {
            winnerAmount = agentYesBalance[marketId][agentTokenId];
            winningTokenId = getYesTokenId(marketId);
        } else {
            winnerAmount = agentNoBalance[marketId][agentTokenId];
            winningTokenId = getNoTokenId(marketId);
        }

        require(winnerAmount > 0, "No winning position");

        uint256 winnerSupply = totalSupply(winningTokenId);

        // Clear agent sub-ledger
        if (market.outcome) {
            agentYesBalance[marketId][agentTokenId] = 0;
        } else {
            agentNoBalance[marketId][agentTokenId] = 0;
        }

        // Burn from nfaContract
        _burn(nfaContract, winningTokenId, winnerAmount);

        // payout = tokens * totalCollateral / winnerSupply
        uint256 reward = (winnerAmount * market.totalCollateral) / winnerSupply;
        market.totalCollateral -= reward;

        balances[nfaContract] += reward;
        emit WinningsClaimed(marketId, nfaContract, reward);
    }

    // --- Cancel Market (refund mechanism) ---

    /// @notice Cancel a market and enable refunds for all participants (owner only)
    function cancelMarket(uint256 marketId) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market already resolved");
        market.resolved = true;
        market.cancelled = true;
        emit MarketCancelled(marketId);
    }

    /// @notice Claim refund for a cancelled market (burn all tokens, get proportional collateral)
    function claimRefund(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.cancelled, "Market not cancelled");

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);
        uint256 userYes = balanceOf(msg.sender, yesId);
        uint256 userNo = balanceOf(msg.sender, noId);
        uint256 totalTokens = userYes + userNo;
        require(totalTokens > 0, "No position");

        // Burn user's tokens
        if (userYes > 0) _burn(msg.sender, yesId, userYes);
        if (userNo > 0) _burn(msg.sender, noId, userNo);

        // Refund proportional to tokens held
        uint256 totalAllTokens = totalSupply(yesId) + totalSupply(noId) + totalTokens; // supply after burn + burned amount
        uint256 refundAmount = (totalTokens * market.totalCollateral) / totalAllTokens;
        market.totalCollateral -= refundAmount;

        balances[msg.sender] += refundAmount;
        emit RefundClaimed(marketId, msg.sender, refundAmount);
    }

    /// @notice Claim agent refund for a cancelled market (called by NFA contract only)
    function agentClaimRefund(uint256 agentTokenId, uint256 marketId) external nonReentrant whenNotPaused {
        require(msg.sender == nfaContract, "Only NFA contract");
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.cancelled, "Market not cancelled");

        uint256 yesAmount = agentYesBalance[marketId][agentTokenId];
        uint256 noAmount = agentNoBalance[marketId][agentTokenId];
        uint256 totalTokens = yesAmount + noAmount;
        require(totalTokens > 0, "No position");

        // Clear sub-ledger
        agentYesBalance[marketId][agentTokenId] = 0;
        agentNoBalance[marketId][agentTokenId] = 0;

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);

        // Burn from nfaContract
        if (yesAmount > 0) _burn(nfaContract, yesId, yesAmount);
        if (noAmount > 0) _burn(nfaContract, noId, noAmount);

        // Refund proportional to tokens held
        uint256 totalAllTokens = totalSupply(yesId) + totalSupply(noId) + totalTokens;
        uint256 refundAmount = (totalTokens * market.totalCollateral) / totalAllTokens;
        market.totalCollateral -= refundAmount;

        balances[nfaContract] += refundAmount;
        emit AgentRefundClaimed(marketId, agentTokenId, refundAmount);
    }

    // --- View: Agent Position ---

    /// @notice Get an agent's position on a market
    function getAgentPosition(
        uint256 marketId,
        uint256 agentTokenId
    ) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        yesAmount = agentYesBalance[marketId][agentTokenId];
        noAmount = agentNoBalance[marketId][agentTokenId];
        claimed = false; // In CTF, claimed = sub-ledger zeroed
    }

    // --- Admin: User Market Settings ---

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

    /// @notice Enable/disable strict arbitration mode for manual markets.
    /// @dev When enabled, direct resolveMarket is disabled and users must use propose/challenge/finalize.
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

    // No receive() -- contract does not accept native BNB, all payments in USDT

    // --- ERC1155 Override ---

    /// @notice Required for multiple inheritance (ERC1155Supply)
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
