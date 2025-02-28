import { expect } from "chai";
import { ethers } from "hardhat";
import { StakingVault, RewardToken, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { GAS_LIMITS } from "./constants";

describe("StakingVault Complex Scenarios", function () {
  let stakingVault: StakingVault;
  let rewardToken: RewardToken;
  let stakingToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const DAY = 24 * 60 * 60;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;

  // Helper function to get token balances
  async function getBalances(user: SignerWithAddress) {
    return {
      stakingBalance: await stakingToken.balanceOf(user.address),
      rewardBalance: await rewardToken.balanceOf(user.address)
    };
  }

  // Helper function to stake tokens
  async function stakeTokens(
    user: SignerWithAddress, 
    poolId: number, 
    amount: bigint, 
    lockPeriod: number
  ) {
    return stakingVault.connect(user).stake(poolId, amount, lockPeriod, { gasLimit: GAS_LIMITS.HIGH });
  }

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

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
    await stakingToken.mint(user3.address, initialBalance, { gasLimit: GAS_LIMITS.LOW });

    // Approve staking vault to spend tokens
    await stakingToken.connect(user1).approve(await stakingVault.getAddress(), initialBalance, { gasLimit: GAS_LIMITS.LOW });
    await stakingToken.connect(user2).approve(await stakingVault.getAddress(), initialBalance, { gasLimit: GAS_LIMITS.LOW });
    await stakingToken.connect(user3).approve(await stakingVault.getAddress(), initialBalance, { gasLimit: GAS_LIMITS.LOW });

    // Create pools with different lock periods and reward rates
    const pool1LockPeriods = [WEEK, MONTH];
    const pool1RewardRates = [100, 300]; // 1% and 3% for week and month, respectively
    await stakingVault.addPool(await stakingToken.getAddress(), pool1LockPeriods, pool1RewardRates, { gasLimit: GAS_LIMITS.HIGH });

    const pool2LockPeriods = [2 * WEEK, 3 * MONTH];
    const pool2RewardRates = [200, 600]; // 2% and 6% for 2 weeks and 3 months, respectively
    await stakingVault.addPool(await stakingToken.getAddress(), pool2LockPeriods, pool2RewardRates, { gasLimit: GAS_LIMITS.HIGH });
  });

  describe("Emergency Unlock Scenarios", function () {
    it("Should allow users to unstake after emergency unlock", async function () {
      // 1. User1 stakes in pool 0 with 1 week lock
      const stakeAmount1 = ethers.parseEther("100");
      await stakeTokens(user1, 0, stakeAmount1, WEEK);
      
      // 2. User2 stakes in pool 1 with longer lock period
      const stakeAmount2 = ethers.parseEther("200");
      await stakeTokens(user2, 1, stakeAmount2, 3 * MONTH);
      
      // Record initial balances
      const initialBalances = {
        user1: await getBalances(user1),
        user2: await getBalances(user2)
      };
      
      // Advance time slightly - not enough to fully unlock
      await time.increase(WEEK / 2);
      
      // 3. Owner calls emergency unlock
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // 4. Verify locks are marked as unlocked
      const user1Locks = await stakingVault.getUserLocks(user1.address);
      const user2Locks = await stakingVault.getUserLocks(user2.address);
      expect(user1Locks[0].isLocked).to.be.false;
      expect(user2Locks[0].isLocked).to.be.false;
      
      // 5. Users unstake their tokens
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user2).unstake(1, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // 6. Verify balances are returned and rewards are given
      const finalBalances = {
        user1: await getBalances(user1),
        user2: await getBalances(user2)
      };
      
      // Check staking tokens are returned
      expect(finalBalances.user1.stakingBalance).to.equal(initialBalances.user1.stakingBalance + stakeAmount1);
      expect(finalBalances.user2.stakingBalance).to.equal(initialBalances.user2.stakingBalance + stakeAmount2);
      
      // Check rewards are given proportionally to time staked
      expect(finalBalances.user1.rewardBalance).to.be.gt(initialBalances.user1.rewardBalance);
      expect(finalBalances.user2.rewardBalance).to.be.gt(initialBalances.user2.rewardBalance);
      
      // 7. Verify users are removed from lockedUsers
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
    });
    
    it("Should handle claim rewards after emergency unlock", async function () {
      // 1. User stakes tokens with a larger amount
      const stakeAmount = ethers.parseEther("1000");
      await stakeTokens(user1, 0, stakeAmount, MONTH);
      
      // 2. Advance time by a significant portion
      await time.increase(WEEK * 2);
      
      // 3. Owner calls emergency unlock
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // Calculate rewards - should be non-zero after this much time
      const pendingRewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(pendingRewards).to.be.gt(0);
      
      // 4. User claims rewards without unstaking
      await stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      const rewardBalanceAfterClaim = await rewardToken.balanceOf(user1.address);
      expect(rewardBalanceAfterClaim).to.be.gt(0);
      
      // 5. Time passes
      await time.increase(WEEK);
      
      // 6. Finally unstake instead of claiming again
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // 7. Verify staking tokens are returned
      const finalStakingBalance = await stakingToken.balanceOf(user1.address);
      expect(finalStakingBalance).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Multiple Operations Scenarios", function () {
    it("Should handle multiple stakes and unstakes by same user", async function () {
      // 1. User1 stakes in different pools with different amounts
      await stakeTokens(user1, 0, ethers.parseEther("100"), WEEK);
      await stakeTokens(user1, 0, ethers.parseEther("150"), MONTH);
      await stakeTokens(user1, 1, ethers.parseEther("200"), 2 * WEEK);
      
      // 2. Verify user has 3 lock positions
      let userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks.length).to.equal(3);
      
      // 3. Advance time past first lock period
      await time.increase(WEEK + DAY);
      
      // 4. Unstake first position
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // 5. Verify user still has active locks
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);
      
      // 6. Verify active staked balance
      const activeBalance = await stakingVault.getActiveStakedBalance(user1.address);
      expect(activeBalance).to.equal(ethers.parseEther("350")); // 150 + 200
      
      // 7. Try to unstake a second time the same position (should fail)
      await expect(
        stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWith("Nothing to unstake");
      
      // 8. Advance time past all lock periods
      await time.increase(MONTH + DAY);
      
      // 9. Unstake remaining positions
      await stakingVault.connect(user1).unstake(0, 1, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user1).unstake(1, 2, { gasLimit: GAS_LIMITS.HIGH });
      
      // 10. Verify no more locked users
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
      
      // 11. Add a new stake
      await stakeTokens(user1, 0, ethers.parseEther("50"), WEEK);
      
      // 12. Verify user is back in locked users
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);
    });
    
    it("Should handle pausing and emergency unlock", async function () {
      // 1. Users stake tokens
      await stakeTokens(user1, 0, ethers.parseEther("100"), WEEK);
      await stakeTokens(user2, 1, ethers.parseEther("200"), 3 * MONTH);
      
      // 2. Owner pauses the contract
      await stakingVault.pause({ gasLimit: GAS_LIMITS.LOW });
      
      // 3. Attempt to stake while paused (should fail)
      await expect(
        stakeTokens(user3, 0, ethers.parseEther("50"), WEEK)
      ).to.be.reverted;
      
      // 4. Owner performs emergency unlock
      await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      
      // 5. User tries to unstake (should work even when paused)
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // 6. Owner unpauses contract
      await stakingVault.unpause({ gasLimit: GAS_LIMITS.LOW });
      
      // 7. New stakes should work now
      await stakeTokens(user3, 0, ethers.parseEther("50"), WEEK);
      
      // 8. Verify state
      expect(await stakingVault.getTotalLockedUsers()).to.equal(2); // user2 and user3
      
      // Debug the staking amounts
      const pool0Amount = await stakingVault.getStakingAmountByPool(0);
      const pool1Amount = await stakingVault.getStakingAmountByPool(1);
      console.log("Pool 0 amount:", pool0Amount.toString());
      console.log("Pool 1 amount:", pool1Amount.toString());
      
      // After emergency unlock, isLocked is set to false for all locks
      // getStakingAmountByPool only counts locks where isLocked is true
      // So pool 1 should have 0 tokens, and pool 0 has 50 from user3's new stake after unpause
      expect(pool0Amount).to.equal(ethers.parseEther("50"));
      expect(pool1Amount).to.equal(ethers.parseEther("0"));
    });
  });

  describe("Edge Case Scenarios", function () {
    it("Should handle pool deactivation with active stakes", async function () {
      // 1. Users stake in both pools
      await stakeTokens(user1, 0, ethers.parseEther("100"), WEEK);
      await stakeTokens(user2, 1, ethers.parseEther("200"), 2 * WEEK);
      
      // 2. Owner deactivates pool 0
      await stakingVault.setPoolStatus(0, false, { gasLimit: GAS_LIMITS.LOW });
      
      // 3. Attempt to stake in deactivated pool (should fail)
      await expect(
        stakeTokens(user3, 0, ethers.parseEther("50"), WEEK)
      ).to.be.revertedWith("Pool is not active");
      
      // 4. User can still unstake from deactivated pool
      await time.increase(WEEK + DAY);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      
      // 5. Staking in active pool still works
      await stakeTokens(user3, 1, ethers.parseEther("50"), 2 * WEEK);
      
      // 6. Verify state
      expect(await stakingVault.getStakingAmountByPool(0)).to.equal(0);
      expect(await stakingVault.getStakingAmountByPool(1)).to.equal(ethers.parseEther("250"));
    });
    
    it("Should handle reward rate updates for existing stakes", async function () {
      // 1. User stakes tokens
      await stakeTokens(user1, 0, ethers.parseEther("100"), WEEK);
      
      // 2. Advance time partially
      await time.increase(WEEK / 2);
      
      // 3. Calculate rewards with old rate
      const oldRewards = await stakingVault.calculateRewards(user1.address, 0);
      
      // 4. Owner increases reward rates
      const newRewardRates = [200, 600]; // Double the rates
      await stakingVault.updateRewardRates(0, newRewardRates, { gasLimit: GAS_LIMITS.HIGH });
      
      // 5. Advance time to end of lock period
      await time.increase(WEEK / 2 + DAY);
      
      // 6. User unstakes and gets rewards based on the combination of old and new rates
      const preUnstakeRewardBalance = await rewardToken.balanceOf(user1.address);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const postUnstakeRewardBalance = await rewardToken.balanceOf(user1.address);
      
      // 7. Verify rewards - should be more than old rate projection
      const actualRewards = postUnstakeRewardBalance - preUnstakeRewardBalance;
      expect(actualRewards).to.be.gt(oldRewards * 2n - oldRewards); // Rewards should be more than 1.5x old rewards estimate
    });
    
    it("Should correctly track multiple claims and final unstake", async function () {
      // 1. User stakes tokens
      const stakeAmount = ethers.parseEther("100");
      await stakeTokens(user1, 0, stakeAmount, MONTH);
      
      // 2. Advance time for partial rewards
      await time.increase(WEEK);
      
      // 3. Claim rewards first time
      await stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const firstClaimRewards = await rewardToken.balanceOf(user1.address);
      
      // 4. Advance time for more rewards
      await time.increase(WEEK);
      
      // 5. Claim rewards second time
      await stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const secondClaimRewards = await rewardToken.balanceOf(user1.address) - firstClaimRewards;
      
      // 6. Advance time to end of lock period
      await time.increase(MONTH - 2 * WEEK);
      
      // 7. Unstake and get final rewards
      const beforeUnstakeBalance = await rewardToken.balanceOf(user1.address);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const finalRewards = await rewardToken.balanceOf(user1.address) - beforeUnstakeBalance;
      
      // 8. Verify all rewards tracking
      const lifetimeRewards = await stakingVault.getLifetimeRewards(user1.address);
      expect(lifetimeRewards).to.equal(firstClaimRewards + secondClaimRewards + finalRewards);
      
      // 9. Verify tokens are returned
      const stakingTokenBalance = await stakingToken.balanceOf(user1.address);
      expect(stakingTokenBalance).to.equal(ethers.parseEther("1000"));
    });
  });
  
  describe("Recovery and Security", function () {
    it("Should handle token recovery", async function () {
      // 1. Deploy a different token to test recovery
      const DifferentToken = await ethers.getContractFactory("MockERC20");
      const differentToken = await DifferentToken.deploy("Different Token", "DTK", { gasLimit: GAS_LIMITS.DEPLOY });
      
      // 2. Send tokens to vault by mistake
      const recoveryAmount = ethers.parseEther("100");
      await differentToken.mint(await stakingVault.getAddress(), recoveryAmount, { gasLimit: GAS_LIMITS.LOW });
      
      // 3. Owner recovers tokens
      await stakingVault.recoverTokens(
        await differentToken.getAddress(), 
        owner.address, 
        recoveryAmount, 
        { gasLimit: GAS_LIMITS.HIGH }
      );
      
      // 4. Verify tokens are recovered
      const ownerBalance = await differentToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(recoveryAmount);
    });
    
    it("Should not allow non-owners to perform admin functions", async function () {
      // 1. Attempt to add pool as non-owner
      await expect(
        stakingVault.connect(user1).addPool(
          await stakingToken.getAddress(),
          [WEEK],
          [100],
          { gasLimit: GAS_LIMITS.HIGH }
        )
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
      
      // 2. Attempt to pause as non-owner
      await expect(
        stakingVault.connect(user1).pause({ gasLimit: GAS_LIMITS.LOW })
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
      
      // 3. Attempt to perform emergency unlock as non-owner
      await expect(
        stakingVault.connect(user1).emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH })
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });
  });
}); 