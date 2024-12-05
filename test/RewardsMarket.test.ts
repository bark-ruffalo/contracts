import { expect } from "chai";
import { ethers } from "hardhat";
import { RewardsMarket, RewardToken, MockERC20 } from "../typechain-types";
import { ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

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
    rewardToken = await RewardToken.deploy({ gasLimit: 30000000 });
    await rewardToken.waitForDeployment();

    // Deploy MockERC20 for testing custom token campaigns
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MTK", { gasLimit: 30000000 });
    await mockToken.waitForDeployment();

    // Deploy RewardsMarket
    const RewardsMarket = await ethers.getContractFactory("RewardsMarket");
    rewardsMarket = await RewardsMarket.deploy(await rewardToken.getAddress(), { gasLimit: 30000000 });
    await rewardsMarket.waitForDeployment();

    // Mint initial tokens to user for testing
    await mockToken.mint(user.address, ethers.parseEther("1000"), { gasLimit: 30000000 });
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
        { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
      );

      const campaign = await rewardsMarket.getCampaign(0);
      expect(campaign.minBurnAmount).to.equal(newMinAmount);
      expect(campaign.tokenAddress).to.equal(await mockToken.getAddress());
    });
  });

  describe("Reward Triggering", function () {
    it("Should trigger custom token reward correctly", async function () {
      const transferAmount = ethers.parseEther("50");

      await rewardsMarket.createCampaign(
        transferAmount,
        0,
        0,
        ethers.ZeroAddress,
        "0x",
        await mockToken.getAddress(),
        recipient.address,
        { gasLimit: 30000000 }
      );

      await mockToken.connect(user).approve(await rewardsMarket.getAddress(), transferAmount, { gasLimit: 30000000 });

      const initialBalance = await mockToken.balanceOf(recipient.address);
      await rewardsMarket.connect(user).triggerReward(0, transferAmount, { gasLimit: 30000000 });
      const finalBalance = await mockToken.balanceOf(recipient.address);

      expect(finalBalance).to.equal(initialBalance + transferAmount);
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
            { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
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
            { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
      );

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: 30000000 }),
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
        { gasLimit: 30000000 }
      );

      // Ensure user has enough tokens
      await rewardToken.mint(user.address, ethers.parseEther("200"), { gasLimit: 30000000 });
      await rewardToken.connect(user).approve(await rewardsMarket.getAddress(), ethers.parseEther("200"), { gasLimit: 30000000 });

      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: 30000000 });

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"), { gasLimit: 30000000 }),
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
        { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
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
        { gasLimit: 30000000 }
      );
      await rewardsMarket.deactivateCampaign(2, { gasLimit: 30000000 });

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
        { gasLimit: 30000000 }
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
      expect(details[0].isActive).to.be.true;
      expect(details[0].endDate).to.equal(0);

      // Verify second campaign details
      expect(ids[1]).to.equal(1);
      expect(details[1].isActive).to.be.true;
      expect(details[1].endDate).to.be.greaterThan(Math.floor(Date.now() / 1000));
    });

    it("Should return correct inactive campaigns", async function () {
      const [ids, details] = await rewardsMarket.getInactiveCampaigns(0, 4);

      // Should return 2 inactive campaigns (campaigns 2 and 3)
      expect(ids.length).to.equal(2);
      expect(details.length).to.equal(2);

      // Verify deactivated campaign
      expect(ids[0]).to.equal(2);
      expect(details[0].isActive).to.be.false;

      // Verify expired campaign
      expect(ids[1]).to.equal(3);
      expect(details[1].isActive).to.be.true;
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
});
