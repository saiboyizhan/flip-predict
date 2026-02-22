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
/// @title PredictionMarketV3 - UUPS Upgradeable CPMM + Limit Orderbook
/// @dev Agent + Oracle functions removed to fit 24KB limit. Can be added back via UUPS upgrade.
contract PredictionMarketV3 is
    Initializable,
    ERC1155SupplyUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ============================================================
    //  CUSTOM ERRORS (saves ~10KB vs string reverts)
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
    error PriceOutOfRange();
    error OrderNotFound();
    error OrderCancelled();
    error SelfTrade();
    error OrderFullyFilled();
    error InvalidFillAmount();
    error AlreadyCancelled();
    error MarketStillActive();
    error ExceedsFees();
    error InvalidAddress();

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
    //  STORAGE — slots 0-14 (must match V2 layout)
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
    uint256 public constant MIN_INITIAL_LIQUIDITY = 50e18;

    // ============================================================
    //  LIMIT ORDER BOOK — new storage (slot 15+)
    // ============================================================

    enum OrderSide { BUY_YES, BUY_NO, SELL_YES, SELL_NO }

    struct LimitOrder {
        uint256 id;
        uint256 marketId;
        address maker;
        OrderSide orderSide;
        uint256 price;
        uint256 amount;
        uint256 filled;
        uint256 createdAt;
        bool cancelled;
    }

    uint256 public nextOrderId;                                           // slot 15
    mapping(uint256 => LimitOrder) public limitOrders;                    // slot 16
    mapping(uint256 => uint256[]) public marketOrders;                    // slot 17
    mapping(address => uint256[]) public userOrders;                      // slot 18

    uint256 public constant TAKER_FEE_BPS = 50;
    uint256 public constant MIN_ORDER_PRICE = 1e16;
    uint256 public constant MAX_ORDER_PRICE = 99e16;

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
    event LimitOrderPlaced(uint256 indexed orderId, uint256 indexed marketId, address indexed maker, uint8 orderSide, uint256 price, uint256 amount);
    event LimitOrderFilled(uint256 indexed orderId, uint256 indexed marketId, address indexed taker, uint256 fillAmount, uint256 fillPrice, uint256 takerFee);
    event LimitOrderCancelled(uint256 indexed orderId, uint256 indexed marketId, address indexed maker);

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
    //  ERC1155 RECEIVER (for limit sell order escrow)
    // ============================================================

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) public pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) public pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    // ============================================================
    //  INTERNAL HELPERS (reduce repetitive checks)
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
        if (block.timestamp < m.endTime) revert MarketEnded();
        m.resolved = true;
        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
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
    //  LIMIT ORDER BOOK
    // ============================================================

    function placeLimitOrder(
        uint256 marketId, OrderSide orderSide, uint256 price, uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        if (amount == 0) revert ZeroAmount();
        _activeMarket(marketId);
        if (price < MIN_ORDER_PRICE || price > MAX_ORDER_PRICE) revert PriceOutOfRange();

        orderId = nextOrderId++;

        if (orderSide == OrderSide.BUY_YES || orderSide == OrderSide.BUY_NO) {
            if (!usdtToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        } else if (orderSide == OrderSide.SELL_YES) {
            uint256 tokenId = getYesTokenId(marketId);
            if (balanceOf(msg.sender, tokenId) < amount) revert InsufficientShares();
            _safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        } else {
            uint256 tokenId = getNoTokenId(marketId);
            if (balanceOf(msg.sender, tokenId) < amount) revert InsufficientShares();
            _safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        }

        limitOrders[orderId] = LimitOrder({
            id: orderId, marketId: marketId, maker: msg.sender, orderSide: orderSide,
            price: price, amount: amount, filled: 0, createdAt: block.timestamp, cancelled: false
        });
        marketOrders[marketId].push(orderId);
        userOrders[msg.sender].push(orderId);
        emit LimitOrderPlaced(orderId, marketId, msg.sender, uint8(orderSide), price, amount);
    }

    function fillLimitOrder(uint256 orderId, uint256 fillAmount) external nonReentrant whenNotPaused {
        LimitOrder storage order = limitOrders[orderId];
        if (order.amount == 0) revert OrderNotFound();
        if (order.cancelled) revert OrderCancelled();
        if (order.maker == msg.sender) revert SelfTrade();

        uint256 remaining = order.amount - order.filled;
        if (remaining == 0) revert OrderFullyFilled();
        if (fillAmount == 0 || fillAmount > remaining) revert InvalidFillAmount();

        Market storage m = _activeMarket(order.marketId);
        uint256 takerFee;

        if (order.orderSide == OrderSide.BUY_YES || order.orderSide == OrderSide.BUY_NO) {
            uint256 sharesAmount = (fillAmount * 1e18) / order.price;
            if (sharesAmount == 0) revert ZeroOutput();
            uint256 tokenId = order.orderSide == OrderSide.BUY_YES
                ? getYesTokenId(order.marketId) : getNoTokenId(order.marketId);
            if (balanceOf(msg.sender, tokenId) < sharesAmount) revert InsufficientShares();
            _safeTransferFrom(msg.sender, order.maker, tokenId, sharesAmount, "");

            takerFee = (fillAmount * TAKER_FEE_BPS) / BPS_DENOMINATOR;
            accumulatedFees += takerFee;
            if (!usdtToken.transfer(msg.sender, fillAmount - takerFee)) revert TransferFailed();
            emit Trade(order.marketId, msg.sender, false, order.orderSide == OrderSide.BUY_YES, fillAmount - takerFee, sharesAmount, takerFee);
        } else {
            uint256 usdtCost = (fillAmount * order.price) / 1e18;
            if (usdtCost == 0) revert ZeroOutput();
            takerFee = (usdtCost * TAKER_FEE_BPS) / BPS_DENOMINATOR;
            accumulatedFees += takerFee;
            if (!usdtToken.transferFrom(msg.sender, address(this), usdtCost + takerFee)) revert TransferFailed();
            if (!usdtToken.transfer(order.maker, usdtCost)) revert TransferFailed();

            uint256 tokenId = order.orderSide == OrderSide.SELL_YES
                ? getYesTokenId(order.marketId) : getNoTokenId(order.marketId);
            _safeTransferFrom(address(this), msg.sender, tokenId, fillAmount, "");
            emit Trade(order.marketId, msg.sender, true, order.orderSide == OrderSide.SELL_YES, usdtCost, fillAmount, takerFee);
        }
        order.filled += fillAmount;
        emit LimitOrderFilled(orderId, order.marketId, msg.sender, fillAmount, order.price, takerFee);
    }

    function cancelLimitOrder(uint256 orderId) external nonReentrant {
        LimitOrder storage order = limitOrders[orderId];
        if (order.amount == 0) revert OrderNotFound();
        if (order.cancelled) revert AlreadyCancelled();
        if (order.maker != msg.sender && msg.sender != owner()) revert NotAuthorized();
        order.cancelled = true;
        uint256 remaining = order.amount - order.filled;
        if (remaining > 0) {
            if (order.orderSide == OrderSide.BUY_YES || order.orderSide == OrderSide.BUY_NO) {
                if (!usdtToken.transfer(order.maker, remaining)) revert TransferFailed();
            } else if (order.orderSide == OrderSide.SELL_YES) {
                _safeTransferFrom(address(this), order.maker, getYesTokenId(order.marketId), remaining, "");
            } else {
                _safeTransferFrom(address(this), order.maker, getNoTokenId(order.marketId), remaining, "");
            }
        }
        emit LimitOrderCancelled(orderId, order.marketId, order.maker);
    }

    function cancelMarketOrders(uint256 marketId) external nonReentrant {
        Market storage m = _existingMarket(marketId);
        if (!m.resolved && !m.cancelled && block.timestamp < m.endTime) revert MarketStillActive();
        uint256[] storage orderIds = marketOrders[marketId];
        for (uint256 i = 0; i < orderIds.length; i++) {
            LimitOrder storage order = limitOrders[orderIds[i]];
            if (order.cancelled) continue;
            uint256 remaining = order.amount - order.filled;
            if (remaining == 0) continue;
            order.cancelled = true;
            if (order.orderSide == OrderSide.BUY_YES || order.orderSide == OrderSide.BUY_NO) {
                usdtToken.transfer(order.maker, remaining);
            } else if (order.orderSide == OrderSide.SELL_YES) {
                _safeTransferFrom(address(this), order.maker, getYesTokenId(marketId), remaining, "");
            } else {
                _safeTransferFrom(address(this), order.maker, getNoTokenId(marketId), remaining, "");
            }
            emit LimitOrderCancelled(orderIds[i], marketId, order.maker);
        }
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

    function getMarketOrderIds(uint256 marketId) external view returns (uint256[] memory) { return marketOrders[marketId]; }
    function getUserOrderIds(address user) external view returns (uint256[] memory) { return userOrders[user]; }

    function getLimitOrder(uint256 orderId) external view returns (
        uint256 id, uint256 marketId, address maker, uint8 orderSide,
        uint256 price, uint256 amount, uint256 filled, uint256 createdAt, bool cancelled
    ) {
        LimitOrder storage o = limitOrders[orderId];
        return (o.id, o.marketId, o.maker, uint8(o.orderSide), o.price, o.amount, o.filled, o.createdAt, o.cancelled);
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
