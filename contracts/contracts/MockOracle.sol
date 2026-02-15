// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockOracle {
    int256 private _price;
    uint8 private _decimals;
    uint256 private _updatedAt;
    bool private _useCustomUpdatedAt;

    constructor(int256 initialPrice, uint8 decimalsVal) {
        _price = initialPrice;
        _decimals = decimalsVal;
    }

    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }

    function setUpdatedAt(uint256 updatedAt) external {
        _updatedAt = updatedAt;
        _useCustomUpdatedAt = true;
    }

    function latestAnswer() external view returns (int256) {
        return _price;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestTimestamp() external view returns (uint256) {
        return block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        uint256 updatedAt = _useCustomUpdatedAt ? _updatedAt : block.timestamp;
        return (1, _price, block.timestamp, updatedAt, 1);
    }
}
