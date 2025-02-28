import { expect } from "chai";
import { ethers } from "hardhat";
import { RewardsMarket, RewardToken, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { GAS_LIMITS } from "./constants";

describe("RewardsMarket", function () {
  let rewardsMarket: RewardsMarket;
  let rewardToken: RewardToken;
  let mockToken: MockERC20;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user, recipient, nonOwner] = await ethers.getSigners();

    // Deploy RewardToken
    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy(owner.address, owner.address, { gasLimit: GAS_LIMITS.DEPLOY });
    await rewardToken.waitForDeployment();

    // Deploy MockERC20 for testing custom token campaigns
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MTK", { gasLimit: GAS_LIMITS.DEPLOY });
    await mockToken.waitForDeployment();

    // Deploy RewardsMarket
    const RewardsMarket = await ethers.getContractFactory("RewardsMarket");
    rewardsMarket = await RewardsMarket.deploy(await rewardToken.getAddress(), { gasLimit: GAS_LIMITS.DEPLOY });
    await rewardsMarket.waitForDeployment();

    // Mint initial tokens to user for testing
    await mockToken.mint(user.address, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.MED });
    // For RewardToken, we'll assume the user already has tokens (should be handled in token distribution)
  });

  describe("Campaign Management", function () {
    it("Should create a burn campaign correctly", async function () {
      const minBurnAmount = ethers.parseEther("100");
      const endDate = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      await rewardsMarket.createCampaign(
        minBurnAmount,
        endDate,
        0, // unlimited rewards
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress, // use reward token
        ethers.ZeroAddress, // burn tokens
        { gasLimit: GAS_LIMITS.MED },
      );

      const campaign = await rewardsMarket.getCampaign(0);
      expect(campaign.minBurnAmount).to.equal(minBurnAmount);
      expect(campaign.endDate).to.equal(endDate);
      expect(campaign.isActive).to.equal(true);
    });

    it("Should create a custom token campaign correctly", async function () {
      const minAmount = ethers.parseEther("50");

      await rewardsMarket.createCampaign(
        minAmount,
        0, // no end date
        0, // unlimited rewards
        ethers.ZeroAddress,
        "0x",
        await mockToken.getAddress(),
        recipient.address,
        { gasLimit: GAS_LIMITS.HIGH },
      );

      const campaign = await rewardsMarket.getCampaign(0);
      expect(campaign.tokenAddress).to.equal(await mockToken.getAddress());
      expect(campaign.recipientAddress).to.equal(recipient.address);
    });

    it("Should modify campaign correctly", async function () {
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );

      const newMinAmount = ethers.parseEther("200");
      await rewardsMarket.modifyCampaign(
        0,
        newMinAmount,
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        await mockToken.getAddress(),
        recipient.address,
        { gasLimit: GAS_LIMITS.MED },
      );

      const campaign = await rewardsMarket.getCampaign(0);
      expect(campaign.minBurnAmount).to.equal(newMinAmount);
      expect(campaign.tokenAddress).to.equal(await mockToken.getAddress());
    });
  });

  describe("Reward Triggering", function () {
    it("Should trigger custom token reward correctly", async function () {
      const transferAmount = ethers.parseEther("50");

      // First mint tokens to the user
      await mockToken.mint(user.address, transferAmount * 2n, { gasLimit: GAS_LIMITS.MED });

      await rewardsMarket.createCampaign(
        transferAmount,
        0, // no end date
        0, // unlimited rewards
        await mockToken.getAddress(), // burn token
        "0x", // no calldata
        await mockToken.getAddress(), // reward token
        recipient.address, // recipient
        { gasLimit: GAS_LIMITS.HIGH },
      );

      // Approve mockToken
      await mockToken
        .connect(user)
        .approve(await rewardsMarket.getAddress(), transferAmount * 2n, { gasLimit: GAS_LIMITS.MED });

      const initialBalance = await mockToken.balanceOf(recipient.address);

      await rewardsMarket.modifyCampaign(
        0, // campaign ID
        transferAmount, // keep same burn amount
        0, // no end date
        0, // unlimited rewards
        ethers.ZeroAddress, // no target contract
        "0x", // no calldata
        await mockToken.getAddress(), // same token
        recipient.address, // same recipient
        { gasLimit: GAS_LIMITS.LOW },
      );

      await rewardsMarket.connect(user).triggerReward(0, transferAmount, { gasLimit: GAS_LIMITS.HIGH });

      const finalBalance = await mockToken.balanceOf(recipient.address);
      expect(finalBalance).to.equal(initialBalance + transferAmount);
    });

    it("Should fail when max rewards reached", async function () {
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        1, // max 1 reward
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.HIGH },
      );

      // Ensure user has enough tokens
      await rewardToken.mint(user.address, ethers.parseEther("200"), { gasLimit: GAS_LIMITS.MED });
      await rewardToken
        .connect(user)
        .approve(await rewardsMarket.getAddress(), ethers.parseEther("200"), { gasLimit: GAS_LIMITS.MED });

      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH });

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWithCustomError(rewardsMarket, "MaxRewardsReached");
    });
  });

  describe("Access Control", function () {
    it("Should only allow owner to create campaigns", async function () {
      await expect(
        rewardsMarket
          .connect(nonOwner)
          .createCampaign(
            ethers.parseEther("100"),
            0,
            0,
            ethers.ZeroAddress,
            "0x",
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            { gasLimit: GAS_LIMITS.MED },
          ),
      )
        .to.be.revertedWithCustomError(rewardsMarket, "OwnableUnauthorizedAccount")
        .withArgs(await nonOwner.getAddress());
    });

    it("Should only allow owner to modify campaigns", async function () {
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );

      await expect(
        rewardsMarket
          .connect(nonOwner)
          .modifyCampaign(
            0,
            ethers.parseEther("200"),
            0,
            0,
            ethers.ZeroAddress,
            "0x",
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            { gasLimit: GAS_LIMITS.MED },
          ),
      )
        .to.be.revertedWithCustomError(rewardsMarket, "OwnableUnauthorizedAccount")
        .withArgs(await nonOwner.getAddress());
    });
  });

  describe("Edge Cases", function () {
    it("Should fail when campaign is expired", async function () {
      const endDate = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        endDate,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.LOW }),
      ).to.be.revertedWithCustomError(rewardsMarket, "CampaignExpired");
    });

    it("Should fail when max rewards reached", async function () {
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        1, // max 1 reward
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.HIGH },
      );

      // Ensure user has enough tokens
      await rewardToken.mint(user.address, ethers.parseEther("200"), { gasLimit: GAS_LIMITS.MED });
      await rewardToken
        .connect(user)
        .approve(await rewardsMarket.getAddress(), ethers.parseEther("200"), { gasLimit: GAS_LIMITS.MED });

      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH });

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWithCustomError(rewardsMarket, "MaxRewardsReached");
    });
  });

  describe("Campaign Listing", function () {
    beforeEach(async function () {
      // Create multiple campaigns with different states
      // Campaign 0: Active, no end date
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );

      // Campaign 1: Active, future end date
      const futureDate = Math.floor(Date.now() / 1000) + 3600;
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        futureDate,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );

      // Campaign 2: Inactive (deactivated)
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );
      await rewardsMarket.deactivateCampaign(2, { gasLimit: GAS_LIMITS.LOW });

      // Campaign 3: Inactive (expired)
      const pastDate = Math.floor(Date.now() / 1000) - 3600;
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        pastDate,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );
    });

    it("Should return correct total number of campaigns", async function () {
      const total = await rewardsMarket.getTotalCampaigns();
      expect(total).to.equal(4);
    });

    it("Should return correct campaign IDs within range", async function () {
      const ids = await rewardsMarket.getCampaignIds(1, 3);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(1);
      expect(ids[1]).to.equal(2);
    });

    it("Should revert when requesting invalid range", async function () {
      await expect(rewardsMarket.getCampaignIds(3, 2)).to.be.revertedWith("Invalid range");
      await expect(rewardsMarket.getCampaignIds(0, 5)).to.be.revertedWith("End index out of bounds");
    });

    it("Should return correct active campaigns", async function () {
      const [ids, details] = await rewardsMarket.getActiveCampaigns(0, 4);

      // Should return 2 active campaigns (campaigns 0 and 1)
      expect(ids.length).to.equal(2);
      expect(details.length).to.equal(2);

      // Verify first campaign details
      expect(ids[0]).to.equal(0);
      expect(details[0].isActive).to.equal(true);
      expect(details[0].endDate).to.equal(0);

      // Verify second campaign details
      expect(ids[1]).to.equal(1);
      expect(details[1].isActive).to.equal(true);
      expect(details[1].endDate).to.be.greaterThan(Math.floor(Date.now() / 1000));
    });

    it("Should return correct inactive campaigns", async function () {
      const [ids, details] = await rewardsMarket.getInactiveCampaigns(0, 4);

      // Should return 2 inactive campaigns (campaigns 2 and 3)
      expect(ids.length).to.equal(2);
      expect(details.length).to.equal(2);

      // Verify deactivated campaign
      expect(ids[0]).to.equal(2);
      expect(details[0].isActive).to.equal(false);

      // Verify expired campaign
      expect(ids[1]).to.equal(3);
      expect(details[1].isActive).to.equal(true);
      expect(details[1].endDate).to.be.lessThan(Math.floor(Date.now() / 1000));
    });

    it("Should handle empty ranges correctly", async function () {
      // Test range where no active campaigns exist
      const [activeIds, activeDetails] = await rewardsMarket.getActiveCampaigns(2, 4);
      expect(activeIds.length).to.equal(0);
      expect(activeDetails.length).to.equal(0);

      // Test range where no inactive campaigns exist
      const [inactiveIds, inactiveDetails] = await rewardsMarket.getInactiveCampaigns(0, 2);
      expect(inactiveIds.length).to.equal(0);
      expect(inactiveDetails.length).to.equal(0);
    });

    it("Should handle pagination correctly", async function () {
      // Test getting active campaigns in smaller chunks
      const [ids1, details1] = await rewardsMarket.getActiveCampaigns(0, 2);
      const [ids2, details2] = await rewardsMarket.getActiveCampaigns(2, 4);

      // Combined results should match full range query
      const [fullIds, fullDetails] = await rewardsMarket.getActiveCampaigns(0, 4);

      expect([...ids1, ...ids2].length).to.equal(fullIds.length);
      expect([...details1, ...details2].length).to.equal(fullDetails.length);
    });
  });

  describe("Admin Functions", function () {
    it("Should recover tokens correctly", async function () {
      // First send some tokens to the contract
      const amount = ethers.parseEther("100");
      await mockToken.mint(await rewardsMarket.getAddress(), amount, { gasLimit: GAS_LIMITS.MED });

      const initialBalance = await mockToken.balanceOf(owner.address);

      await rewardsMarket.recoverTokens(await mockToken.getAddress(), owner.address, amount, {
        gasLimit: GAS_LIMITS.LOW,
      });

      const finalBalance = await mockToken.balanceOf(owner.address);
      expect(finalBalance - initialBalance).to.equal(amount);
    });

    it("Should revert when recovering to zero address", async function () {
      await expect(
        rewardsMarket.recoverTokens(await mockToken.getAddress(), ethers.ZeroAddress, ethers.parseEther("1"), {
          gasLimit: GAS_LIMITS.MED,
        }),
      ).to.be.revertedWith("Cannot recover to zero address");
    });

    it("Should revert when recovering more than balance", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.mint(await rewardsMarket.getAddress(), amount, { gasLimit: GAS_LIMITS.MED });

      await expect(
        rewardsMarket.recoverTokens(await mockToken.getAddress(), owner.address, amount + 1n, {
          gasLimit: GAS_LIMITS.MED,
        }),
      ).to.be.reverted; // Will revert from SafeERC20
    });

    it("Should not allow non-owner to recover tokens", async function () {
      await expect(
        rewardsMarket
          .connect(nonOwner)
          .recoverTokens(await mockToken.getAddress(), nonOwner.address, ethers.parseEther("1"), {
            gasLimit: GAS_LIMITS.MED,
          }),
      )
        .to.be.revertedWithCustomError(rewardsMarket, "OwnableUnauthorizedAccount")
        .withArgs(await nonOwner.getAddress());
    });

    it("Should pause and unpause correctly", async function () {
      await rewardsMarket.pause({ gasLimit: GAS_LIMITS.LOW });
      expect(await rewardsMarket.paused()).to.be.true;

      // Create a campaign while paused
      await expect(
        rewardsMarket.createCampaign(
          ethers.parseEther("100"),
          0,
          0,
          ethers.ZeroAddress,
          "0x",
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          { gasLimit: GAS_LIMITS.LOW },
        ),
      ).to.be.revertedWithCustomError(rewardsMarket, "EnforcedPause");

      await rewardsMarket.unpause({ gasLimit: GAS_LIMITS.LOW });
      expect(await rewardsMarket.paused()).to.be.false;
    });

    it("Should not allow non-owner to pause/unpause", async function () {
      await expect(rewardsMarket.connect(nonOwner).pause({ gasLimit: GAS_LIMITS.LOW })).to.be.revertedWithCustomError(
        rewardsMarket,
        "OwnableUnauthorizedAccount",
      );

      await expect(rewardsMarket.connect(nonOwner).unpause({ gasLimit: GAS_LIMITS.LOW })).to.be.revertedWithCustomError(
        rewardsMarket,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("User Participation", function () {
    it("Should track user participation count correctly", async function () {
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.HIGH },
      );

      expect(await rewardsMarket.getUserParticipationCount(user.address, 0)).to.equal(0);

      await rewardToken.mint(user.address, ethers.parseEther("300"), { gasLimit: GAS_LIMITS.MED });

      await rewardToken
        .connect(user)
        .approve(await rewardsMarket.getAddress(), ethers.parseEther("300"), { gasLimit: GAS_LIMITS.MED });

      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH });

      expect(await rewardsMarket.getUserParticipationCount(user.address, 0)).to.equal(1);
    });

    it("Should enforce max rewards per user", async function () {
      // Create campaign with max 2 rewards per user
      await rewardsMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        2, // Set maxRewardsPerUser to 2
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.HIGH },
      );

      // Mint enough tokens for all operations
      await rewardToken.mint(user.address, ethers.parseEther("300"), { gasLimit: GAS_LIMITS.MED });

      // Approve tokens for burning
      await rewardToken
        .connect(user)
        .approve(await rewardsMarket.getAddress(), ethers.parseEther("300"), { gasLimit: GAS_LIMITS.MED });

      // First reward should succeed
      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH });

      // Second reward should succeed
      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH });

      // Third reward should fail because max rewards per user is 2
      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWithCustomError(rewardsMarket, "MaxRewardsReached");
    });
  });

  describe("Reward Token Management", function () {
    let localMarket: RewardsMarket;

    beforeEach(async function () {
      // Clear any previous deployments
      const RewardsMarket = await ethers.getContractFactory("RewardsMarket");
      localMarket = await RewardsMarket.deploy(ethers.ZeroAddress, {
        gasLimit: GAS_LIMITS.DEPLOY,
      });
      await localMarket.waitForDeployment();
    });

    it("Should deploy without reward token", async function () {
      expect(await localMarket.rewardToken()).to.equal(ethers.ZeroAddress);
    });

    it("Should allow setting reward token", async function () {
      await localMarket.setRewardToken(await rewardToken.getAddress(), {
        gasLimit: GAS_LIMITS.LOW,
      });
      expect(await localMarket.rewardToken()).to.equal(await rewardToken.getAddress());
    });

    it("Should emit event when updating reward token", async function () {
      await expect(
        localMarket.setRewardToken(await rewardToken.getAddress(), {
          gasLimit: GAS_LIMITS.LOW,
        }),
      )
        .to.emit(localMarket, "RewardTokenUpdated")
        .withArgs(ethers.ZeroAddress, await rewardToken.getAddress());
    });

    it("Should fail to trigger reward with unset reward token", async function () {
      await localMarket.createCampaign(
        ethers.parseEther("100"),
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        { gasLimit: GAS_LIMITS.MED },
      );
      await expect(
        localMarket.triggerReward(0, ethers.parseEther("100"), {
          gasLimit: GAS_LIMITS.LOW,
        }),
      ).to.be.revertedWith("Reward token not set");
    });
  });
});
