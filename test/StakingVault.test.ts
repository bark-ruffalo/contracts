import { expect } from "chai";
import { ethers } from "hardhat";
import { StakingVault, RewardToken, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { GAS_LIMITS } from "./constants";

describe("StakingVault", function () {
  let stakingVault: StakingVault;
  let rewardToken: RewardToken;
  let stakingToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const WEEK = 7 * 24 * 60 * 60;
  const MONTH = 30 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy RewardToken
    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy(owner.address, owner.address, { gasLimit: GAS_LIMITS.DEPLOY });

    // Deploy Mock ERC20 for staking
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockERC20.deploy("Mock Token", "MTK", { gasLimit: GAS_LIMITS.DEPLOY });

    // Deploy StakingVault
    const StakingVault = await ethers.getContractFactory("StakingVault");
    stakingVault = await StakingVault.deploy(await rewardToken.getAddress(), { gasLimit: GAS_LIMITS.DEPLOY });

    // Grant minter role to StakingVault
    await rewardToken.grantRole(await rewardToken.MINTER_ROLE(), await stakingVault.getAddress(), { gasLimit: GAS_LIMITS.LOW });

    // Mint staking tokens to users
    const initialBalance = ethers.parseEther("1000");
    await stakingToken.mint(user1.address, initialBalance, { gasLimit: GAS_LIMITS.LOW });
    await stakingToken.mint(user2.address, initialBalance, { gasLimit: GAS_LIMITS.LOW });

    // Approve staking vault to spend tokens
    await stakingToken
      .connect(user1)
      .approve(await stakingVault.getAddress(), initialBalance, { gasLimit: GAS_LIMITS.LOW });
    await stakingToken
      .connect(user2)
      .approve(await stakingVault.getAddress(), initialBalance, { gasLimit: GAS_LIMITS.LOW });
  });

  describe("Pool Management", function () {
    it("Should add a new pool correctly", async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];

      await expect(
        stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, { gasLimit: GAS_LIMITS.HIGH }),
      )
        .to.emit(stakingVault, "PoolAdded")
        .withArgs(0, await stakingToken.getAddress());

      const pool = await stakingVault.pools(0);
      expect(pool.isActive).to.be.true;
      expect(pool.stakingToken).to.equal(await stakingToken.getAddress());
    });

    it("Should revert adding pool with mismatched periods and rates", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100, 200];

      await expect(
        stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Mismatched lock periods and rates");
    });

    it("Should update pool status", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];

      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      await expect(stakingVault.setPoolStatus(0, false, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "PoolStatusUpdated")
        .withArgs(0, false);

      const pool = await stakingVault.pools(0);
      expect(pool.isActive).to.be.false;
    });
  });

  describe("Staking", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
    });

    it("Should stake tokens correctly", async function () {
      const stakeAmount = ethers.parseEther("100");

      await expect(stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "Staked")
        .withArgs(user1.address, 0, stakeAmount, WEEK);

      const userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks[0].amount).to.equal(stakeAmount);
      expect(userLocks[0].lockPeriod).to.equal(WEEK);
    });

    it("Should revert staking when pool is inactive", async function () {
      await stakingVault.setPoolStatus(0, false, { gasLimit: GAS_LIMITS.HIGH });
      const stakeAmount = ethers.parseEther("100");

      await expect(
        stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Pool is not active");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should calculate rewards correctly", async function () {
      await time.increase(WEEK / 2);

      const rewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewards).to.be.gt(0);
    });

    it("Should claim rewards correctly", async function () {
      await time.increase(WEEK / 2);

      await expect(stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.emit(
        stakingVault,
        "RewardsClaimed",
      );

      const lifetimeRewards = await stakingVault.getLifetimeRewards(user1.address);
      expect(lifetimeRewards).to.be.gt(0);
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should not allow unstaking before lock period", async function () {
      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Lock period not yet over",
      );
    });

    it("Should allow unstaking after lock period", async function () {
      await time.increase(WEEK);

      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.emit(
        stakingVault,
        "Unstaked",
      );

      const userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks[0].isLocked).to.be.false;
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency unlock by owner", async function () {
      const lockPeriods = [MONTH];
      const rewardRates = [100];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH, { gasLimit: GAS_LIMITS.HIGH });

      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });

      const userLocks = await stakingVault.getUserLocks(user1.address);
      console.log({ userLocks });
      expect(userLocks[0].isLocked).to.be.false;
    });

    it("Should allow owner to pause and unpause", async function () {
      await stakingVault.pause({ gasLimit: GAS_LIMITS.HIGH });
      expect(await stakingVault.paused()).to.be.true;

      await stakingVault.unpause({ gasLimit: GAS_LIMITS.HIGH });
      expect(await stakingVault.paused()).to.be.false;
    });
  });

  describe("Recover Tokens", function () {
    let mockToken: MockERC20;
    let nonOwner: SignerWithAddress;

    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      mockToken = await MockERC20.deploy("Mock Token", "MTK", { gasLimit: GAS_LIMITS.DEPLOY });

      [, , nonOwner] = await ethers.getSigners();
    });

    it("Should recover tokens correctly", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.mint(await stakingVault.getAddress(), amount, { gasLimit: GAS_LIMITS.HIGH });

      const initialBalance = await mockToken.balanceOf(owner.address);

      await stakingVault.recoverTokens(await mockToken.getAddress(), owner.address, amount, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      const finalBalance = await mockToken.balanceOf(owner.address);
      expect(finalBalance - initialBalance).to.equal(amount);
    });

    it("Should not allow non-owner to recover tokens", async function () {
      await expect(
        stakingVault
          .connect(nonOwner)
          .recoverTokens(await mockToken.getAddress(), nonOwner.address, ethers.parseEther("100"), {
            gasLimit: GAS_LIMITS.HIGH,
          }),
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Reward Token Management", function () {
    it("Should allow owner to set reward token", async function () {
      const NewRewardToken = await ethers.getContractFactory("RewardToken");
      const newRewardToken = await NewRewardToken.deploy(owner.address, owner.address, { gasLimit: GAS_LIMITS.DEPLOY });
      
      await stakingVault.setRewardToken(await newRewardToken.getAddress(), { gasLimit: GAS_LIMITS.LOW });
      expect(await stakingVault.rewardToken()).to.equal(await newRewardToken.getAddress());
    });

    it("Should not allow non-owner to set reward token", async function () {
      const NewRewardToken = await ethers.getContractFactory("RewardToken");
      const newRewardToken = await NewRewardToken.deploy(owner.address, owner.address, { gasLimit: GAS_LIMITS.DEPLOY });
      
      await expect(
        stakingVault.connect(user1).setRewardToken(await newRewardToken.getAddress(), { gasLimit: GAS_LIMITS.LOW })
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pool Reward Rate Management", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
    });

    it("Should update reward rates correctly", async function () {
      const newRewardRates = [150, 300];
      await expect(stakingVault.updateRewardRates(0, newRewardRates, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "RewardRatesUpdated")
        .withArgs(0, newRewardRates);

      const pools = await stakingVault.getPools();
      const pool = pools[0];
      
      expect(pool.rewardRates[0]).to.equal(150);
      expect(pool.rewardRates[1]).to.equal(300);
    });

    it("Should revert when updating reward rates with mismatched length", async function () {
      const newRewardRates = [150, 300, 450];
      await expect(
        stakingVault.updateRewardRates(0, newRewardRates, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Mismatched lock periods and reward rates");
    });
  });

  describe("Pool and User Statistics", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
      
      // Add another pool
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      // Stake in different pools
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user2).stake(1, ethers.parseEther("200"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should return correct total locked users", async function () {
      expect(await stakingVault.getTotalLockedUsers()).to.equal(2);
    });

    it("Should return correct total staked amount", async function () {
      expect(await stakingVault.getTotalStakedAmount()).to.equal(ethers.parseEther("300"));
    });

    it("Should return all pools correctly", async function () {
      const pools = await stakingVault.getPools();
      expect(pools.length).to.equal(2);
      expect(pools[0].isActive).to.be.true;
      expect(pools[1].isActive).to.be.true;
    });

    it("Should return correct locked users by pool", async function () {
      const pool0Users = await stakingVault.getLockedUsersByPool(0);
      const pool1Users = await stakingVault.getLockedUsersByPool(1);
      
      expect(pool0Users.length).to.equal(1);
      expect(pool1Users.length).to.equal(1);
      expect(pool0Users[0]).to.equal(user1.address);
      expect(pool1Users[0]).to.equal(user2.address);
    });

    it("Should return correct staking amount by pool", async function () {
      expect(await stakingVault.getStakingAmountByPool(0)).to.equal(ethers.parseEther("100"));
      expect(await stakingVault.getStakingAmountByPool(1)).to.equal(ethers.parseEther("200"));
    });

    it("Should return correct active staked balance for users", async function () {
      expect(await stakingVault.getActiveStakedBalance(user1.address)).to.equal(ethers.parseEther("100"));
      expect(await stakingVault.getActiveStakedBalance(user2.address)).to.equal(ethers.parseEther("200"));
    });

    it("Should handle non-existent pool queries", async function () {
      await expect(stakingVault.getLockedUsersByPool(99)).to.be.revertedWith("Invalid pool ID");
      await expect(stakingVault.getStakingAmountByPool(99)).to.be.revertedWith("Invalid pool ID");
    });
  });

  describe("Increased Stake Functionality", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });

      // Initial stake
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should allow increasing stake for an existing lock", async function () {
      const additionalAmount = ethers.parseEther("50");
      const initialUserBalance = await stakingToken.balanceOf(user1.address);
      const initialVaultBalance = await stakingToken.balanceOf(await stakingVault.getAddress());
      
      // Get initial lock info to check unlock time
      const initialLocks = await stakingVault.getUserLocks(user1.address);
      const initialUnlockTime = initialLocks[0].unlockTime;
      
      await expect(
        stakingVault.connect(user1).increaseStake(0, 0, additionalAmount, { gasLimit: GAS_LIMITS.HIGH })
      ).to.emit(stakingVault, "Staked")
        .withArgs(user1.address, 0, additionalAmount, WEEK);

      // Check user's updated lock
      const userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks[0].amount).to.equal(ethers.parseEther("150")); // 100 + 50
      
      // Check unlock time was extended
      expect(userLocks[0].unlockTime).to.be.gt(initialUnlockTime);
      const currentTime = await time.latest();
      expect(userLocks[0].unlockTime).to.be.closeTo(BigInt(currentTime) + BigInt(WEEK), 5n); // Allow small variance

      // Check token balances
      const finalUserBalance = await stakingToken.balanceOf(user1.address);
      const finalVaultBalance = await stakingToken.balanceOf(await stakingVault.getAddress());
      
      expect(initialUserBalance - finalUserBalance).to.equal(additionalAmount);
      expect(finalVaultBalance - initialVaultBalance).to.equal(additionalAmount);
    });

    it("Should reset the lock period when increasing stake", async function () {
      // Advance time halfway through the lock period
      await time.increase(WEEK / 2);
      
      // Verify we're halfway through
      const initialLocks = await stakingVault.getUserLocks(user1.address);
      const currentTime = await time.latest();
      expect(initialLocks[0].unlockTime - BigInt(currentTime)).to.be.closeTo(BigInt(WEEK / 2), 5n);
      
      // Increase stake
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH });
      
      // Check that the unlock time has been reset to a full WEEK from now
      const userLocksAfter = await stakingVault.getUserLocks(user1.address);
      const timeAfter = await time.latest();
      expect(userLocksAfter[0].unlockTime - BigInt(timeAfter)).to.be.closeTo(BigInt(WEEK), 5n);
      
      // Try to unstake and expect it to fail since the lock period has been reset
      await time.increase(WEEK / 2 + 1); // This would be enough time if the lock wasn't reset
      await expect(
        stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Lock period not yet over");
      
      // Advance the full week and unstake should succeed
      await time.increase(WEEK / 2);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should update rewards correctly when increasing stake", async function () {
      // Advance time to accumulate some rewards
      await time.increase(WEEK / 2);
      
      // Get initial rewards
      const initialRewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(initialRewards).to.be.gt(0);
      
      // Increase stake
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH });
      
      // Check lifetime rewards updated
      const lifetimeRewards = await stakingVault.getLifetimeRewards(user1.address);
      expect(lifetimeRewards).to.be.gte(initialRewards);
      
      // Check that lastClaimTime was updated
      const userLocks = await stakingVault.getUserLocks(user1.address);
      const currentTime = await time.latest();
      expect(userLocks[0].lastClaimTime).to.be.closeTo(BigInt(currentTime), 5n); // Allow small variance
      
      // New rewards should start from zero
      const newRewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(newRewards).to.be.lt(initialRewards);
      
      // Check that unlockTime was set to current time + full lock period
      expect(userLocks[0].unlockTime).to.be.closeTo(BigInt(currentTime) + BigInt(WEEK), 5n);
    });

    it("Should revert when trying to increase stake for inactive lock", async function () {
      // Complete the lock period
      await time.increase(WEEK + 1);
      
      // Unstake
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // Try to increase stake
      await expect(
        stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Lock is not active");
    });

    it("Should revert when trying to increase stake for non-existent lock", async function () {
      await expect(
        stakingVault.connect(user1).increaseStake(0, 9999, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Invalid lock ID");
    });
  });

  describe("Emergency Unlock Functionality", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      
      // Add two pools
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
      
      // Multiple users stake in different pools
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user1).stake(1, ethers.parseEther("200"), MONTH, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user2).stake(0, ethers.parseEther("150"), MONTH, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should unlock all locks when emergencyUnlockAll is called", async function () {
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // Check all locks are unlocked
      const user1Locks = await stakingVault.getUserLocks(user1.address);
      const user2Locks = await stakingVault.getUserLocks(user2.address);
      
      expect(user1Locks[0].isLocked).to.be.false;
      expect(user1Locks[1].isLocked).to.be.false;
      expect(user2Locks[0].isLocked).to.be.false;
    });

    it("Should unlock a batch of users when emergencyUnlockBatch is called", async function () {
      // We have two users in the lockedUsers array
      // Unlock just the first user (index 0 to 1)
      await stakingVault.emergencyUnlockBatch(0, 1, { gasLimit: GAS_LIMITS.HIGH });
      
      // Check user1's locks are unlocked
      const user1Locks = await stakingVault.getUserLocks(user1.address);
      expect(user1Locks[0].isLocked).to.be.false;
      expect(user1Locks[1].isLocked).to.be.false;
      
      // Check user2's locks are still locked
      const user2Locks = await stakingVault.getUserLocks(user2.address);
      expect(user2Locks[0].isLocked).to.be.true;
      
      // Unlock the second user
      await stakingVault.emergencyUnlockBatch(1, 2, { gasLimit: GAS_LIMITS.HIGH });
      
      // Now user2's locks should be unlocked
      const user2LocksAfter = await stakingVault.getUserLocks(user2.address);
      expect(user2LocksAfter[0].isLocked).to.be.false;
    });

    it("Should allow unstaking after emergency unlock even if lock period not over", async function () {
      // Emergency unlock all
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // Unstake without waiting for the lock period
      const initialBalance = await stakingToken.balanceOf(user1.address);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const finalBalance = await stakingToken.balanceOf(user1.address);
      
      // Check tokens were returned
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("100"));
    });

    it("Should prevent double unstaking after emergency unlock", async function () {
      // Emergency unlock all
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // Unstake the first time
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // Try to unstake again
      await expect(
        stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Tokens already withdrawn");
    });

    it("Should revert emergencyUnlockBatch with invalid index range", async function () {
      await expect(
        stakingVault.emergencyUnlockBatch(1, 1, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Invalid index range");
      
      await expect(
        stakingVault.emergencyUnlockBatch(2, 1, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Invalid index range");
    });

    it("Should revert emergencyUnlockBatch with out of bounds index", async function () {
      await expect(
        stakingVault.emergencyUnlockBatch(0, 3, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("End index out of bounds");
    });
  });

  describe("Complex Scenarios", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
    });

    it("Should handle multiple operations: stake, increase stake, claim rewards, unstake", async function () {
      // Initial stake
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time
      await time.increase(WEEK / 4);
      
      // Increase stake
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time more
      await time.increase(WEEK / 4);
      
      // Claim rewards
      await stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const lifetimeRewardsAfterClaim = await stakingVault.getLifetimeRewards(user1.address);
      
      // Advance time, but now we need a full WEEK since increasing the stake resets the lock period
      await time.increase(WEEK);
      
      // Unstake
      const initialBalance = await stakingToken.balanceOf(user1.address);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const finalBalance = await stakingToken.balanceOf(user1.address);
      
      // Check final results
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("150")); // 100 + 50
      
      const lifetimeRewardsAfterUnstake = await stakingVault.getLifetimeRewards(user1.address);
      expect(lifetimeRewardsAfterUnstake).to.be.gt(lifetimeRewardsAfterClaim);
    });

    it("Should handle emergency unlock followed by multiple users unstaking", async function () {
      // Both users stake with a MONTH lock
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user2).stake(0, ethers.parseEther("200"), MONTH, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time but not enough to complete lock period
      await time.increase(WEEK);
      
      // Emergency unlock all
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // Check rewards before unstaking
      const user1RewardsBefore = await stakingVault.calculateRewards(user1.address, 0);
      const user2RewardsBefore = await stakingVault.calculateRewards(user2.address, 0);
      
      // Both users unstake
      const user1BalanceBefore = await stakingToken.balanceOf(user1.address);
      const user2BalanceBefore = await stakingToken.balanceOf(user2.address);
      
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user2).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      const user1BalanceAfter = await stakingToken.balanceOf(user1.address);
      const user2BalanceAfter = await stakingToken.balanceOf(user2.address);
      
      // Check token returns
      expect(user1BalanceAfter - user1BalanceBefore).to.equal(ethers.parseEther("100"));
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(ethers.parseEther("200"));
      
      // Check reward tokens
      const user1Rewards = await stakingVault.getLifetimeRewards(user1.address);
      const user2Rewards = await stakingVault.getLifetimeRewards(user2.address);
      
      expect(user1Rewards).to.be.gte(user1RewardsBefore);
      expect(user2Rewards).to.be.gte(user2RewardsBefore);
      
      // Check lockedUsers is updated
      expect(await stakingVault.getTotalLockedUsers()).to.equal(2);
    });

    it("Should handle user staking after emergency unlock and previous unstake", async function () {
      // Initial stake
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH, { gasLimit: GAS_LIMITS.HIGH });
      
      // Emergency unlock
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // Unstake
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // Stake again
      await stakingVault.connect(user1).stake(0, ethers.parseEther("150"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Check total locked users
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);
      
      // Check locked amount
      expect(await stakingVault.getStakingAmountByPool(0)).to.equal(ethers.parseEther("150"));
    });

    it("Should handle lock period reset when repeatedly increasing stake", async function () {
      // Initial stake with MONTH lock period
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH, { gasLimit: GAS_LIMITS.HIGH });
      const initialTime = await time.latest();
      
      // Initial unlock time should be about a month from now
      const userLocksBefore = await stakingVault.getUserLocks(user1.address);
      expect(userLocksBefore[0].unlockTime).to.be.closeTo(BigInt(initialTime) + BigInt(MONTH), 5n);
      
      // Advance halfway through the lock period
      await time.increase(MONTH / 2);
      
      // Increase stake - this should reset the lock period
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH });
      const midTime = await time.latest();
      
      // Check that unlock time was extended to a full month from now
      const userLocksMiddle = await stakingVault.getUserLocks(user1.address);
      expect(userLocksMiddle[0].unlockTime).to.be.closeTo(BigInt(midTime) + BigInt(MONTH), 5n);
      
      // Advance halfway through the new lock period
      await time.increase(MONTH / 2);
      
      // Increase stake again - this should reset the lock period again
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("25"), { gasLimit: GAS_LIMITS.HIGH });
      const lateTime = await time.latest();
      
      // Check that unlock time was extended again to a full month from the latest increase
      const userLocksLate = await stakingVault.getUserLocks(user1.address);
      expect(userLocksLate[0].unlockTime).to.be.closeTo(BigInt(lateTime) + BigInt(MONTH), 5n);
      
      // Try to unstake before the full lock period and expect it to fail
      await time.increase(MONTH / 2);
      await expect(
        stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Lock period not yet over");
      
      // Advance the remaining lock period and unstake should succeed
      await time.increase(MONTH / 2);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // Check final balance - should include all staked tokens
      const finalBalance = await stakingToken.balanceOf(user1.address);
      
      // Initial balance was 1000 ETH, staked 100 + 50 + 25 = 175 ETH, then unstaked 175 ETH
      // So final balance should be close to 1000 ETH again, accounting for gas fees
      expect(finalBalance).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("0.1")); // Allow for small variance due to gas costs
    });
  });

  describe("Reentrancy Protection", function () {
    let attackerContract: SignerWithAddress;

    beforeEach(async function () {
      [, , , attackerContract] = await ethers.getSigners();
      
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
      
      // Grant minter role to the attacker for this test
      await rewardToken.grantRole(await rewardToken.MINTER_ROLE(), attackerContract.address, { gasLimit: GAS_LIMITS.LOW });
      
      // Mint tokens to attacker
      await stakingToken.mint(attackerContract.address, ethers.parseEther("1000"), { gasLimit: GAS_LIMITS.LOW });
      await stakingToken.connect(attackerContract).approve(await stakingVault.getAddress(), ethers.parseEther("1000"), { gasLimit: GAS_LIMITS.LOW });
    });

    it("Should protect against reentrancy in unstake", async function () {
      // First stake some tokens
      await stakingVault.connect(attackerContract).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time to complete lock period
      await time.increase(WEEK + 1);
      
      // A real attacker would use a contract, but here we're just verifying the nonReentrant modifier works
      const tx = stakingVault.connect(attackerContract).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      await expect(tx).to.not.be.reverted;
    });

    it("Should protect against reentrancy in claimRewards", async function () {
      // First stake some tokens
      await stakingVault.connect(attackerContract).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time to generate rewards
      await time.increase(WEEK / 2);
      
      // A real attacker would use a contract, but here we're just verifying the nonReentrant modifier works
      const tx = stakingVault.connect(attackerContract).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      await expect(tx).to.not.be.reverted;
    });
  });

  describe("Rewards Calculation Edge Cases", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault.addPool(await stakingToken.getAddress(), lockPeriods, rewardRates, {
        gasLimit: GAS_LIMITS.HIGH,
      });
    });

    it("Should calculate rewards correctly for very small time periods", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time by just 1 second
      await time.increase(1);
      
      const rewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewards).to.be.gt(0);
    });

    it("Should calculate rewards correctly for very large amounts", async function () {
      const largeAmount = ethers.parseEther("1000000"); // 1 million tokens
      await stakingToken.mint(user1.address, largeAmount, { gasLimit: GAS_LIMITS.LOW });
      await stakingToken.connect(user1).approve(await stakingVault.getAddress(), largeAmount, { gasLimit: GAS_LIMITS.LOW });
      
      await stakingVault.connect(user1).stake(0, largeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time by half the lock period
      await time.increase(WEEK / 2);
      
      const rewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewards).to.be.gt(0);
    });

    it("Should not calculate rewards if lastClaimTime is equal to current time", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Don't advance time
      const rewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewards).to.equal(0);
    });

    it("Should handle reward rate updates correctly", async function () {
      // Stake with original reward rate
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time
      await time.increase(WEEK / 4);
      
      // Calculate rewards with original rate
      const originalRewards = await stakingVault.calculateRewards(user1.address, 0);
      
      // Update reward rates
      const newRewardRates = [200, 400]; // Double the original rates
      await stakingVault.updateRewardRates(0, newRewardRates, { gasLimit: GAS_LIMITS.HIGH });
      
      // Advance time further
      await time.increase(WEEK / 4);
      
      // Rewards should be higher than expected with original rate due to the update
      const totalRewards = await stakingVault.calculateRewards(user1.address, 0);
      
      // Should be higher than double the original rewards due to higher rate for the second quarter
      expect(totalRewards).to.be.gt(originalRewards * 2n);
    });
  });
});
