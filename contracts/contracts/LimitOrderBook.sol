// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "./interfaces/IPredictionMarket.sol";

/// @title LimitOrderBook - Independent UUPS limit order book for PredictionMarketV3
/// @dev Interacts with PredictionMarketV3 for market validation and ERC1155 token operations.
contract LimitOrderBook is
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IERC1155Receiver
{
    // ============================================================
    //  CUSTOM ERRORS
    // ============================================================

    error ZeroAmount();
    error MarketNotActive();
    error PriceOutOfRange();
    error OrderNotFound();
    error OrderCancelled();
    error SelfTrade();
    error OrderFullyFilled();
    error InvalidFillAmount();
    error AlreadyCancelled();
    error MarketStillActive();
    error TransferFailed();
    error ZeroOutput();
    error InsufficientShares();
    error NotAuthorized();
    error ExceedsFees();
    error InvalidAddress();

    // ============================================================
    //  TYPES
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

    // ============================================================
    //  STORAGE
    // ============================================================

    IPredictionMarket public predictionMarket;
    IERC20 public usdtToken;
    uint256 public nextOrderId;
    mapping(uint256 => LimitOrder) public limitOrders;
    mapping(uint256 => uint256[]) public marketOrders;
    mapping(address => uint256[]) public userOrders;
    uint256 public accumulatedFees;

    // ============================================================
    //  CONSTANTS
    // ============================================================

    uint256 public constant TAKER_FEE_BPS = 50;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MIN_ORDER_PRICE = 1e16;
    uint256 public constant MAX_ORDER_PRICE = 99e16;

    // ============================================================
    //  EVENTS
    // ============================================================

    event LimitOrderPlaced(uint256 indexed orderId, uint256 indexed marketId, address indexed maker, uint8 orderSide, uint256 price, uint256 amount);
    event LimitOrderFilled(uint256 indexed orderId, uint256 indexed marketId, address indexed taker, uint256 fillAmount, uint256 fillPrice, uint256 takerFee);
    event LimitOrderCancelled(uint256 indexed orderId, uint256 indexed marketId, address indexed maker);
    event Trade(uint256 indexed marketId, address indexed user, bool isBuy, bool side, uint256 amount, uint256 shares, uint256 fee);
    event FeesWithdrawn(address indexed owner, uint256 amount);

    // ============================================================
    //  INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _predictionMarket) public initializer {
        if (_predictionMarket == address(0)) revert InvalidAddress();
        __ReentrancyGuard_init();
        __Ownable_init(msg.sender);
        __Pausable_init();
        __UUPSUpgradeable_init();
        predictionMarket = IPredictionMarket(_predictionMarket);
        usdtToken = IERC20(predictionMarket.usdtToken());
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============================================================
    //  ERC1155 RECEIVER (for sell order escrow)
    // ============================================================

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
    }

    // ============================================================
    //  LIMIT ORDER FUNCTIONS
    // ============================================================

    function placeLimitOrder(
        uint256 marketId, OrderSide orderSide, uint256 price, uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        if (amount == 0) revert ZeroAmount();
        if (!predictionMarket.isMarketActive(marketId)) revert MarketNotActive();
        require(price > 0 && price < 1e18, "Price must be between 0 and 1");
        if (price < MIN_ORDER_PRICE || price > MAX_ORDER_PRICE) revert PriceOutOfRange();

        orderId = nextOrderId++;

        if (orderSide == OrderSide.BUY_YES || orderSide == OrderSide.BUY_NO) {
            // Lock USDT in this contract
            if (!usdtToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        } else if (orderSide == OrderSide.SELL_YES) {
            uint256 tokenId = predictionMarket.getYesTokenId(marketId);
            if (predictionMarket.balanceOf(msg.sender, tokenId) < amount) revert InsufficientShares();
            // Transfer ERC1155 from maker to this contract (maker must have approved LOB)
            predictionMarket.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        } else {
            uint256 tokenId = predictionMarket.getNoTokenId(marketId);
            if (predictionMarket.balanceOf(msg.sender, tokenId) < amount) revert InsufficientShares();
            predictionMarket.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
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

        // Market must still be active
        if (!predictionMarket.isMarketActive(order.marketId)) revert MarketNotActive();

        uint256 takerFee;

        if (order.orderSide == OrderSide.BUY_YES || order.orderSide == OrderSide.BUY_NO) {
            // Maker wants to BUY shares. Taker provides shares, gets USDT.
            uint256 sharesAmount = (fillAmount * 1e18) / order.price;
            if (sharesAmount == 0) revert ZeroOutput();
            uint256 tokenId = order.orderSide == OrderSide.BUY_YES
                ? predictionMarket.getYesTokenId(order.marketId) : predictionMarket.getNoTokenId(order.marketId);
            if (predictionMarket.balanceOf(msg.sender, tokenId) < sharesAmount) revert InsufficientShares();
            // Taker's shares go directly to maker (taker must have approved LOB on PM)
            predictionMarket.safeTransferFrom(msg.sender, order.maker, tokenId, sharesAmount, "");

            takerFee = (fillAmount * TAKER_FEE_BPS) / BPS_DENOMINATOR;
            accumulatedFees += takerFee;
            // Release USDT from escrow to taker
            if (!usdtToken.transfer(msg.sender, fillAmount - takerFee)) revert TransferFailed();
            emit Trade(order.marketId, msg.sender, false, order.orderSide == OrderSide.BUY_YES, fillAmount - takerFee, sharesAmount, takerFee);
        } else {
            // Maker wants to SELL shares. Taker provides USDT, gets shares.
            uint256 usdtCost = (fillAmount * order.price) / 1e18;
            if (usdtCost == 0) revert ZeroOutput();
            takerFee = (usdtCost * TAKER_FEE_BPS) / BPS_DENOMINATOR;
            accumulatedFees += takerFee;
            // Taker pays USDT (to LOB, then LOB sends to maker)
            if (!usdtToken.transferFrom(msg.sender, address(this), usdtCost + takerFee)) revert TransferFailed();
            if (!usdtToken.transfer(order.maker, usdtCost)) revert TransferFailed();

            uint256 tokenId = order.orderSide == OrderSide.SELL_YES
                ? predictionMarket.getYesTokenId(order.marketId) : predictionMarket.getNoTokenId(order.marketId);
            // Release escrowed shares to taker
            predictionMarket.safeTransferFrom(address(this), msg.sender, tokenId, fillAmount, "");
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
        uint256 remainingAmount = order.amount - order.filled;
        if (remainingAmount > 0) {
            if (order.orderSide == OrderSide.BUY_YES || order.orderSide == OrderSide.BUY_NO) {
                if (!usdtToken.transfer(order.maker, remainingAmount)) revert TransferFailed();
            } else if (order.orderSide == OrderSide.SELL_YES) {
                predictionMarket.safeTransferFrom(address(this), order.maker, predictionMarket.getYesTokenId(order.marketId), remainingAmount, "");
            } else {
                predictionMarket.safeTransferFrom(address(this), order.maker, predictionMarket.getNoTokenId(order.marketId), remainingAmount, "");
            }
        }
        emit LimitOrderCancelled(orderId, order.marketId, order.maker);
    }

    function cancelMarketOrders(uint256 marketId) external nonReentrant {
        if (predictionMarket.isMarketActive(marketId)) revert MarketStillActive();
        uint256[] storage orderIds = marketOrders[marketId];
        for (uint256 i = 0; i < orderIds.length; i++) {
            LimitOrder storage order = limitOrders[orderIds[i]];
            if (order.cancelled) continue;
            uint256 remainingAmount = order.amount - order.filled;
            if (remainingAmount == 0) continue;
            order.cancelled = true;
            if (order.orderSide == OrderSide.BUY_YES || order.orderSide == OrderSide.BUY_NO) {
                require(usdtToken.transfer(order.maker, remainingAmount), "Transfer failed");
            } else if (order.orderSide == OrderSide.SELL_YES) {
                predictionMarket.safeTransferFrom(address(this), order.maker, predictionMarket.getYesTokenId(marketId), remainingAmount, "");
            } else {
                predictionMarket.safeTransferFrom(address(this), order.maker, predictionMarket.getNoTokenId(marketId), remainingAmount, "");
            }
            emit LimitOrderCancelled(orderIds[i], marketId, order.maker);
        }
    }

    // ============================================================
    //  VIEW FUNCTIONS
    // ============================================================

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

    function withdrawFees(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > accumulatedFees) revert ExceedsFees();
        accumulatedFees -= amount;
        if (!usdtToken.transfer(msg.sender, amount)) revert TransferFailed();
        emit FeesWithdrawn(msg.sender, amount);
    }
}
