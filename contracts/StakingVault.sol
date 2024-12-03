// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ILock {
	function lock(
		address user,
		uint256 amount,
		uint256 lockPeriod,
		uint256 poolId
	) external;
	function unlock(
		address user,
		uint256 index
	) external returns (uint256, uint256, uint256, bool);
}

interface IRewardToken {
	function mint(address to, uint256 amount) external;
}

contract StakingVault is Ownable {
	struct Pool {
		IERC20 stakingToken; // Token being staked
		uint256[] lockPeriods; // Supported lock periods
		uint256[] rewardRates; // Reward rates corresponding to lock periods
		bool isActive; // Whether the pool is active
	}

	Pool[] public pools; // Array of pools
	ILock public lockContract; // Reference to the lock contract
	IRewardToken public rewardToken; // Reference to the rewards token

	mapping(address => uint256) public lifetimeRewards; // Tracks total rewards earned by each address

	event Staked(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 lockPeriod
	);
	event Unstaked(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 reward
	);

	constructor(
		address _lockContract,
		address _rewardToken
	) Ownable(msg.sender) {
		lockContract = ILock(_lockContract);
		rewardToken = IRewardToken(_rewardToken);
	}

	// Add a new pool
	function addPool(
		IERC20 _stakingToken,
		uint256[] calldata _lockPeriods,
		uint256[] calldata _rewardRates
	) external onlyOwner {
		require(
			_lockPeriods.length == _rewardRates.length,
			"Mismatched lock periods and rates"
		);

		pools.push(
			Pool({
				stakingToken: _stakingToken,
				lockPeriods: _lockPeriods,
				rewardRates: _rewardRates,
				isActive: true
			})
		);
	}

	// Stake tokens
	function stake(
		uint256 poolId,
		uint256 _amount,
		uint256 _lockPeriod
	) external {
		require(poolId < pools.length, "Invalid pool ID");
		Pool storage pool = pools[poolId];
		require(pool.isActive, "Pool is not active");

		// Determine reward rate
		uint256 rewardRate = 0;
		for (uint256 i = 0; i < pool.lockPeriods.length; i++) {
			if (pool.lockPeriods[i] == _lockPeriod) {
				rewardRate = pool.rewardRates[i];
				break;
			}
		}
		require(rewardRate > 0, "Invalid lock period");

		// Transfer staking tokens to contract
		pool.stakingToken.transferFrom(msg.sender, address(this), _amount);

		// Lock tokens
		lockContract.lock(msg.sender, _amount, _lockPeriod, poolId);

		emit Staked(msg.sender, poolId, _amount, _lockPeriod);
	}

	// Unstake tokens
	function unstake(uint256 poolId, uint256 index) external {
		require(poolId < pools.length, "Invalid pool ID");
		Pool storage pool = pools[poolId];

		// Unlock tokens
		(uint256 amount, uint256 lockPeriod, , bool locked) = lockContract
			.unlock(msg.sender, index);
		require(!locked, "Lock period not yet over");

		// Determine reward rate
		uint256 rewardRate = 0;
		for (uint256 i = 0; i < pool.lockPeriods.length; i++) {
			if (pool.lockPeriods[i] == lockPeriod) {
				rewardRate = pool.rewardRates[i];
				break;
			}
		}
		uint256 reward = (amount * rewardRate) / 10000;

		// Mint reward tokens and transfer staking tokens back to user
		pool.stakingToken.transfer(msg.sender, amount);
		rewardToken.mint(msg.sender, reward);

		// Update lifetime rewards
		lifetimeRewards[msg.sender] += reward;

		emit Unstaked(msg.sender, poolId, amount, reward);
	}

	// Get total rewards earned by a user
	function getLifetimeRewards(address user) external view returns (uint256) {
		return lifetimeRewards[user];
	}

	// Get pool details
	function getPool(
		uint256 poolId
	) external view returns (IERC20, uint256[] memory, uint256[] memory, bool) {
		Pool storage pool = pools[poolId];
		return (
			pool.stakingToken,
			pool.lockPeriods,
			pool.rewardRates,
			pool.isActive
		);
	}
}
