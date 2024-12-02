// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Treasury is Ownable {
	IERC20 public rewardToken;

	constructor(address _rewardToken) {
		rewardToken = IERC20(_rewardToken);
	}

	function fund(uint256 amount) external onlyOwner {
		rewardToken.transferFrom(msg.sender, address(this), amount);
	}

	function withdraw(uint256 amount) external onlyOwner {
		rewardToken.transfer(msg.sender, amount);
	}
}
