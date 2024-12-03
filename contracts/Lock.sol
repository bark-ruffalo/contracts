// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Lock is Ownable {
	struct LockInfo {
		uint256 amount;
		uint256 lockPeriod;
		uint256 unlockTime;
		bool isLP;
		bool locked;
	}

	mapping(address => LockInfo[]) public userLocks;

	event Locked(
		address indexed user,
		uint256 amount,
		uint256 lockPeriod,
		bool isLP
	);
	event Unlocked(address indexed user, uint256 amount, bool isLP);

	constructor() Ownable(msg.sender) {}

	// Lock tokens for a specific period
	function lock(
		address user,
		uint256 amount,
		uint256 lockPeriod,
		bool isLP
	) external onlyOwner {
		uint256 unlockTime = block.timestamp + lockPeriod;
		userLocks[user].push(
			LockInfo({
				amount: amount,
				lockPeriod: lockPeriod,
				unlockTime: unlockTime,
				isLP: isLP,
				locked: true
			})
		);
		emit Locked(user, amount, lockPeriod, isLP);
	}

	// Unlock tokens (called by Vault)
	function unlock(
		address user,
		uint256 index
	) external onlyOwner returns (uint256, uint256, bool, bool) {
		require(index < userLocks[user].length, "Invalid lock index");

		LockInfo storage lockInfo = userLocks[user][index];
		require(block.timestamp >= lockInfo.unlockTime, "Lock period not over");
		require(lockInfo.locked, "Already unlocked");

		lockInfo.locked = false; // Mark as unlocked

		emit Unlocked(user, lockInfo.amount, lockInfo.isLP);
		return (
			lockInfo.amount,
			lockInfo.lockPeriod,
			lockInfo.isLP,
			lockInfo.locked
		);
	}

	// Get user lock information
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
		)
	{
		uint256 count = userLocks[user].length;

		uint256[] memory amounts = new uint256[](count);
		uint256[] memory lockPeriods = new uint256[](count);
		bool[] memory isLPs = new bool[](count);
		bool[] memory lockedStatuses = new bool[](count);

		for (uint256 i = 0; i < count; i++) {
			LockInfo storage lockInfo = userLocks[user][i];
			amounts[i] = lockInfo.amount;
			lockPeriods[i] = lockInfo.lockPeriod;
			isLPs[i] = lockInfo.isLP;
			lockedStatuses[i] = lockInfo.locked;
		}

		return (amounts, lockPeriods, isLPs, lockedStatuses);
	}
}
