// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract FlipToken is ERC20, ERC20Burnable {
    constructor() ERC20("FlipToken", "FLIP") {
        _mint(msg.sender, 100_000_000 * 10 ** decimals());
    }
}
