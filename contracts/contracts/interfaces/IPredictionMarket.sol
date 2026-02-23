// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/// @title IPredictionMarket - Interface for LimitOrderBook to call PredictionMarketV3
interface IPredictionMarket {
    function isMarketActive(uint256 marketId) external view returns (bool);
    function getYesTokenId(uint256 marketId) external pure returns (uint256);
    function getNoTokenId(uint256 marketId) external pure returns (uint256);
    function getPrice(uint256 marketId) external view returns (uint256 yesPrice, uint256 noPrice);
    function usdtToken() external view returns (address);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}
