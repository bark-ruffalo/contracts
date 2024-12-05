// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./RewardToken.sol";

/**
 * @title RewardsMarket
 * @notice Manages reward campaigns where users can burn tokens to trigger rewards
 * @dev Uses ReentrancyGuard to prevent reentrancy attacks and Pausable for emergency stops
 */
contract RewardsMarket is Ownable, ReentrancyGuard, Pausable {
	using SafeERC20 for IERC20;

	struct Campaign {
		uint256 minBurnAmount; // Minimum amount of tokens to burn
		uint256 endDate; // 0 means no end date
		uint256 maxRewards; // 0 means unlimited
		uint256 rewardsIssued; // Counter for issued rewards
		address targetContract; // Contract to call when reward is triggered
		bytes targetCalldata; // Calldata for the external call
		bool isActive; // Whether the campaign is currently active
		uint256 createdAt; // Timestamp when campaign was created
		address tokenAddress; // Token to be spent (address(0) means use rewardToken)
		address recipientAddress; // Where tokens go (address(0) means burn)
	}

	RewardToken public immutable rewardToken;

	// Campaign ID => Campaign details
	mapping(uint256 => Campaign) public campaigns;
	uint256 public nextCampaignId;

	// User address => Campaign ID => Number of times participated
	mapping(address => mapping(uint256 => uint256)) public userParticipation;

	event CampaignCreated(
		uint256 indexed campaignId,
		uint256 minBurnAmount,
		uint256 endDate,
		address tokenAddress,
		address recipientAddress
	);
	event CampaignModified(uint256 indexed campaignId);
	event CampaignDeactivated(uint256 indexed campaignId);
	event RewardTriggered(
		uint256 indexed campaignId,
		address indexed user,
		uint256 burnAmount,
		bool externalCallSuccess
	);
	event TokensRecovered(address indexed token, uint256 amount);

	error CampaignNotActive();
	error CampaignExpired();
	error MaxRewardsReached();
	error InsufficientBurnAmount();
	error ExternalCallFailed();

	constructor(address _rewardToken) Ownable(msg.sender) {
		rewardToken = RewardToken(_rewardToken);
	}

	/**
	 * @notice Creates a new reward campaign
	 * @param minBurnAmount Minimum tokens required to burn
	 * @param endDate Campaign end date (0 for no end date)
	 * @param maxRewards Maximum number of rewards (0 for unlimited)
	 * @param targetContract Contract to call (address(0) for no call)
	 * @param targetCalldata Calldata for external call
	 * @param tokenAddress Token to be spent (address(0) means use rewardToken)
	 * @param recipientAddress Where tokens go (address(0) means burn)
	 */
	function createCampaign(
		uint256 minBurnAmount,
		uint256 endDate,
		uint256 maxRewards,
		address targetContract,
		bytes calldata targetCalldata,
		address tokenAddress,
		address recipientAddress
	) external onlyOwner {
		uint256 campaignId = nextCampaignId++;

		campaigns[campaignId] = Campaign({
			minBurnAmount: minBurnAmount,
			endDate: endDate,
			maxRewards: maxRewards,
			rewardsIssued: 0,
			targetContract: targetContract,
			targetCalldata: targetCalldata,
			isActive: true,
			createdAt: block.timestamp,
			tokenAddress: tokenAddress,
			recipientAddress: recipientAddress
		});

		emit CampaignCreated(
			campaignId,
			minBurnAmount,
			endDate,
			tokenAddress,
			recipientAddress
		);
	}

	/**
	 * @notice Modifies an existing campaign
	 * @param campaignId ID of the campaign to modify
	 * @param minBurnAmount Minimum tokens required to burn
	 * @param endDate Campaign end date (0 for no end date)
	 * @param maxRewards Maximum number of rewards (0 for unlimited)
	 * @param targetContract Contract to call (address(0) for no call)
	 * @param targetCalldata Calldata for external call
	 * @param tokenAddress Token to be spent (address(0) means use rewardToken)
	 * @param recipientAddress Where tokens go (address(0) means burn)
	 */
	function modifyCampaign(
		uint256 campaignId,
		uint256 minBurnAmount,
		uint256 endDate,
		uint256 maxRewards,
		address targetContract,
		bytes calldata targetCalldata,
		address tokenAddress,
		address recipientAddress
	) external onlyOwner {
		Campaign storage campaign = campaigns[campaignId];
		require(campaign.isActive, "Campaign does not exist");

		campaign.minBurnAmount = minBurnAmount;
		campaign.endDate = endDate;
		campaign.maxRewards = maxRewards;
		campaign.targetContract = targetContract;
		campaign.targetCalldata = targetCalldata;
		campaign.tokenAddress = tokenAddress;
		campaign.recipientAddress = recipientAddress;

		emit CampaignModified(campaignId);
	}

	/**
	 * @notice Deactivates a campaign
	 * @param campaignId ID of the campaign to deactivate
	 */
	function deactivateCampaign(uint256 campaignId) external onlyOwner {
		require(campaigns[campaignId].isActive, "Campaign not active");
		campaigns[campaignId].isActive = false;
		emit CampaignDeactivated(campaignId);
	}

	/**
	 * @notice Triggers a reward by burning tokens
	 * @param campaignId ID of the campaign
	 * @param burnAmount Amount of tokens to burn
	 */
	function triggerReward(
		uint256 campaignId,
		uint256 burnAmount
	) external nonReentrant whenNotPaused {
		Campaign storage campaign = campaigns[campaignId];

		if (!campaign.isActive) revert CampaignNotActive();
		if (campaign.endDate != 0 && block.timestamp > campaign.endDate)
			revert CampaignExpired();
		if (
			campaign.maxRewards != 0 &&
			campaign.rewardsIssued >= campaign.maxRewards
		) revert MaxRewardsReached();
		if (burnAmount < campaign.minBurnAmount)
			revert InsufficientBurnAmount();

		// Handle token transfer/burn
		if (campaign.tokenAddress == address(0)) {
			// Use rewardToken and burn
			rewardToken.burnFrom(msg.sender, burnAmount);
		} else {
			// Use custom token and transfer to recipient
			require(
				campaign.recipientAddress != address(0),
				"Recipient not set for custom token"
			);
			IERC20(campaign.tokenAddress).safeTransferFrom(
				msg.sender,
				campaign.recipientAddress,
				burnAmount
			);
		}

		// Execute external call if configured
		bool callSuccess = true;
		if (campaign.targetContract != address(0)) {
			(callSuccess, ) = campaign.targetContract.call(
				campaign.targetCalldata
			);
			if (!callSuccess) revert ExternalCallFailed();
		}

		campaign.rewardsIssued++;
		userParticipation[msg.sender][campaignId]++;

		emit RewardTriggered(campaignId, msg.sender, burnAmount, callSuccess);
	}

	/**
	 * @notice Recovers tokens accidentally sent to the contract
	 * @param token Token address to recover
	 */
	function recoverTokens(address token) external onlyOwner {
		uint256 balance = IERC20(token).balanceOf(address(this));
		IERC20(token).safeTransfer(owner(), balance);
		emit TokensRecovered(token, balance);
	}

	/**
	 * @notice Emergency pause
	 */
	function pause() external onlyOwner {
		_pause();
	}

	/**
	 * @notice Unpause the contract
	 */
	function unpause() external onlyOwner {
		_unpause();
	}

	/**
	 * @notice Returns campaign details
	 * @param campaignId Campaign ID to query
	 */
	function getCampaign(
		uint256 campaignId
	)
		external
		view
		returns (
			uint256 minBurnAmount,
			uint256 endDate,
			uint256 maxRewards,
			uint256 rewardsIssued,
			address targetContract,
			bytes memory targetCalldata,
			bool isActive,
			uint256 createdAt,
			address tokenAddress,
			address recipientAddress
		)
	{
		Campaign storage campaign = campaigns[campaignId];
		return (
			campaign.minBurnAmount,
			campaign.endDate,
			campaign.maxRewards,
			campaign.rewardsIssued,
			campaign.targetContract,
			campaign.targetCalldata,
			campaign.isActive,
			campaign.createdAt,
			campaign.tokenAddress,
			campaign.recipientAddress
		);
	}

	/**
	 * @notice Returns number of times a user has participated in a campaign
	 */
	function getUserParticipationCount(
		address user,
		uint256 campaignId
	) external view returns (uint256) {
		return userParticipation[user][campaignId];
	}
}
