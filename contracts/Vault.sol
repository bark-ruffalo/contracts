// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StakingVault is Ownable {
	IERC20 public pawsyToken;
	IERC20 public lpToken;

	constructor(address _pawsyToken, address _lpToken) {
		pawsyToken = IERC20(_pawsyToken);
		lpToken = IERC20(_lpToken);
	}
}
