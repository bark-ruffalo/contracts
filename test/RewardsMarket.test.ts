import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RewardsMarket", function () {
  let rewardsMarket: Contract;
  let rewardToken: Contract;
  let mockToken: Contract;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user, recipient, nonOwner] = await ethers.getSigners();

    // Deploy RewardToken
    const RewardToken: ContractFactory = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy();
    await rewardToken.waitForDeployment();

    // Deploy MockERC20 for testing custom token campaigns
    const MockERC20: ContractFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MTK");
    await mockToken.waitForDeployment();

    // Deploy RewardsMarket
    const RewardsMarket: ContractFactory = await ethers.getContractFactory("RewardsMarket");
    rewardsMarket = await RewardsMarket.deploy(await rewardToken.getAddress());
    await rewardsMarket.waitForDeployment();

    // Mint initial tokens to user for testing
    await mockToken.mint(user.address, ethers.parseEther("1000"));
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
      );

      await mockToken.connect(user).approve(await rewardsMarket.getAddress(), transferAmount);

      const initialBalance = await mockToken.balanceOf(recipient.address);
      await rewardsMarket.connect(user).triggerReward(0, transferAmount);
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
      );

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100")),
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
      );

      // Ensure user has enough tokens
      await rewardToken.mint(user.address, ethers.parseEther("200"));
      await rewardToken.connect(user).approve(await rewardsMarket.getAddress(), ethers.parseEther("200"));

      await rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100"));

      await expect(
        rewardsMarket.connect(user).triggerReward(0, ethers.parseEther("100")),
      ).to.be.revertedWithCustomError(rewardsMarket, "MaxRewardsReached");
    });
  });
});
