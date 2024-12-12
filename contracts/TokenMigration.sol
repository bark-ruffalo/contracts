// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MigratedToken.sol";

/**
 * @title TokenMigration
 * @dev Handles migration from old PAWSY to new mPAWSY token
 */
contract TokenMigration is AccessControl, Pausable, ReentrancyGuard {
	using SafeERC20 for IERC20;

	bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

	IERC20 public immutable oldToken;
	MigratedToken public immutable newToken;

	// Migration ratio (1:1 in this case)
	uint256 public constant MIGRATION_RATIO = 1;

	event TokensMigrated(address indexed user, uint256 amount);
	event MigrationPaused(address indexed pauser);
	event MigrationUnpaused(address indexed pauser);

	constructor(address _oldToken, address _newToken) {
		require(_oldToken != address(0), "Invalid old token");
		require(_newToken != address(0), "Invalid new token");

		oldToken = IERC20(_oldToken);
		newToken = MigratedToken(_newToken);

		// Set DEFAULT_ADMIN_ROLE
		_grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
		_grantRole(PAUSER_ROLE, msg.sender);
	}

	/**
	 * @dev Migrates tokens from old to new contract
	 * @param amount Amount of old tokens to migrate
	 */
	function migrateTokens(uint256 amount) external nonReentrant whenNotPaused {
		require(amount > 0, "Amount must be greater than 0");

		// Transfer old tokens to this contract
		oldToken.safeTransferFrom(msg.sender, address(this), amount);

		// Calculate new token amount
		uint256 newAmount = (amount * MIGRATION_RATIO);

		// Mint new tokens to user
		newToken.mint(msg.sender, newAmount);

		emit TokensMigrated(msg.sender, amount);
	}

	/**
	 * @dev Allows admin to pause migration
	 */
	function pause() external onlyRole(PAUSER_ROLE) {
		_pause();
		emit MigrationPaused(msg.sender);
	}

	/**
	 * @dev Allows admin to unpause migration
	 */
	function unpause() external onlyRole(PAUSER_ROLE) {
		_unpause();
		emit MigrationUnpaused(msg.sender);
	}

	/**
	 * @dev Allows admin to recover any ERC20 tokens sent to this contract by mistake
	 */
	function recoverERC20(
		address tokenAddress,
		uint256 amount
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		require(
			tokenAddress != address(oldToken),
			"Cannot recover migration token"
		);
		IERC20(tokenAddress).safeTransfer(msg.sender, amount);
	}
}
