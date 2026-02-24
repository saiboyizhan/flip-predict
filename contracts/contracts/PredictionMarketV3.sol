// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IBinanceOracle.sol";

/// @title PredictionMarketV3 - UUPS Upgradeable CPMM + Agent + Oracle + Arbitration
/// @dev Limit order book moved to separate LimitOrderBook.sol contract.
contract PredictionMarketV3 is
    Initializable,
    ERC1155SupplyUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ============================================================
    //  CUSTOM ERRORS
    // ============================================================

    error ZeroAmount();
    error MarketNotFound();
    error MktResolved();
    error MarketEnded();
    error NoLiquidity();
    error TransferFailed();
    error ZeroOutput();
    error TradeTooLarge();
    error InsufficientShares();
    error MarketNotInit();
    error InsufficientLpShares();
    error MktCancelled();
    error NoWinningPosition();
    error InvalidEndTime();
    error TitleTooShort();
    error TitleTooLong();
    error EndTimeTooSoon();
    error EndTimeTooFar();
    error LiqTooLow();
    error DailyLimitReached();
    error AlreadyResolved();
    error ManualDisabled();
    error NotAuthorized();
    error ReserveDepleted();
    error NoLpShares();
    error NotCancelled();
    error NoPosition();
    error ExceedsFees();
    error InvalidAddress();
    // Oracle errors
    error OracleOnly();
    error NotOracleMarket();
    error InvalidPriceFeed();
    error InvalidResType();
    error InvalidOraclePrice();
    error StaleOraclePrice();
    // Arbitration errors
    error ProposalExists();
    error NotOwnerOrCreator();
    error NoActiveProposal();
    error ChallengeWindowClosed();
    error ProposerCannotChallenge();
    error MaxChallengesReached();
    error AlreadyChallengedMkt();
    error NotProposedPhase();
    error ChallengeWindowOpen();
    error NotChallengedPhase();
    error ArbitrationInProgress();
    // Agent errors
    error OnlyNFA();

    // ============================================================

    enum ResolutionPhase { NONE, PROPOSED, CHALLENGED, FINALIZED }

    struct Market {
        string title;
        uint256 endTime;
        uint256 totalCollateral;
        bool resolved;
        bool outcome;
        bool exists;
        bool cancelled;
        bool oracleEnabled;
        address priceFeed;
        int256 targetPrice;
        uint8 resolutionType;
        int256 resolvedPrice;
        ResolutionPhase resolutionPhase;
        address proposer;
        bool proposedOutcome;
        uint256 challengeWindowEnd;
        uint256 challengeCount;
        uint256 yesReserve;
        uint256 noReserve;
        uint256 totalLpShares;
        uint256 initialLiquidity;
    }

    // ============================================================
    //  STORAGE -- slots 0-14 (must match V2 layout)
    // ============================================================

    IERC20 public usdtToken;                                              // slot 0
    mapping(uint256 => Market) internal markets;                          // slot 1
    uint256 public nextMarketId;                                          // slot 2
    mapping(uint256 => mapping(address => uint256)) public lpShares;      // slot 3
    uint256 public marketCreationFee;                                     // slot 4
    uint256 public maxMarketsPerDay;                                      // slot 5
    uint256 public constant MAX_CHALLENGES = 5;
    bool public strictArbitrationMode;                                    // slot 6
    address public nfaContract;                                           // slot 7
    uint256 public accumulatedFees;                                       // slot 8
    mapping(address => uint256) public dailyMarketCount;                  // slot 9
    mapping(address => uint256) public lastMarketCreationDay;             // slot 10
    mapping(uint256 => address) public marketCreator;                     // slot 11
    mapping(uint256 => mapping(address => bool)) public hasChallenged;    // slot 12
    mapping(uint256 => mapping(uint256 => uint256)) public agentYesBalance; // slot 13
    mapping(uint256 => mapping(uint256 => uint256)) public agentNoBalance;  // slot 14

    // ============================================================
    //  CONSTANTS
    // ============================================================

    uint256 public constant MIN_RESERVE = 1e18;
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant LP_FEE_SHARE = 8000;
    uint256 public constant PROTOCOL_FEE_SHARE = 2000;
    uint256 public constant MIN_INITIAL_LIQUIDITY = 10e18;

    // ============================================================
    //  EVENTS
    // ============================================================

    event MarketCreated(uint256 indexed marketId, string title, uint256 endTime);
    event MarketResolved(uint256 indexed marketId, bool outcome);
    event Trade(uint256 indexed marketId, address indexed user, bool isBuy, bool side, uint256 amount, uint256 shares, uint256 fee);
    event LiquidityAdded(uint256 indexed marketId, address indexed user, uint256 amount, uint256 lpSharesMinted);
    event LiquidityRemoved(uint256 indexed marketId, address indexed user, uint256 sharesBurned, uint256 usdtOut);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event RefundClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee);
    event MarketCreationFeeUpdated(uint256 newFee);
    event MaxMarketsPerDayUpdated(uint256 newMax);
    event NFAContractUpdated(address nfaContract);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event MarketCancelled(uint256 indexed marketId);
    event LpClaimedAfterResolution(uint256 indexed marketId, address indexed user, uint256 sharesBurned, uint256 payout);
    event LpRefundedAfterCancel(uint256 indexed marketId, address indexed user, uint256 sharesBurned, uint256 refund);
    event StrictArbitrationModeUpdated(bool enabled);
    event PositionSplit(uint256 indexed marketId, address indexed user, uint256 amount);
    event PositionsMerged(uint256 indexed marketId, address indexed user, uint256 amount);
    // Oracle events
    event OracleMarketCreated(uint256 indexed marketId, address priceFeed, int256 targetPrice, uint8 resolutionType);
    event OracleResolution(uint256 indexed marketId, int256 price, bool outcome);
    // Arbitration events
    event ResolutionProposed(uint256 indexed marketId, address indexed proposer, bool proposedOutcome, uint256 challengeWindowEnd);
    event ResolutionChallenged(uint256 indexed marketId, address indexed challenger, uint256 challengeCount, uint256 newWindowEnd);
    event ResolutionFinalized(uint256 indexed marketId, bool outcome);
    // Agent events
    event AgentPositionTaken(uint256 indexed marketId, uint256 indexed agentTokenId, bool isYes, uint256 amount);
    event AgentRefundClaimed(uint256 indexed marketId, uint256 indexed agentTokenId, uint256 amount);

    // ============================================================
    //  INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _usdtToken) public initializer {
        if (_usdtToken == address(0)) revert InvalidAddress();
        __ERC1155_init("");
        __ERC1155Supply_init();
        __ReentrancyGuard_init();
        __Ownable_init(msg.sender);
        __Pausable_init();
        __UUPSUpgradeable_init();
        usdtToken = IERC20(_usdtToken);
        marketCreationFee = 10 * 1e18;
        maxMarketsPerDay = 3;
        strictArbitrationMode = true;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============================================================
    //  INTERNAL HELPERS
    // ============================================================

    function _activeMarket(uint256 marketId) internal view returns (Market storage m) {
        m = markets[marketId];
        if (!m.exists) revert MarketNotFound();
        if (m.resolved) revert MktResolved();
        if (block.timestamp >= m.endTime) revert MarketEnded();
    }

    function _existingMarket(uint256 marketId) internal view returns (Market storage m) {
        m = markets[marketId];
        if (!m.exists) revert MarketNotFound();
    }

    // ============================================================
    //  TOKEN ID HELPERS
    // ============================================================

    function getYesTokenId(uint256 marketId) public pure returns (uint256) { return marketId * 2; }
    function getNoTokenId(uint256 marketId) public pure returns (uint256) { return marketId * 2 + 1; }

    // ============================================================
    //  CPMM TRADING
    // ============================================================

    function buy(
        uint256 marketId, bool buyYes, uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        if (m.yesReserve == 0 || m.noReserve == 0) revert NoLiquidity();
        if (!usdtToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        uint256 lpFee = (fee * LP_FEE_SHARE) / BPS_DENOMINATOR;
        accumulatedFees += fee - lpFee;

        if (m.totalLpShares > 0) {
            uint256 totalRes = m.yesReserve + m.noReserve;
            m.yesReserve += (lpFee * m.yesReserve) / totalRes;
            m.noReserve += (lpFee * m.noReserve) / totalRes;
        } else {
            accumulatedFees += lpFee;
        }

        uint256 k = m.yesReserve * m.noReserve;
        if (buyYes) {
            uint256 newNo = m.noReserve + netAmount;
            uint256 newYes = k / newNo;
            sharesOut = netAmount + (m.yesReserve - newYes);
            m.yesReserve = newYes;
            m.noReserve = newNo;
        } else {
            uint256 newYes = m.yesReserve + netAmount;
            uint256 newNo = k / newYes;
            sharesOut = netAmount + (m.noReserve - newNo);
            m.noReserve = newNo;
            m.yesReserve = newYes;
        }

        if (sharesOut == 0) revert ZeroOutput();
        if (m.yesReserve < MIN_RESERVE || m.noReserve < MIN_RESERVE) revert TradeTooLarge();
        m.totalCollateral += netAmount;
        _mint(msg.sender, buyYes ? getYesTokenId(marketId) : getNoTokenId(marketId), sharesOut, "");
        emit Trade(marketId, msg.sender, true, buyYes, amount, sharesOut, fee);
    }

    function sell(
        uint256 marketId, bool sellYes, uint256 shares
    ) external nonReentrant whenNotPaused returns (uint256 usdtOut) {
        if (shares == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        if (m.yesReserve == 0 || m.noReserve == 0) revert NoLiquidity();

        uint256 tokenId = sellYes ? getYesTokenId(marketId) : getNoTokenId(marketId);
        if (balanceOf(msg.sender, tokenId) < shares) revert InsufficientShares();

        uint256 c = sellYes ? shares * m.noReserve : shares * m.yesReserve;
        uint256 b = m.yesReserve + m.noReserve + shares;
        uint256 sqrtDisc = Math.sqrt(b * b - 4 * c);
        uint256 grossOut = (b - sqrtDisc) / 2;
        if (grossOut == 0) revert ZeroOutput();

        if (sellYes) {
            m.yesReserve = m.yesReserve + shares - grossOut;
            m.noReserve -= grossOut;
        } else {
            m.noReserve = m.noReserve + shares - grossOut;
            m.yesReserve -= grossOut;
        }
        if (m.yesReserve < MIN_RESERVE || m.noReserve < MIN_RESERVE) revert TradeTooLarge();

        uint256 fee = (grossOut * FEE_BPS) / BPS_DENOMINATOR;
        usdtOut = grossOut - fee;
        uint256 lpFee = (fee * LP_FEE_SHARE) / BPS_DENOMINATOR;
        accumulatedFees += fee - lpFee;

        if (m.totalLpShares > 0) {
            uint256 totalRes = m.yesReserve + m.noReserve;
            m.yesReserve += (lpFee * m.yesReserve) / totalRes;
            m.noReserve += (lpFee * m.noReserve) / totalRes;
        } else {
            accumulatedFees += lpFee;
        }

        _burn(msg.sender, tokenId, shares);
        m.totalCollateral -= grossOut;
        if (!usdtToken.transfer(msg.sender, usdtOut)) revert TransferFailed();
        emit Trade(marketId, msg.sender, false, sellYes, usdtOut, shares, fee);
    }

    function getPrice(uint256 marketId) external view returns (uint256 yesPrice, uint256 noPrice) {
        Market storage m = _existingMarket(marketId);
        if (m.yesReserve == 0 && m.noReserve == 0) return (5e17, 5e17);
        uint256 total = m.yesReserve + m.noReserve;
        yesPrice = (m.noReserve * 1e18) / total;
        noPrice = 1e18 - yesPrice;
    }

    function getReserves(uint256 marketId) external view returns (uint256 yesReserve, uint256 noReserve) {
        Market storage m = markets[marketId];
        return (m.yesReserve, m.noReserve);
    }

    // ============================================================
    //  LIQUIDITY PROVIDER
    // ============================================================

    function addLiquidity(
        uint256 marketId, uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 newShares) {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        if (m.yesReserve == 0 || m.noReserve == 0) revert MarketNotInit();
        if (!usdtToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        uint256 poolValue = m.yesReserve + m.noReserve;
        newShares = m.totalLpShares == 0 ? amount : (m.totalLpShares * amount) / poolValue;
        if (newShares == 0) revert ZeroOutput();

        uint256 addYes = (amount * m.yesReserve) / poolValue;
        m.yesReserve += addYes;
        m.noReserve += amount - addYes;
        m.totalLpShares += newShares;
        m.totalCollateral += amount;
        lpShares[marketId][msg.sender] += newShares;
        emit LiquidityAdded(marketId, msg.sender, amount, newShares);
    }

    function removeLiquidity(
        uint256 marketId, uint256 sharesToBurn
    ) external nonReentrant whenNotPaused returns (uint256 usdtOut) {
        if (sharesToBurn == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        if (m.cancelled) revert MktCancelled();
        if (lpShares[marketId][msg.sender] < sharesToBurn) revert InsufficientLpShares();

        usdtOut = (sharesToBurn * m.totalCollateral) / m.totalLpShares;
        if (usdtOut == 0) revert ZeroOutput();

        uint256 poolValue = m.yesReserve + m.noReserve;
        uint256 removeYes = (usdtOut * m.yesReserve) / poolValue;
        uint256 removeNo = usdtOut - removeYes;
        uint256 minRes = m.initialLiquidity / 2;
        if (minRes < MIN_RESERVE) minRes = MIN_RESERVE;
        if (m.yesReserve - removeYes < minRes || m.noReserve - removeNo < minRes) revert ReserveDepleted();

        m.yesReserve -= removeYes;
        m.noReserve -= removeNo;
        m.totalLpShares -= sharesToBurn;
        m.totalCollateral -= usdtOut;
        lpShares[marketId][msg.sender] -= sharesToBurn;
        if (!usdtToken.transfer(msg.sender, usdtOut)) revert TransferFailed();
        emit LiquidityRemoved(marketId, msg.sender, sharesToBurn, usdtOut);
    }

    function getLpInfo(uint256 marketId, address user) external view returns (
        uint256 totalShares, uint256 userLpShares, uint256 poolValue, uint256 userValue, uint256 yesReserve, uint256 noReserve
    ) {
        Market storage m = markets[marketId];
        totalShares = m.totalLpShares;
        yesReserve = m.yesReserve;
        noReserve = m.noReserve;
        poolValue = yesReserve + noReserve;
        userLpShares = lpShares[marketId][user];
        if (totalShares > 0) userValue = (userLpShares * poolValue) / totalShares;
    }

    // ============================================================
    //  CTF: SPLIT / MERGE
    // ============================================================

    function splitPosition(uint256 marketId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        if (!usdtToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        m.totalCollateral += amount;
        _mint(msg.sender, getYesTokenId(marketId), amount, "");
        _mint(msg.sender, getNoTokenId(marketId), amount, "");
        emit PositionSplit(marketId, msg.sender, amount);
    }

    function mergePositions(uint256 marketId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);
        if (balanceOf(msg.sender, yesId) < amount || balanceOf(msg.sender, noId) < amount) revert InsufficientShares();
        _burn(msg.sender, yesId, amount);
        _burn(msg.sender, noId, amount);
        m.totalCollateral -= amount;
        if (!usdtToken.transfer(msg.sender, amount)) revert TransferFailed();
        emit PositionsMerged(marketId, msg.sender, amount);
    }

    // ============================================================
    //  CLAIM WINNINGS
    // ============================================================

    function claimWinnings(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = _existingMarket(marketId);
        if (!m.resolved) revert AlreadyResolved();
        if (m.cancelled) revert MktCancelled();

        uint256 winningTokenId = m.outcome ? getYesTokenId(marketId) : getNoTokenId(marketId);
        uint256 winnerAmount = balanceOf(msg.sender, winningTokenId);
        if (winnerAmount == 0) revert NoWinningPosition();

        uint256 winnerSupply = totalSupply(winningTokenId);
        _burn(msg.sender, winningTokenId, winnerAmount);
        uint256 reward = (winnerAmount * m.totalCollateral) / winnerSupply;
        m.totalCollateral -= reward;
        if (!usdtToken.transfer(msg.sender, reward)) revert TransferFailed();
        emit WinningsClaimed(marketId, msg.sender, reward);
    }

    function claimRefund(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = _existingMarket(marketId);
        if (!m.cancelled) revert NotCancelled();

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);
        uint256 userYes = balanceOf(msg.sender, yesId);
        uint256 userNo = balanceOf(msg.sender, noId);
        uint256 totalTokens = userYes + userNo;
        if (totalTokens == 0) revert NoPosition();

        if (userYes > 0) _burn(msg.sender, yesId, userYes);
        if (userNo > 0) _burn(msg.sender, noId, userNo);
        uint256 totalAllTokens = totalSupply(yesId) + totalSupply(noId) + totalTokens;
        uint256 refundAmount = (totalTokens * m.totalCollateral) / totalAllTokens;
        m.totalCollateral -= refundAmount;
        if (!usdtToken.transfer(msg.sender, refundAmount)) revert TransferFailed();
        emit RefundClaimed(marketId, msg.sender, refundAmount);
    }

    // ============================================================
    //  MARKET MANAGEMENT
    // ============================================================

    function createMarket(string calldata title, uint256 endTime) external onlyOwner returns (uint256) {
        if (endTime <= block.timestamp) revert InvalidEndTime();
        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.title = title;
        m.endTime = endTime;
        m.exists = true;
        emit MarketCreated(marketId, title, endTime);
        return marketId;
    }

    function createOracleMarket(
        string calldata title, uint256 endTime, address priceFeed, int256 targetPrice, uint8 resolutionType
    ) external onlyOwner returns (uint256) {
        if (endTime <= block.timestamp) revert InvalidEndTime();
        if (priceFeed == address(0)) revert InvalidPriceFeed();
        if (resolutionType != 1 && resolutionType != 2) revert InvalidResType();
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

    function createUserMarket(
        string calldata title, uint256 endTime, uint256 initialLiq
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (bytes(title).length < 10) revert TitleTooShort();
        if (bytes(title).length > 200) revert TitleTooLong();
        if (endTime <= block.timestamp + 1 hours) revert EndTimeTooSoon();
        if (endTime > block.timestamp + 90 days) revert EndTimeTooFar();
        if (initialLiq < MIN_INITIAL_LIQUIDITY) revert LiqTooLow();

        uint256 today = block.timestamp / 86400;
        if (lastMarketCreationDay[msg.sender] != today) {
            dailyMarketCount[msg.sender] = 0;
            lastMarketCreationDay[msg.sender] = today;
        }
        if (dailyMarketCount[msg.sender] >= maxMarketsPerDay) revert DailyLimitReached();
        dailyMarketCount[msg.sender]++;

        uint256 totalTransfer = marketCreationFee + initialLiq;
        if (!usdtToken.transferFrom(msg.sender, address(this), totalTransfer)) revert TransferFailed();
        accumulatedFees += marketCreationFee;

        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.title = title;
        m.endTime = endTime;
        m.exists = true;
        m.yesReserve = initialLiq;
        m.noReserve = initialLiq;
        m.initialLiquidity = initialLiq;
        m.totalCollateral = initialLiq;
        m.totalLpShares = initialLiq;
        marketCreator[marketId] = msg.sender;
        lpShares[marketId][msg.sender] = initialLiq;

        emit MarketCreated(marketId, title, endTime);
        emit UserMarketCreated(marketId, msg.sender, title, marketCreationFee);
        emit LiquidityAdded(marketId, msg.sender, initialLiq, initialLiq);
        return marketId;
    }

    // ============================================================
    //  RESOLUTION
    // ============================================================

    function resolveMarket(uint256 marketId, bool outcome) external onlyOwner {
        Market storage m = _existingMarket(marketId);
        if (m.resolved) revert AlreadyResolved();
        if (m.oracleEnabled) revert OracleOnly();
        if (!strictArbitrationMode) {
            // Direct manual resolve allowed when strict mode off
        } else {
            revert ManualDisabled();
        }
        if (block.timestamp < m.endTime) revert MarketEnded();
        if (m.resolutionPhase == ResolutionPhase.PROPOSED || m.resolutionPhase == ResolutionPhase.CHALLENGED) {
            revert ArbitrationInProgress();
        }
        m.resolved = true;
        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    function resolveByOracle(uint256 marketId) external {
        Market storage m = _existingMarket(marketId);
        if (m.resolved) revert AlreadyResolved();
        if (!m.oracleEnabled) revert NotOracleMarket();
        if (block.timestamp < m.endTime) revert MarketEnded();

        (uint80 roundId, int256 currentPrice, , uint256 updatedAt, uint80 answeredInRound) = AggregatorV2V3Interface(m.priceFeed).latestRoundData();
        require(answeredInRound >= roundId, "Stale oracle round");
        require(currentPrice > 0, "Invalid oracle price");
        if (block.timestamp - updatedAt >= 15 minutes) revert StaleOraclePrice();

        bool oracleOutcome;
        if (m.resolutionType == 1) {
            oracleOutcome = currentPrice >= m.targetPrice;
        } else {
            oracleOutcome = currentPrice <= m.targetPrice;
        }

        m.resolved = true;
        m.outcome = oracleOutcome;
        m.resolvedPrice = currentPrice;
        emit MarketResolved(marketId, oracleOutcome);
        emit OracleResolution(marketId, currentPrice, oracleOutcome);
    }

    // ============================================================
    //  ARBITRATION
    // ============================================================

    function proposeResolution(uint256 marketId, bool _outcome) external {
        Market storage m = _existingMarket(marketId);
        if (m.resolved) revert AlreadyResolved();
        if (block.timestamp < m.endTime) revert MarketEnded();
        if (m.resolutionPhase != ResolutionPhase.NONE) revert ProposalExists();
        if (msg.sender != owner() && msg.sender != marketCreator[marketId]) revert NotOwnerOrCreator();
        m.resolutionPhase = ResolutionPhase.PROPOSED;
        m.proposer = msg.sender;
        m.proposedOutcome = _outcome;
        m.challengeWindowEnd = block.timestamp + 6 hours;
        emit ResolutionProposed(marketId, msg.sender, _outcome, m.challengeWindowEnd);
    }

    function challengeResolution(uint256 marketId) external {
        Market storage m = _existingMarket(marketId);
        if (m.resolutionPhase != ResolutionPhase.PROPOSED && m.resolutionPhase != ResolutionPhase.CHALLENGED) {
            revert NoActiveProposal();
        }
        if (block.timestamp >= m.challengeWindowEnd) revert ChallengeWindowClosed();
        if (msg.sender == m.proposer) revert ProposerCannotChallenge();
        if (m.challengeCount >= MAX_CHALLENGES) revert MaxChallengesReached();
        if (hasChallenged[marketId][msg.sender]) revert AlreadyChallengedMkt();
        m.resolutionPhase = ResolutionPhase.CHALLENGED;
        m.challengeCount++;
        hasChallenged[marketId][msg.sender] = true;
        m.challengeWindowEnd = block.timestamp + 3 hours;
        emit ResolutionChallenged(marketId, msg.sender, m.challengeCount, m.challengeWindowEnd);
    }

    function finalizeResolution(uint256 marketId) external {
        Market storage m = _existingMarket(marketId);
        if (m.resolved) revert AlreadyResolved();
        if (m.resolutionPhase != ResolutionPhase.PROPOSED) revert NotProposedPhase();
        if (block.timestamp < m.challengeWindowEnd) revert ChallengeWindowOpen();
        m.resolved = true;
        m.outcome = m.proposedOutcome;
        m.resolutionPhase = ResolutionPhase.FINALIZED;
        emit MarketResolved(marketId, m.proposedOutcome);
        emit ResolutionFinalized(marketId, m.proposedOutcome);
    }

    function adminFinalizeResolution(uint256 marketId, bool _outcome) external onlyOwner {
        Market storage m = _existingMarket(marketId);
        if (m.resolved) revert AlreadyResolved();
        if (m.resolutionPhase != ResolutionPhase.CHALLENGED) revert NotChallengedPhase();
        if (block.timestamp < m.challengeWindowEnd) revert ChallengeWindowOpen();
        m.resolved = true;
        m.outcome = _outcome;
        m.resolutionPhase = ResolutionPhase.FINALIZED;
        emit MarketResolved(marketId, _outcome);
        emit ResolutionFinalized(marketId, _outcome);
    }

    // ============================================================
    //  CANCEL / REFUND
    // ============================================================

    function cancelMarket(uint256 marketId) external onlyOwner {
        Market storage m = _existingMarket(marketId);
        if (m.resolved) revert MktResolved();
        m.resolved = true;
        m.cancelled = true;
        emit MarketCancelled(marketId);
    }

    // ============================================================
    //  LP POST-RESOLUTION CLAIMS
    // ============================================================

    function lpClaimAfterResolution(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = _existingMarket(marketId);
        if (!m.resolved) revert AlreadyResolved();
        if (m.cancelled) revert MktCancelled();
        uint256 userShares = lpShares[marketId][msg.sender];
        if (userShares == 0) revert NoLpShares();

        uint256 winningReserve = m.outcome ? m.yesReserve : m.noReserve;
        uint256 payout = (userShares * winningReserve) / m.totalLpShares;
        if (payout == 0) revert ZeroOutput();

        lpShares[marketId][msg.sender] = 0;
        m.totalLpShares -= userShares;
        if (m.outcome) { m.yesReserve -= payout; } else { m.noReserve -= payout; }
        m.totalCollateral -= payout;
        if (!usdtToken.transfer(msg.sender, payout)) revert TransferFailed();
        emit LpClaimedAfterResolution(marketId, msg.sender, userShares, payout);
    }

    function lpRefundAfterCancel(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = _existingMarket(marketId);
        if (!m.cancelled) revert NotCancelled();
        uint256 userShares = lpShares[marketId][msg.sender];
        if (userShares == 0) revert NoLpShares();

        uint256 poolValue = m.yesReserve + m.noReserve;
        uint256 refund = (userShares * poolValue) / m.totalLpShares;
        if (refund == 0) revert ZeroOutput();

        uint256 removeYes = (refund * m.yesReserve) / poolValue;
        lpShares[marketId][msg.sender] = 0;
        m.totalLpShares -= userShares;
        m.yesReserve -= removeYes;
        m.noReserve -= (refund - removeYes);
        m.totalCollateral -= refund;
        if (!usdtToken.transfer(msg.sender, refund)) revert TransferFailed();
        emit LpRefundedAfterCancel(marketId, msg.sender, userShares, refund);
    }

    // ============================================================
    //  AGENT FUNCTIONS
    // ============================================================

    function agentBuy(
        uint256 agentTokenId, uint256 marketId, bool buyYes, uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        if (msg.sender != nfaContract) revert OnlyNFA();
        if (amount == 0) revert ZeroAmount();
        Market storage m = _activeMarket(marketId);
        if (m.yesReserve == 0 || m.noReserve == 0) revert NoLiquidity();

        if (!usdtToken.transferFrom(nfaContract, address(this), amount)) revert TransferFailed();

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        accumulatedFees += fee;

        uint256 k = m.yesReserve * m.noReserve;

        if (buyYes) {
            uint256 newNo = m.noReserve + netAmount;
            uint256 newYes = k / newNo;
            sharesOut = netAmount + (m.yesReserve - newYes);
            m.yesReserve = newYes;
            m.noReserve = newNo;
        } else {
            uint256 newYes = m.yesReserve + netAmount;
            uint256 newNo = k / newYes;
            sharesOut = netAmount + (m.noReserve - newNo);
            m.noReserve = newNo;
            m.yesReserve = newYes;
        }

        if (sharesOut == 0) revert ZeroOutput();
        if (m.yesReserve < MIN_RESERVE || m.noReserve < MIN_RESERVE) revert TradeTooLarge();

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

    function agentClaimWinnings(uint256 agentTokenId, uint256 marketId) external nonReentrant whenNotPaused {
        if (msg.sender != nfaContract) revert OnlyNFA();
        Market storage m = _existingMarket(marketId);
        if (!m.resolved) revert AlreadyResolved();
        if (m.cancelled) revert MktCancelled();

        uint256 winnerAmount;
        uint256 winningTokenId;

        if (m.outcome) {
            winnerAmount = agentYesBalance[marketId][agentTokenId];
            winningTokenId = getYesTokenId(marketId);
        } else {
            winnerAmount = agentNoBalance[marketId][agentTokenId];
            winningTokenId = getNoTokenId(marketId);
        }
        if (winnerAmount == 0) revert NoWinningPosition();

        uint256 winnerSupply = totalSupply(winningTokenId);

        if (m.outcome) {
            agentYesBalance[marketId][agentTokenId] = 0;
        } else {
            agentNoBalance[marketId][agentTokenId] = 0;
        }

        _burn(nfaContract, winningTokenId, winnerAmount);
        uint256 reward = (winnerAmount * m.totalCollateral) / winnerSupply;
        m.totalCollateral -= reward;

        if (!usdtToken.transfer(nfaContract, reward)) revert TransferFailed();
        emit WinningsClaimed(marketId, nfaContract, reward);
    }

    function agentClaimRefund(uint256 agentTokenId, uint256 marketId) external nonReentrant whenNotPaused {
        if (msg.sender != nfaContract) revert OnlyNFA();
        Market storage m = _existingMarket(marketId);
        if (!m.cancelled) revert NotCancelled();

        uint256 yesAmount = agentYesBalance[marketId][agentTokenId];
        uint256 noAmount = agentNoBalance[marketId][agentTokenId];
        uint256 totalTokens = yesAmount + noAmount;
        if (totalTokens == 0) revert NoPosition();

        agentYesBalance[marketId][agentTokenId] = 0;
        agentNoBalance[marketId][agentTokenId] = 0;

        uint256 yesId = getYesTokenId(marketId);
        uint256 noId = getNoTokenId(marketId);

        if (yesAmount > 0) _burn(nfaContract, yesId, yesAmount);
        if (noAmount > 0) _burn(nfaContract, noId, noAmount);

        uint256 totalAllTokens = totalSupply(yesId) + totalSupply(noId) + totalTokens;
        uint256 refundAmount = (totalTokens * m.totalCollateral) / totalAllTokens;
        m.totalCollateral -= refundAmount;

        if (!usdtToken.transfer(nfaContract, refundAmount)) revert TransferFailed();
        emit AgentRefundClaimed(marketId, agentTokenId, refundAmount);
    }

    // ============================================================
    //  VIEW FUNCTIONS
    // ============================================================

    function getMarket(uint256 marketId) external view returns (
        string memory title, uint256 endTime, uint256 totalYes, uint256 totalNo,
        bool resolved, bool outcome, bool cancelled, bool oracleEnabled,
        address priceFeed, int256 targetPrice, uint8 resolutionType, int256 resolvedPrice
    ) {
        Market storage m = _existingMarket(marketId);
        title = m.title; endTime = m.endTime;
        totalYes = totalSupply(marketId * 2); totalNo = totalSupply(marketId * 2 + 1);
        resolved = m.resolved; outcome = m.outcome; cancelled = m.cancelled;
        oracleEnabled = m.oracleEnabled; priceFeed = m.priceFeed;
        targetPrice = m.targetPrice; resolutionType = m.resolutionType; resolvedPrice = m.resolvedPrice;
    }

    function getMarketAmm(uint256 marketId) external view returns (
        uint256 yesReserve, uint256 noReserve, uint256 totalLpShares_, uint256 initialLiquidity, uint256 totalCollateral
    ) {
        Market storage m = _existingMarket(marketId);
        yesReserve = m.yesReserve; noReserve = m.noReserve;
        totalLpShares_ = m.totalLpShares; initialLiquidity = m.initialLiquidity; totalCollateral = m.totalCollateral;
    }

    function getPosition(uint256 marketId, address user) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        yesAmount = balanceOf(user, getYesTokenId(marketId));
        noAmount = balanceOf(user, getNoTokenId(marketId));
    }

    function isMarketCancelled(uint256 marketId) external view returns (bool) {
        Market storage m = _existingMarket(marketId);
        return m.cancelled;
    }

    function getAgentPosition(uint256 marketId, uint256 agentTokenId) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        yesAmount = agentYesBalance[marketId][agentTokenId];
        noAmount = agentNoBalance[marketId][agentTokenId];
    }

    /// @notice Check if a market is currently active (for LimitOrderBook)
    function isMarketActive(uint256 marketId) external view returns (bool) {
        Market storage m = markets[marketId];
        return m.exists && !m.resolved && !m.cancelled && block.timestamp < m.endTime;
    }

    // ============================================================
    //  ADMIN
    // ============================================================

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setNFAContract(address _nfa) external onlyOwner {
        if (_nfa == address(0)) revert InvalidAddress();
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
        if (amount == 0) revert ZeroAmount();
        if (amount > accumulatedFees) revert ExceedsFees();
        accumulatedFees -= amount;
        if (!usdtToken.transfer(msg.sender, amount)) revert TransferFailed();
        emit FeesWithdrawn(msg.sender, amount);
    }

    // ============================================================
    //  ERC1155 OVERRIDE
    // ============================================================

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155Upgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
