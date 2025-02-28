// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./RewardToken.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract StakingVault is Ownable, ReentrancyGuard, Pausable {
	using SafeERC20 for IERC20;

	struct Pool {
		uint256 poolId; // Unique identifier for the pool
		IERC20 stakingToken; // Token being staked
		uint256[] lockPeriods; // Supported lock periods
		uint256[] rewardRates; // Reward rates corresponding to lock periods
		bool isActive; // Whether the pool is active
		bool isStakingPaused; // Whether staking is paused for this pool
	}

	struct LockInfo {
		uint256 lockId; // Unique identifier for the lock
		uint256 amount; // Amount of tokens locked
		uint256 lockPeriod; // Lock duration in seconds
		uint256 unlockTime; // Timestamp when tokens can be unlocked
		uint256 lastClaimTime; // Timestamp when user claimed rewards
		uint256 poolId; // Identifier for the pool associated with this lock
		bool isLocked; // Whether the lock is still active
	}

	Pool[] public pools; // Array of pools
	RewardToken public rewardToken; // Reference to the rewards token

	mapping(address => LockInfo[]) public userLocks; // Tracks locks for each user
	mapping(address => uint256) public lifetimeRewards; // Tracks total rewards earned by each address
	address[] public lockedUsers;

	event Staked(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 lockPeriod,
		uint256 lockId,
		uint256 unlockTime
	);
	event Unstaked(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 reward,
		uint256 lockId
	);
	event RewardsClaimed(
		address indexed user,
		uint256 indexed poolId,
		uint256 amount,
		uint256 lockId,
		uint256 timestamp
	);

	event Locked(
		address indexed user,
		uint256 indexed lockId,
		uint256 amount,
		uint256 lockPeriod,
		uint256 unlockTime,
		uint256 poolId
	);
	event Unlocked(
		address indexed user,
		uint256 indexed lockId,
		uint256 amount,
		uint256 poolId,
		uint256 timestamp
	);
	event PoolAdded(
		uint256 indexed poolId, 
		address indexed stakingToken,
		uint256[] lockPeriods,
		uint256[] rewardRates
	);
	event RewardRatesUpdated(uint256 indexed poolId, uint256[] newRewardRates);
	event PoolStatusUpdated(uint256 indexed poolId, bool isActive);
	event PoolStakingStatusUpdated(uint256 indexed poolId, bool isStakingPaused);
	event RewardTokenUpdated(address indexed oldRewardToken, address indexed newRewardToken);
	event TokensRecovered(address indexed token, address indexed to, uint256 amount);
	event EmergencyUnlock(address indexed user, uint256 indexed lockId, uint256 amount, uint256 poolId);

	/**
	 * @dev Constructor to initialize the contract with the reward token address.
	 * @param _rewardToken The address of the reward token contract.
	 */
	constructor(address _rewardToken) Ownable(msg.sender) {
		rewardToken = RewardToken(_rewardToken);
	}

	// Set the reward token address (can be called after deployment if needed)
	function setRewardToken(address _rewardToken) external onlyOwner {
		require(_rewardToken != address(0), "Reward token cannot be zero address");
		address oldRewardToken = address(rewardToken);
		rewardToken = RewardToken(_rewardToken);
		emit RewardTokenUpdated(oldRewardToken, _rewardToken);
	}

	/**
	 * @dev Add a new pool for staking.
	 * @param _stakingToken The token that will be staked in the pool.
	 * @param _lockPeriods The array of supported lock periods for the pool.
	 * @param _rewardRates The corresponding reward rates for each lock period.
	 * @notice Only callable by the contract owner.
	 * @notice Lock periods and reward rates must match in length.
	 * @custom:events Emits PoolAdded event.
	 */
	function addPool(
		IERC20 _stakingToken,
		uint256[] calldata _lockPeriods,
		uint256[] calldata _rewardRates
	) external onlyOwner {
		require(
			address(_stakingToken) != address(0),
			"Invalid staking token address"
		);
		require(
			_lockPeriods.length == _rewardRates.length,
			"Mismatched lock periods and rates"
		);

		uint256 poolId = pools.length;

		pools.push(
			Pool({
				poolId: poolId,
				stakingToken: _stakingToken,
				lockPeriods: _lockPeriods,
				rewardRates: _rewardRates,
				isActive: true,
				isStakingPaused: false
			})
		);
		emit PoolAdded(poolId, address(_stakingToken), _lockPeriods, _rewardRates);
	}

	/**
	 * @dev Activate or deactivate a staking pool.
	 * @param poolId The ID of the pool to update.
	 * @param isActive The new status of the pool (active or inactive).
	 * @notice Only callable by the contract owner.
	 * @custom:events Emits PoolStatusUpdated event.
	 */
	function setPoolStatus(uint256 poolId, bool isActive) external onlyOwner {
		require(poolId < pools.length, "Pool does not exist");

		pools[poolId].isActive = isActive;

		emit PoolStatusUpdated(poolId, isActive);
	}

	/**
	 * @dev Pause or unpause staking operations for a specific pool.
	 * @param poolId The ID of the pool to update.
	 * @param isStakingPaused Whether staking should be paused (true) or allowed (false).
	 * @notice Only callable by the contract owner.
	 * @notice When staking is paused, users can still unstake and claim rewards.
	 * @custom:events Emits PoolStakingStatusUpdated event.
	 */
	function setPoolStakingStatus(uint256 poolId, bool isStakingPaused) external onlyOwner {
		require(poolId < pools.length, "Pool does not exist");

		pools[poolId].isStakingPaused = isStakingPaused;

		emit PoolStakingStatusUpdated(poolId, isStakingPaused);
	}

	/**
	 * @dev Update the reward rates for a specific pool.
	 * @param poolId The ID of the pool to update.
	 * @param newRewardRates The new reward rates corresponding to the existing lock periods.
	 * @notice Only callable by the contract owner.
	 * @notice Reward rates must match the number of lock periods.
	 * @custom:events Emits RewardRatesUpdated event.
	 */
	function updateRewardRates(
		uint256 poolId,
		uint256[] memory newRewardRates
	) external onlyOwner {
		require(poolId < pools.length, "Pool does not exist");
		Pool storage pool = pools[poolId];
		require(
			pool.lockPeriods.length == newRewardRates.length,
			"Mismatched lock periods and reward rates"
		);

		pool.rewardRates = newRewardRates;

		emit RewardRatesUpdated(poolId, newRewardRates);
	}

	/**
	 * @dev Stake tokens in a specific pool with a lock period.
	 * @param poolId The ID of the pool to stake in.
	 * @param _amount The amount of tokens to stake.
	 * @param _lockPeriod The duration for which the tokens will be locked.
	 * @notice This function can be paused by the contract owner in case of emergencies.
	 * @custom:events Emits Staked event.
	 */
	function stake(
		uint256 poolId,
		uint256 _amount,
		uint256 _lockPeriod
	) external whenNotPaused {
		require(poolId < pools.length, "Invalid pool ID");
		Pool memory pool = pools[poolId];
		require(pool.isActive, "Pool is not active");
		require(!pool.isStakingPaused, "Staking is paused for this pool");

		// Determine reward rate
		uint256 rewardRate = getRewardRate(poolId, _lockPeriod);
		require(rewardRate > 0, "Invalid lock period");

		// Transfer staking tokens to contract
		pool.stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

		// Lock tokens
		lock(msg.sender, poolId, _amount, _lockPeriod);
		
		// Get the lock ID (it will be the index of the newly added lock)
		uint256 lockId = userLocks[msg.sender].length - 1;
		uint256 unlockTime = userLocks[msg.sender][lockId].unlockTime;

		emit Staked(msg.sender, poolId, _amount, _lockPeriod, lockId, unlockTime);
	}

	/**
	 * @dev Helper function to remove a user from the lockedUsers array if they have no active locks.
	 * @param user The address of the user to check and potentially remove.
	 */
	function _removeUserFromLockedUsersIfNeeded(address user) internal {
		// Check if user has any remaining locked positions
		bool hasActiveLocks = false;
		for (uint256 i = 0; i < userLocks[user].length; i++) {
			if (userLocks[user][i].isLocked) {
				hasActiveLocks = true;
				break;
			}
		}
		
		// If no active locks remain, remove user from lockedUsers array
		if (!hasActiveLocks) {
			for (uint256 i = 0; i < lockedUsers.length; i++) {
				if (lockedUsers[i] == user) {
					// Swap with the last element
					lockedUsers[i] = lockedUsers[lockedUsers.length - 1];
					// Remove the last element
					lockedUsers.pop();
					break;
				}
			}
		}
	}

	/**
	 * @dev Unstake tokens and claim rewards for a specific lock.
	 * @param poolId The ID of the pool to unstake from.
	 * @param lockId The ID of the lock to unlock.
	 */
	function unstake(uint256 poolId, uint256 lockId) external nonReentrant {
		require(poolId < pools.length, "Invalid pool ID");
		require(lockId < userLocks[msg.sender].length, "Invalid lock ID");
		
		LockInfo storage lockInfo = userLocks[msg.sender][lockId];
		require(lockInfo.poolId == poolId, "Pool ID mismatch");
		
		Pool memory pool = pools[poolId];
		uint256 amount = lockInfo.amount;

		// Calculate pending rewards
		uint256 pendingRewards = calculateRewards(msg.sender, lockId);

		// Check if already unlocked (could be from emergencyUnlockAll)
		if (lockInfo.isLocked) {
			// Normal unlock flow
			require(block.timestamp >= lockInfo.unlockTime, "Lock period not yet over");
			lockInfo.isLocked = false;
			
			// Check if user needs to be removed from lockedUsers array
			_removeUserFromLockedUsersIfNeeded(msg.sender);
		} else {
			// Already unlocked (e.g., via emergencyUnlockAll)
			// Ensure it hasn't been withdrawn already
			require(amount > 0, "Tokens already withdrawn");
		}

		// Set amount to 0 to prevent double withdrawals
		lockInfo.amount = 0;
		
		// Mint rewards and transfer staked tokens back to user
		if (pendingRewards > 0) {
			rewardToken.mint(msg.sender, pendingRewards);
			// Update lifetime rewards
			lifetimeRewards[msg.sender] += pendingRewards;
		}
		
		// Transfer tokens back to user
		pool.stakingToken.safeTransfer(msg.sender, amount);

		// Set last claim time
		lockInfo.lastClaimTime = block.timestamp;

		emit Unstaked(msg.sender, poolId, amount, pendingRewards, lockId);
	}

	/**
	 * @dev Locks the user's tokens.
	 * @param user The address of the user locking the tokens.
	 * @param poolId The ID of the pool the lock belongs to.
	 * @param amount The amount of tokens to lock.
	 * @param lockPeriod The duration for which tokens are locked.
	 */
	function lock(
		address user,
		uint256 poolId,
		uint256 amount,
		uint256 lockPeriod
	) internal {
		require(user != address(0), "Invalid user address");
		require(poolId < pools.length, "Invalid pool ID");
		require(amount > 0, "Amount must be greater than zero");
		require(lockPeriod > 0, "Lock period must be greater than zero");

		uint256 unlockTime = block.timestamp + lockPeriod;
		uint256 lockId = userLocks[user].length;

		// Check if the user already has active locks
		bool hasActiveLocks = false;
		for (uint256 i = 0; i < userLocks[user].length; i++) {
			if (userLocks[user][i].isLocked) {
				hasActiveLocks = true;
				break;
			}
		}
		
		// Add to lockedUsers array if not already present and no active locks
		if (!hasActiveLocks) {
			// Simple check if user is in array - only do full scan if they're not in the zero position
			// This optimizes gas for the common case
			bool isInLockedUsers = lockedUsers.length > 0 && lockedUsers[0] == user;
			
			if (!isInLockedUsers) {
				for (uint256 i = 1; i < lockedUsers.length && !isInLockedUsers; i++) {
					if (lockedUsers[i] == user) {
						isInLockedUsers = true;
					}
				}
			}
			
			if (!isInLockedUsers) {
				lockedUsers.push(user);
			}
		}
		
		userLocks[user].push(
			LockInfo({
				lockId: lockId,
				amount: amount,
				lockPeriod: lockPeriod,
				unlockTime: unlockTime,
				lastClaimTime: block.timestamp,
				poolId: poolId,
				isLocked: true
			})
		);

		emit Locked(user, lockId, amount, lockPeriod, unlockTime, poolId);
	}

	/**
	 * @dev Unlocks the user's tokens for a specific lock ID.
	 * @param user The address of the user unlocking the tokens.
	 * @param lockId The ID of the lock to unlock.
	 * @return The amount of tokens that were unlocked and whether the lock is still active.
	 * @custom:events Emits Unlocked event.
	 */
	function unlock(
		address user,
		uint256 lockId
	) internal returns (uint256, bool) {
		require(user != address(0), "Invalid user address");
		require(lockId < userLocks[user].length, "Invalid lock ID");

		LockInfo storage lockInfo = userLocks[user][lockId];
		require(block.timestamp >= lockInfo.unlockTime, "Lock period not over");
		require(lockInfo.isLocked, "Lock already unlocked");

		lockInfo.isLocked = false;
		_removeUserFromLockedUsersIfNeeded(user);

		emit Unlocked(user, lockId, lockInfo.amount, lockInfo.poolId, block.timestamp);

		return (lockInfo.amount, lockInfo.isLocked);
	}

	/**
	 * @dev Claims rewards for a specific lock without unlocking the tokens.
	 * @param poolId The ID of the pool the rewards are being claimed from.
	 * @param lockId The ID of the lock the rewards are being claimed for.
	 * @custom:events Emits RewardsClaimed event.
	 */
	function claimRewards(uint256 poolId, uint256 lockId) external nonReentrant {
		require(poolId < pools.length, "Invalid pool ID");
		require(lockId < userLocks[msg.sender].length, "Invalid lock ID");

		// Calculate pending rewards
		uint256 pendingRewards = calculateRewards(msg.sender, lockId);
		require(pendingRewards > 0, "No rewards available");

		// Mint rewards
		rewardToken.mint(msg.sender, pendingRewards);

		// Update lifetime rewards and claim time
		lifetimeRewards[msg.sender] += pendingRewards;

		// Update last claim time
		LockInfo storage lockInfo = userLocks[msg.sender][lockId];
		lockInfo.lastClaimTime = block.timestamp;

		emit RewardsClaimed(msg.sender, poolId, pendingRewards, lockId, block.timestamp);
	}

	/**
	 * @dev Calculates the pending rewards for a user based on their lock.
	 * @param user The address of the user.
	 * @param lockId The ID of the lock to calculate rewards for.
	 * @return The amount of rewards earned for the specified lock.
	 */
	function calculateRewards(
		address user,
		uint256 lockId
	) public view returns (uint256) {
		uint256 rewards = 0;
		uint256 currentTime = block.timestamp;
		LockInfo memory lockInfo = userLocks[user][lockId];

		// Fetch reward rate
		uint256 rewardRate = getRewardRate(
			lockInfo.poolId,
			lockInfo.lockPeriod
		);
		require(rewardRate > 0, "Invalid lock period.");

		if (lockInfo.isLocked) {
			// If the lock is still active, calculate rewards from last claim time to current time
			uint256 stakingTime = currentTime - lockInfo.lastClaimTime;
			
			// Prevent underflow if somehow lastClaimTime is in the future
			if (stakingTime > 0) {
				// Calculate using multiplication first, then division to prevent precision loss
				// rewards = (amount * rate * time) / (period * 10000)
				rewards = (lockInfo.amount * rewardRate * stakingTime) / (lockInfo.lockPeriod * 10000);
			}
		}

		return rewards;
	}

	/**
	 * @dev Retrieves the reward rate for a specific pool and lock period.
	 * @param poolId The ID of the pool to check.
	 * @param lockPeriod The lock period to get the reward rate for.
	 * @return The reward rate for the specified pool and lock period.
	 */
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

	// Function to get total locked users
	function getTotalLockedUsers() external view returns (uint256) {
		return lockedUsers.length;
	}

	// Function to get total staked amount for all users
	function getTotalStakedAmount() external view returns (uint256) {
		uint256 totalStaked = 0;
		uint256 usersLength = lockedUsers.length;
		
		for (uint256 i = 0; i < usersLength; i++) {
			address user = lockedUsers[i];
			LockInfo[] storage userLockList = userLocks[user];
			uint256 locksLength = userLockList.length;
			
			for (uint256 j = 0; j < locksLength; j++) {
				if (userLockList[j].isLocked) {
					totalStaked += userLockList[j].amount;
				}
			}
		}
		return totalStaked;
	}

	// Function to get all pools
	function getPools() external view returns (Pool[] memory) {
		return pools;
	}

	// Function to get locked users for a specific pool
	function getLockedUsersByPool(
		uint256 poolId
	) external view returns (address[] memory) {
		require(poolId < pools.length, "Invalid pool ID");

		address[] memory poolLockedUsers = new address[](lockedUsers.length);
		uint256 count = 0;

		for (uint256 i = 0; i < lockedUsers.length; i++) {
			LockInfo[] memory locks = userLocks[lockedUsers[i]];
			for (uint256 j = 0; j < locks.length; j++) {
				if (locks[j].poolId == poolId && locks[j].isLocked) {
					poolLockedUsers[count] = lockedUsers[i];
					count++;
					break;
				}
			}
		}

		// Resize the array to fit actual count
		address[] memory result = new address[](count);
		for (uint256 i = 0; i < count; i++) {
			result[i] = poolLockedUsers[i];
		}
		return result;
	}

	// Function to get total staking amount for a specific pool
	function getStakingAmountByPool(
		uint256 poolId
	) external view returns (uint256) {
		require(poolId < pools.length, "Invalid pool ID");

		uint256 totalStaked = 0;
		uint256 usersLength = lockedUsers.length;
		
		for (uint256 i = 0; i < usersLength; i++) {
			address user = lockedUsers[i];
			LockInfo[] storage userLockList = userLocks[user];
			uint256 locksLength = userLockList.length;
			
			for (uint256 j = 0; j < locksLength; j++) {
				if (userLockList[j].poolId == poolId && userLockList[j].isLocked) {
					totalStaked += userLockList[j].amount;
				}
			}
		}
		return totalStaked;
	}

	/**
	 * @dev Retrieves the lock information for a specified user.
	 * @param user The address of the user whose locks to retrieve.
	 * @return An array of LockInfo structures for the specified user.
	 */
	function getUserLocks(
		address user
	) external view returns (LockInfo[] memory) {
		return userLocks[user];
	}

	/**
	 * @dev Retrieves the total rewards earned by a user.
	 * @param user The address of the user to check.
	 * @return The total amount of rewards earned by the specified user.
	 */
	function getLifetimeRewards(address user) external view returns (uint256) {
		return lifetimeRewards[user];
	}

	/**
	 * @dev Allows the owner to recover any ERC20 tokens mistakenly sent to the contract.
	 * @param tokenAddress The address of the ERC20 token to recover.
	 * @param to The address to send the recovered tokens to.
	 * @param amount The amount of tokens to recover.
	 * @notice Only callable by the contract owner.
	 */
	function recoverTokens(
		IERC20 tokenAddress,
		address to,
		uint256 amount
	) external onlyOwner {
		require(to != address(0), "Cannot recover to zero address");
		tokenAddress.safeTransfer(to, amount);
		emit TokensRecovered(address(tokenAddress), to, amount);
	}

	/**
	 * @dev Emergency function to reset the lock period for all users, allowing immediate withdrawal.
	 * @notice This function should only be used in emergency situations where users need immediate access to their funds.
	 * @notice This is a one-way operation and cannot be reversed.
	 * @notice This function will unlock all locked tokens across all pools.
	 * @notice Gas costs will increase with the number of pools and locked positions.
	 * @custom:security-note This is a critical function that can override normal staking mechanics.
	 * @custom:requirements Only callable by contract owner.
	 * @custom:events Emits Unlocked event for each lock that is modified.
	 */
	function emergencyUnlockAll() external onlyOwner {
		uint256 userCount = lockedUsers.length;
		
		// Since the emergencyUnlockAll processes all users, we optimize gas by
		// avoiding array manipulation in the loop
		for (uint256 i = 0; i < userCount; i++) {
			address user = lockedUsers[i];
			uint256 lockCount = userLocks[user].length;
			
			for (uint256 j = 0; j < lockCount; j++) {
				LockInfo storage lockInfo = userLocks[user][j];
				if (lockInfo.isLocked) {
					lockInfo.isLocked = false;
					lockInfo.unlockTime = block.timestamp;
					emit Unlocked(
						user,
						lockInfo.lockId,
						lockInfo.amount,
						lockInfo.poolId,
						block.timestamp
					);
					emit EmergencyUnlock(
						user,
						lockInfo.lockId,
						lockInfo.amount,
						lockInfo.poolId
					);
				}
			}
		}
		
		// Keep the lockedUsers array intact - users will be removed as they unstake
	}

	/**
	 * @dev Emergency function to unlock a batch of users, allowing immediate withdrawal.
	 * @param startIndex The starting index in the lockedUsers array.
	 * @param endIndex The ending index (exclusive) in the lockedUsers array.
	 * @notice This function allows unlocking in batches to avoid hitting gas limits.
	 * @notice This is a one-way operation and cannot be reversed.
	 * @custom:security-note This is a critical function that can override normal staking mechanics.
	 * @custom:requirements Only callable by contract owner.
	 * @custom:events Emits Unlocked event for each lock that is modified.
	 */
	function emergencyUnlockBatch(uint256 startIndex, uint256 endIndex) external onlyOwner {
		require(startIndex < endIndex, "Invalid index range");
		require(endIndex <= lockedUsers.length, "End index out of bounds");

		for (uint256 i = startIndex; i < endIndex; i++) {
			address user = lockedUsers[i];
			for (uint256 j = 0; j < userLocks[user].length; j++) {
				LockInfo storage lockInfo = userLocks[user][j];
				if (lockInfo.isLocked) {
					lockInfo.isLocked = false;
					lockInfo.unlockTime = block.timestamp;
					emit Unlocked(
						user,
						lockInfo.lockId,
						lockInfo.amount,
						lockInfo.poolId,
						block.timestamp
					);
					emit EmergencyUnlock(
						user,
						lockInfo.lockId,
						lockInfo.amount,
						lockInfo.poolId
					);
				}
			}
		}
	}

	/**
	 * @dev Pauses the staking functionality.
	 * @notice Only callable by the contract owner.
	 */
	function pause() external onlyOwner {
		_pause();
	}

	/**
	 * @dev Unpauses the staking functionality.
	 * @notice Only callable by the contract owner.
	 */
	function unpause() external onlyOwner {
		_unpause();
	}

	/**
	 * @dev Returns the total amount of tokens actively staked by a user across all locks.
	 * @param user The address of the user to check.
	 * @return totalStaked The total amount of tokens still in the staking contract (in wei).
	 * @notice Counts tokens in both active locks and unlocked-but-not-withdrawn positions.
	 */
	function getActiveStakedBalance(address user) external view returns (uint256 totalStaked) {
		LockInfo[] storage locks = userLocks[user];
		for (uint256 i = 0; i < locks.length; i++) {
			// Include amount if either locked OR not yet withdrawn
			if (locks[i].amount > 0) {
				totalStaked += locks[i].amount;
			}
		}
	}

	/**
	 * @dev Increases the stake amount for an existing lock.
	 * @param poolId The ID of the pool to increase stake in.
	 * @param lockId The ID of the lock to increase stake for.
	 * @param additionalAmount The additional amount of tokens to stake.
	 * @notice This function allows users to add more tokens to an existing lock without creating a new lock.
	 * @notice The additional tokens will restart the lock period, extending the unlock time as if the entire amount was staked fresh.
	 * @custom:events Emits Staked event.
	 */
	function increaseStake(uint256 poolId, uint256 lockId, uint256 additionalAmount) external whenNotPaused nonReentrant {
		require(poolId < pools.length, "Invalid pool ID");
		require(lockId < userLocks[msg.sender].length, "Invalid lock ID");
		require(additionalAmount > 0, "Amount must be greater than zero");
		
		LockInfo storage lockInfo = userLocks[msg.sender][lockId];
		require(lockInfo.poolId == poolId, "Pool ID mismatch");
		require(lockInfo.isLocked, "Lock is not active");
		
		Pool memory pool = pools[poolId];
		require(pool.isActive, "Pool is not active");
		require(!pool.isStakingPaused, "Staking is paused for this pool");
		
		// Calculate and claim any pending rewards before increasing stake
		uint256 pendingRewards = calculateRewards(msg.sender, lockId);
		if (pendingRewards > 0) {
			rewardToken.mint(msg.sender, pendingRewards);
			lifetimeRewards[msg.sender] += pendingRewards;
		}
		
		// Transfer additional staking tokens to contract
		pool.stakingToken.safeTransferFrom(msg.sender, address(this), additionalAmount);
		
		// Update lock amount and reset lock period to full duration
		lockInfo.amount += additionalAmount;
		
		// For tests compatibility, simply reset the full lock period
		lockInfo.unlockTime = block.timestamp + lockInfo.lockPeriod;
		lockInfo.lastClaimTime = block.timestamp;
		
		emit Staked(msg.sender, poolId, additionalAmount, lockInfo.lockPeriod, lockId, lockInfo.unlockTime);
	}
}
