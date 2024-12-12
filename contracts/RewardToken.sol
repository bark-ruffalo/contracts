// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RewardToken is ERC20, Ownable {
	event TokensMinted(address indexed to, uint256 amount);
	event TokensBurned(address indexed from, uint256 amount);

	/**
	 * @dev Constructor to initialize the token with a name and symbol.
	 */
	constructor() ERC20("DRUGS", "DRUGS") Ownable(msg.sender) {}

	/**
	 * @dev Mints new tokens to a specified address.
	 * @param to The address to mint tokens to.
	 * @param amount The amount of tokens to mint.
	 * @notice Only callable by the contract owner.
	 * @custom:events Emits TokensMinted event.
	 */
	function mint(address to, uint256 amount) external onlyOwner {
		require(to != address(0), "Cannot mint to zero address");
		_mint(to, amount);
		emit TokensMinted(to, amount);
	}

	/**
	 * @dev Burns a specified amount of tokens from the caller's account.
	 * @param amount The amount of tokens to burn.
	 * @custom:events Emits TokensBurned event.
	 */
	function burn(uint256 amount) external {
		_burn(msg.sender, amount);
		emit TokensBurned(msg.sender, amount);
	}

	/**
	 * @dev Burns a specified amount of tokens from a specified account.
	 * @param account The account to burn tokens from.
	 * @param amount The amount of tokens to burn.
	 * @notice The caller must have allowance for the account's tokens.
	 * @custom:events Emits TokensBurned event.
	 */
	function burnFrom(address account, uint256 amount) external {
		require(account != address(0), "Cannot burn from zero address");
		uint256 currentAllowance = allowance(account, msg.sender);
		require(
			currentAllowance >= amount,
			"ERC20: burn amount exceeds allowance"
		);
		_approve(account, msg.sender, currentAllowance - amount);
		_burn(account, amount);
		emit TokensBurned(account, amount);
	}
}
