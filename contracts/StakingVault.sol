// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ILock {
	function lock(
		address user,
		uint256 amount,
		uint256 lockPeriod,
		bool isLP
	) external;
	function unlock(
		address user,
		uint256 index
	) external returns (uint256, uint256, bool, bool);
	function getLocks(
		address user
	)
		external
		view
		returns (
			uint256[] memory,
			uint256[] memory,
			bool[] memory,
			bool[] memory
		);
}

contract StakingVault is Ownable {
	IERC20 public pawsyToken;
	IERC20 public lpToken;
	ILock public lockContract;

	struct RewardRate {
		uint256 lockPeriod; // Lock period in seconds
		uint256 rewardRate; // Reward rate percentage (e.g., 1% -> 100 = 1.00)
	}

	RewardRate[] public rewardRates; // Reward rates for locking periods

	event Staked(
		address indexed user,
		uint256 amount,
		uint256 lockPeriod,
		bool isLP
	);
	event Unstaked(
		address indexed user,
		uint256 amount,
		uint256 reward,
		bool isLP
	);

	constructor(
		address _pawsyToken,
		address _lpToken,
		address _lockContract
	) Ownable(msg.sender) {
		pawsyToken = IERC20(_pawsyToken);
		lpToken = IERC20(_lpToken);
		lockContract = ILock(_lockContract);

		// Initialize reward rates for 50/100/200/400 days
		rewardRates.push(RewardRate({ lockPeriod: 50 days, rewardRate: 100 })); // 1%
		rewardRates.push(RewardRate({ lockPeriod: 100 days, rewardRate: 200 })); // 2%
		rewardRates.push(RewardRate({ lockPeriod: 200 days, rewardRate: 300 })); // 3%
		rewardRates.push(RewardRate({ lockPeriod: 400 days, rewardRate: 400 })); // 4%
	}

	// Add or update reward rates
	function setRewardRates(RewardRate[] calldata _rates) external onlyOwner {
		delete rewardRates; // Clear existing rates
		for (uint256 i = 0; i < _rates.length; i++) {
			rewardRates.push(_rates[i]);
		}
	}

	// Stake tokens (ERC20 or LP)
	function stake(uint256 _amount, uint256 _lockPeriod, bool isLP) external {
		require(_amount > 0, "Amount must be greater than zero");

		// Determine reward rate
		uint256 rewardRate = 0;
		for (uint256 i = 0; i < rewardRates.length; i++) {
			if (rewardRates[i].lockPeriod == _lockPeriod) {
				rewardRate = rewardRates[i].rewardRate;
				break;
			}
		}
		require(rewardRate > 0, "Invalid lock period");

		// Transfer tokens to contract
		IERC20 token = isLP ? lpToken : pawsyToken;
		token.transferFrom(msg.sender, address(this), _amount);

		// Lock tokens
		lockContract.lock(msg.sender, _amount, _lockPeriod, isLP);

		emit Staked(msg.sender, _amount, _lockPeriod, isLP);
	}

	// Unstake tokens
	function unstake(uint256 index) external {
		// Call unlock function and destructure the tuple
		(
			uint256 amount,
			uint256 lockPeriod,
			bool isLP,
			bool locked
		) = lockContract.unlock(msg.sender, index);
		require(!locked, "Lock period not yet over");

		// Calculate reward
		uint256 rewardRate = 0;
		for (uint256 i = 0; i < rewardRates.length; i++) {
			if (rewardRates[i].lockPeriod == lockPeriod) {
				rewardRate = rewardRates[i].rewardRate;
				break;
			}
		}
		uint256 reward = (amount * rewardRate) / 10000;

		// Transfer tokens back to user
		IERC20 token = isLP ? lpToken : pawsyToken;
		token.transfer(msg.sender, amount + reward);

		emit Unstaked(msg.sender, amount, reward, isLP);
	}

	// Get user locks
	function getUserLocks(
		address user
	)
		external
		view
		returns (
			uint256[] memory,
			uint256[] memory,
			bool[] memory,
			bool[] memory
		)
	{
		return lockContract.getLocks(user);
	}
}
