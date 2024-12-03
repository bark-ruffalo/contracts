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
	function calculateRewards(
		address user,
		uint256 poolId,
		uint256 rewardRate,
		uint256 lastClaimTime
	) external returns (uint256);
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
	mapping(address => mapping(uint256 => uint256)) public lastClaimTime; // Last reward claim timestamp per user per pool

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
	event RewardsClaimed(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount
	);

	constructor(address _lockContract, address _rewardToken) Ownable() {
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
		uint256 rewardRate = getRewardRate(poolId, _lockPeriod);
		require(rewardRate > 0, "Invalid lock period");

		// Transfer staking tokens to contract
		pool.stakingToken.transferFrom(msg.sender, address(this), _amount);

		// Lock tokens
		lockContract.lock(msg.sender, _amount, _lockPeriod, poolId);

		// Set initial claim time
		if (lastClaimTime[msg.sender][poolId] == 0) {
			lastClaimTime[msg.sender][poolId] = block.timestamp;
		}

		emit Staked(msg.sender, poolId, _amount, _lockPeriod);
	}

	// Unstake tokens and claim rewards
	function unstake(uint256 poolId, uint256 index) external {
		require(poolId < pools.length, "Invalid pool ID");
		Pool storage pool = pools[poolId];

		// Unlock tokens
		(uint256 amount, uint256 lockPeriod, , bool locked) = lockContract
			.unlock(msg.sender, index);
		require(!locked, "Lock period not yet over");

		// Calculate pending rewards
		uint256 pendingRewards = calculateRewards(msg.sender, poolId);

		// Mint rewards and transfer staked tokens back to user
		rewardToken.mint(msg.sender, pendingRewards);
		pool.stakingToken.transfer(msg.sender, amount);

		// Update lifetime rewards and reset claim time
		lifetimeRewards[msg.sender] += pendingRewards;
		lastClaimTime[msg.sender][poolId] = block.timestamp;

		emit Unstaked(msg.sender, poolId, amount, pendingRewards);
	}

	// Claim rewards without unlocking tokens
	function claimRewards(uint256 poolId) external {
		require(poolId < pools.length, "Invalid pool ID");
		Pool storage pool = pools[poolId];

		// Fetch reward rate
		uint256 rewardRate = getRewardRate(poolId, pool.lockPeriods[0]);
		require(rewardRate > 0, "Invalid reward rate");

		// Calculate pending rewards
		uint256 pendingRewards = lockContract.calculateRewards(
			msg.sender,
			poolId,
			rewardRate,
			lastClaimTime[msg.sender][poolId]
		);
		require(pendingRewards > 0, "No rewards available");

		// Mint rewards
		rewardToken.mint(msg.sender, pendingRewards);

		// Update lifetime rewards and claim time
		lifetimeRewards[msg.sender] += pendingRewards;
		lastClaimTime[msg.sender][poolId] = block.timestamp;

		emit RewardsClaimed(msg.sender, poolId, pendingRewards);
	}

	// Helper function to fetch the reward rate for a specific pool and lock period
	function getRewardRate(
		uint256 poolId,
		uint256 lockPeriod
	) internal view returns (uint256) {
		Pool storage pool = pools[poolId];
		for (uint256 i = 0; i < pool.lockPeriods.length; i++) {
			if (pool.lockPeriods[i] == lockPeriod) {
				return pool.rewardRates[i];
			}
		}
		return 0;
	}

	// Get total rewards earned by a user
	function getLifetimeRewards(address user) external view returns (uint256) {
		return lifetimeRewards[user];
	}
}
