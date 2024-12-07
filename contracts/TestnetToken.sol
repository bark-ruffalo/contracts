// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestnetToken
 * @dev A simple ERC20 token where anyone can mint tokens for testing purposes
 */
contract TestnetToken is ERC20 {
	constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

	/**
	 * @dev Mints tokens to a specified address. Can be called by anyone.
	 * @param to The address that will receive the minted tokens
	 * @param amount The amount of tokens to mint
	 */
	function mint(address to, uint256 amount) external {
		_mint(to, amount);
	}
}
