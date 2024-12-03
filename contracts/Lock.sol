// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Lock is Ownable {
	struct LockInfo {
		uint256 amount; // Amount of tokens locked
		uint256 lockPeriod; // Lock duration in seconds
		uint256 unlockTime; // Timestamp when tokens can be unlocked
		uint256 poolId; // Pool ID (useful for multiple staking pools)
		bool isLocked; // Whether the lock is still active
	}

	mapping(address => LockInfo[]) public userLocks; // Tracks locks for each user

	event Locked(
		address indexed user,
		uint256 amount,
		uint256 lockPeriod,
		uint256 unlockTime,
		uint256 poolId
	);
	event Unlocked(address indexed user, uint256 amount, uint256 poolId);

	constructor() Ownable(msg.sender) {}

	/**
	 * @dev Locks the user's tokens.
	 * @param user The address of the user.
	 * @param amount The amount of tokens to lock.
	 * @param lockPeriod The duration for which tokens are locked.
	 * @param poolId The ID of the pool the lock belongs to.
	 */
	function lock(
		address user,
		uint256 amount,
		uint256 lockPeriod,
		uint256 poolId
	) external onlyOwner {
		require(user != address(0), "Invalid user address");
		require(amount > 0, "Amount must be greater than zero");
		require(lockPeriod > 0, "Lock period must be greater than zero");

		uint256 unlockTime = block.timestamp + lockPeriod;

		userLocks[user].push(
			LockInfo({
				amount: amount,
				lockPeriod: lockPeriod,
				unlockTime: unlockTime,
				poolId: poolId,
				isLocked: true
			})
		);

		emit Locked(user, amount, lockPeriod, unlockTime, poolId);
	}

	/**
	 * @dev Unlocks the user's tokens if the lock period has expired.
	 * @param user The address of the user.
	 * @param index The index of the lock to unlock.
	 */
	function unlock(
		address user,
		uint256 index
	)
		external
		onlyOwner
		returns (
			uint256 amount,
			uint256 lockPeriod,
			uint256 poolId,
			bool isLocked
		)
	{
		require(user != address(0), "Invalid user address");
		require(index < userLocks[user].length, "Invalid lock index");

		LockInfo storage lockInfo = userLocks[user][index];
		require(block.timestamp >= lockInfo.unlockTime, "Lock period not over");
		require(lockInfo.isLocked, "Lock already unlocked");

		lockInfo.isLocked = false; // Mark as unlocked

		emit Unlocked(user, lockInfo.amount, lockInfo.poolId);

		return (
			lockInfo.amount,
			lockInfo.lockPeriod,
			lockInfo.poolId,
			lockInfo.isLocked
		);
	}

	/**
	 * @dev Fetches all locks for a user.
	 * @param user The address of the user.
	 * @return amounts Array of locked amounts.
	 * @return lockPeriods Array of lock periods.
	 * @return unlockTimes Array of unlock times.
	 * @return poolIds Array of pool IDs.
	 * @return isLockedStatuses Array of lock statuses.
	 */
	function getLocks(
		address user
	)
		external
		view
		returns (
			uint256[] memory amounts,
			uint256[] memory lockPeriods,
			uint256[] memory unlockTimes,
			uint256[] memory poolIds,
			bool[] memory isLockedStatuses
		)
	{
		uint256 count = userLocks[user].length;

		amounts = new uint256[](count);
		lockPeriods = new uint256[](count);
		unlockTimes = new uint256[](count);
		poolIds = new uint256[](count);
		isLockedStatuses = new bool[](count);

		for (uint256 i = 0; i < count; i++) {
			LockInfo storage lockInfo = userLocks[user][i];
			amounts[i] = lockInfo.amount;
			lockPeriods[i] = lockInfo.lockPeriod;
			unlockTimes[i] = lockInfo.unlockTime;
			poolIds[i] = lockInfo.poolId;
			isLockedStatuses[i] = lockInfo.isLocked;
		}
	}
}
