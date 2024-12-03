// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RewardToken is ERC20, Ownable {
	constructor() ERC20("DRUGS", "DRUGS") Ownable(msg.sender) {}

	function mint(address to, uint256 amount) external onlyOwner {
		_mint(to, amount);
	}

	function burn(uint256 amount) external {
		_burn(msg.sender, amount);
	}

	function burnFrom(address account, uint256 amount) external {
		uint256 currentAllowance = allowance(account, msg.sender);
		require(
			currentAllowance >= amount,
			"ERC20: burn amount exceeds allowance"
		);
		_approve(account, msg.sender, currentAllowance - amount);
		_burn(account, amount);
	}
}
