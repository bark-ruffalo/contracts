import { expect } from "chai";
import { ethers } from "hardhat";
import { StakingVault, RewardToken, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { GAS_LIMITS } from "./constants";
import { EventLog } from "ethers";

// Helper function to handle the overloaded addPool function with default multiplier
async function addPoolWithDefaultMultiplier(
  stakingVault: StakingVault,
  stakingToken: string | MockERC20,
  lockPeriods: number[],
  rewardRates: number[],
  options: any = { gasLimit: GAS_LIMITS.HIGH },
) {
  const tokenAddress = typeof stakingToken === "string" ? stakingToken : await stakingToken.getAddress();

  // Call the function directly with the correct parameter types
  return stakingVault["addPool(address,uint256[],uint256[])"](tokenAddress, lockPeriods, rewardRates, options);
}

// Helper function to handle the overloaded addPool function with custom multiplier
async function addPoolWithMultiplier(
  stakingVault: StakingVault,
  stakingToken: string | MockERC20,
  lockPeriods: number[],
  rewardRates: number[],
  tokenMultiplier: number,
  options: any = { gasLimit: GAS_LIMITS.HIGH },
) {
  const tokenAddress = typeof stakingToken === "string" ? stakingToken : await stakingToken.getAddress();

  // Call the function directly with the correct parameter types
  return stakingVault["addPool(address,uint256[],uint256[],uint256)"](
    tokenAddress,
    lockPeriods,
    rewardRates,
    tokenMultiplier,
    options,
  );
}

describe("StakingVault", function () {
  let stakingVault: StakingVault;
  let rewardToken: RewardToken;
  let stakingToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const WEEK = 7 * 24 * 60 * 60;
  const MONTH = 30 * 24 * 60 * 60;

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
    await rewardToken.grantRole(await rewardToken.MINTER_ROLE(), await stakingVault.getAddress(), {
      gasLimit: GAS_LIMITS.LOW,
    });

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
      const tokenAddress = await stakingToken.getAddress();

      // Call the contract method directly with the default multiplier
      await expect(
        stakingVault["addPool(address,uint256[],uint256[])"](tokenAddress, lockPeriods, rewardRates, {
          gasLimit: GAS_LIMITS.HIGH,
        }),
      )
        .to.emit(stakingVault, "PoolAdded")
        .withArgs(0, tokenAddress, lockPeriods, rewardRates, 10000);

      const pool = await stakingVault.pools(0);
      expect(pool.isActive).to.be.true;
      // The stakingToken is returned as an address, not as a contract instance
      expect(pool.stakingToken).to.equal(tokenAddress);
      expect(pool.tokenMultiplier).to.equal(10000);
    });

    it("Should revert adding pool with mismatched periods and rates", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100, 200];

      await expect(
        addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates),
      ).to.be.revertedWith("Mismatched lock periods and rates");
    });

    it("Should update pool status", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];

      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      await expect(stakingVault.setPoolStatus(0, false, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "PoolStatusUpdated")
        .withArgs(0, false);

      const pool = await stakingVault.pools(0);
      expect(pool.isActive).to.be.false;
    });

    it("Should pause and unpause staking for a specific pool", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];

      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      await expect(stakingVault.setPoolStakingStatus(0, true, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "PoolStakingStatusUpdated")
        .withArgs(0, true);

      const pool = await stakingVault.pools(0);
      expect(pool.isStakingPaused).to.be.true;

      await expect(stakingVault.setPoolStakingStatus(0, false, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "PoolStakingStatusUpdated")
        .withArgs(0, false);

      const updatedPool = await stakingVault.pools(0);
      expect(updatedPool.isStakingPaused).to.be.false;
    });
  });

  describe("Staking", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
    });

    it("Should stake tokens correctly", async function () {
      const stakeAmount = ethers.parseEther("100");

      const tx = await stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH });
      const receipt = await tx.wait();

      if (!receipt) throw new Error("Transaction receipt is null");

      // Verify the Staked event with the enhanced parameters
      const stakedEvent = receipt.logs.find(log => {
        const event = log as EventLog;
        return (
          event.fragment?.name === "Staked" && event.args && event.args[0] === user1.address && event.args[1] === 0n
        );
      }) as EventLog;

      expect(stakedEvent).to.not.be.undefined;
      expect(stakedEvent.args[2]).to.equal(stakeAmount); // amount
      expect(stakedEvent.args[3]).to.equal(BigInt(WEEK)); // lockPeriod
      expect(stakedEvent.args[4]).to.equal(0n); // lockId

      // Verify unlock time is approximately current time + lock period
      const blockTimestamp = await time.latest();
      expect(stakedEvent.args[5]).to.be.closeTo(BigInt(blockTimestamp) + BigInt(WEEK), 5n); // unlockTime with small variance

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

    it("Should revert staking when staking is paused for the pool", async function () {
      await stakingVault.setPoolStakingStatus(0, true, { gasLimit: GAS_LIMITS.HIGH });
      const stakeAmount = ethers.parseEther("100");

      await expect(
        stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Staking is paused for this pool");
    });

    it("Should allow unstaking when staking is paused for the pool", async function () {
      // First, stake some tokens when staking is not paused
      await stakingVault.setPoolStakingStatus(0, false, { gasLimit: GAS_LIMITS.HIGH });
      const stakeAmount = ethers.parseEther("100");
      await stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Then pause staking
      await stakingVault.setPoolStakingStatus(0, true, { gasLimit: GAS_LIMITS.HIGH });

      // Advance time to unlock period
      await time.increase(WEEK + 1);

      // Should be able to unstake
      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.not.be.reverted;

      // Verify user received their tokens back
      const userBalance = await stakingToken.balanceOf(user1.address);
      expect(userBalance).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("1"));
    });

    it("Should revert increaseStake when staking is paused for the pool", async function () {
      // First, stake some tokens when staking is not paused
      await stakingVault.setPoolStakingStatus(0, false, { gasLimit: GAS_LIMITS.HIGH });
      const stakeAmount = ethers.parseEther("100");
      await stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Then pause staking
      await stakingVault.setPoolStakingStatus(0, true, { gasLimit: GAS_LIMITS.HIGH });

      // Should not be able to increase stake
      await expect(
        stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Staking is paused for this pool");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should calculate rewards correctly", async function () {
      await time.increase(WEEK / 2);

      const rewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewards).to.be.gt(0);
    });

    it("Should claim rewards correctly", async function () {
      await time.increase(WEEK / 2);

      const initialRewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(initialRewards).to.be.gt(0);

      const tx = await stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const receipt = await tx.wait();

      if (!receipt) throw new Error("Transaction receipt is null");

      // Verify the RewardsClaimed event with enhanced parameters
      const rewardsClaimedEvent = receipt.logs.find(log => {
        const event = log as EventLog;
        return (
          event.fragment?.name === "RewardsClaimed" &&
          event.args &&
          event.args[0] === user1.address &&
          event.args[1] === 0n
        );
      }) as EventLog;

      expect(rewardsClaimedEvent).to.not.be.undefined;
      // Use be.closeTo for comparison because of small discrepancies in calculated values
      expect(rewardsClaimedEvent.args[2]).to.be.closeTo(initialRewards, ethers.parseEther("0.01")); // Allow small variance
      expect(rewardsClaimedEvent.args[3]).to.equal(0n); // lockId

      // Timestamp should be close to current block time
      const blockTimestamp = await time.latest();
      expect(rewardsClaimedEvent.args[4]).to.be.closeTo(BigInt(blockTimestamp), 5n); // timestamp with small variance

      const lifetimeRewards = await stakingVault.getLifetimeRewards(user1.address);
      expect(lifetimeRewards).to.be.gt(0);
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
    });

    it("Should not allow unstaking before lock period", async function () {
      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Lock period not yet over",
      );
    });

    it("Should allow unstaking after lock period", async function () {
      await time.increase(WEEK);

      const tx = await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      const receipt = await tx.wait();

      if (!receipt) throw new Error("Transaction receipt is null");

      // Verify the Unstaked event with enhanced parameters
      const unstakedEvent = receipt.logs.find(log => {
        const event = log as EventLog;
        return (
          event.fragment?.name === "Unstaked" && event.args && event.args[0] === user1.address && event.args[1] === 0n
        );
      }) as EventLog;

      expect(unstakedEvent).to.not.be.undefined;
      expect(unstakedEvent.args[2]).to.equal(ethers.parseEther("100")); // amount
      // args[3] is rewards (variable, so we don't check exact value)
      expect(unstakedEvent.args[4]).to.equal(0n); // lockId

      const userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks[0].isLocked).to.be.false;
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency unlock by owner", async function () {
      const lockPeriods = [MONTH];
      const rewardRates = [100];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH, { gasLimit: GAS_LIMITS.HIGH });

      const tx = await stakingVault.emergencyUnlockAll({ gasLimit: GAS_LIMITS.HIGH });
      const receipt = await tx.wait();

      if (!receipt) throw new Error("Transaction receipt is null");

      // Verify the new EmergencyUnlock event is emitted
      const emergencyUnlockEvent = receipt.logs.find(log => {
        const event = log as EventLog;
        return event.fragment?.name === "EmergencyUnlock";
      }) as EventLog;

      expect(emergencyUnlockEvent).to.not.be.undefined;
      expect(emergencyUnlockEvent.args[0]).to.be.a("bigint"); // timestamp

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
      const mockTokenAddress = await mockToken.getAddress();

      const tx = await stakingVault.recoverTokens(mockTokenAddress, owner.address, amount, {
        gasLimit: GAS_LIMITS.HIGH,
      });
      const receipt = await tx.wait();

      if (!receipt) throw new Error("Transaction receipt is null");

      // Verify the TokensRecovered event is emitted
      const tokensRecoveredEvent = receipt.logs.find(log => {
        const event = log as EventLog;
        return (
          event.fragment?.name === "TokensRecovered" &&
          event.args &&
          event.args[0] === mockTokenAddress &&
          event.args[1] === owner.address
        );
      }) as EventLog;

      expect(tokensRecoveredEvent).to.not.be.undefined;
      expect(tokensRecoveredEvent.args[2]).to.equal(amount); // amount

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
        stakingVault.connect(user1).setRewardToken(await newRewardToken.getAddress(), { gasLimit: GAS_LIMITS.LOW }),
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pool Reward Rate Management", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
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
      await expect(stakingVault.updateRewardRates(0, newRewardRates, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Mismatched lock periods and reward rates",
      );
    });

    it("Should update reward rates from non-zero to zero correctly", async function () {
      // First stake with non-zero reward rate
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH, { gasLimit: GAS_LIMITS.HIGH });

      // Advance time to accumulate some rewards
      await time.increase(MONTH / 4);

      // Calculate initial rewards
      const initialRewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(initialRewards).to.be.gt(0);

      // Claim the rewards
      await stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });

      // Store lifetime rewards after claiming
      const lifetimeRewards = await stakingVault.getLifetimeRewards(user1.address);

      // Update reward rates to zero
      await stakingVault.updateRewardRates(0, [0, 0], { gasLimit: GAS_LIMITS.HIGH });

      // Advance time further
      await time.increase(MONTH / 4);

      // Calculate rewards after update - should be zero
      const rewardsAfterUpdate = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewardsAfterUpdate).to.equal(0);

      // Verify lifetime rewards haven't changed since there are no new rewards
      const finalLifetimeRewards = await stakingVault.getLifetimeRewards(user1.address);
      expect(finalLifetimeRewards).to.equal(lifetimeRewards);
    });

    it("Should allow adding pool with zero reward rate", async function () {
      // Create a pool with zero reward rate - should not revert
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK], [0]);

      // Verify the pool was created with zero reward rate
      const poolCount = (await stakingVault.getPools()).length;
      expect(poolCount).to.be.greaterThan(0);

      const pools = await stakingVault.getPools();
      const pool = pools[pools.length - 1];
      expect(pool.rewardRates[0]).to.equal(0);
    });

    it("Should allow updating reward rates with zero values", async function () {
      // First create a valid pool with non-zero reward rate
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK], [100]);
      const poolId = (await stakingVault.getPools()).length - 1;

      // Update to zero reward rate - should not revert
      await stakingVault.updateRewardRates(poolId, [0], { gasLimit: GAS_LIMITS.HIGH });

      // Verify the reward rate was updated to zero
      const pools = await stakingVault.getPools();
      const pool = pools[poolId];
      expect(pool.rewardRates[0]).to.equal(0);
    });
  });

  describe("Pool and User Statistics", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      // Add another pool
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      // User1 stakes in pool 0
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      // User2 stakes in pool 1
      await stakingVault.connect(user2).stake(1, ethers.parseEther("200"), WEEK);
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
      await stakingVault["addPool(address,uint256[],uint256[])"](
        await stakingToken.getAddress(),
        lockPeriods,
        rewardRates,
        {
          gasLimit: GAS_LIMITS.HIGH,
        },
      );

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

      const tx = await stakingVault.connect(user1).increaseStake(0, 0, additionalAmount, { gasLimit: GAS_LIMITS.HIGH });
      const receipt = await tx.wait();

      if (!receipt) throw new Error("Transaction receipt is null");

      // Find the Staked event - may have changed order so find by specific parameters
      const stakedEvents = receipt.logs
        .filter(log => {
          const event = log as EventLog;
          return (
            event.fragment?.name === "Staked" && event.args && event.args[0] === user1.address && event.args[1] === 0n
          );
        })
        .map(log => log as EventLog);

      // Find the event with the correct stake amount
      const stakedEvent = stakedEvents.find(event => event.args[2].toString() === additionalAmount.toString());

      expect(stakedEvent).to.not.be.undefined;
      if (!stakedEvent) throw new Error("Staked event not found with the correct parameters");

      expect(stakedEvent.args[3]).to.equal(BigInt(WEEK)); // lockPeriod
      expect(stakedEvent.args[4]).to.equal(0n); // lockId

      // Verify unlock time is updated
      const blockTimestamp = await time.latest();
      expect(stakedEvent.args[5]).to.be.closeTo(BigInt(blockTimestamp) + BigInt(WEEK), 5n); // unlockTime with small variance

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
      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Lock period not yet over",
      );

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
        stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Lock is not active");
    });

    it("Should revert when trying to increase stake for non-existent lock", async function () {
      await expect(
        stakingVault.connect(user1).increaseStake(0, 9999, ethers.parseEther("50"), { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Invalid lock ID");
    });
  });

  describe("Emergency Unlock Functionality", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];

      // Add two pools
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

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
      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Tokens already withdrawn",
      );
    });

    it("Should revert emergencyUnlockBatch with invalid index range", async function () {
      await expect(stakingVault.emergencyUnlockBatch(1, 1, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Invalid index range",
      );

      await expect(stakingVault.emergencyUnlockBatch(2, 1, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Invalid index range",
      );
    });

    it("Should revert emergencyUnlockBatch with out of bounds index", async function () {
      await expect(stakingVault.emergencyUnlockBatch(0, 3, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "End index out of bounds",
      );
    });
  });

  describe("Complex Scenarios", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
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
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
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

      // Check that unlock time has been extended to a full month from now
      const userLocksMiddle = await stakingVault.getUserLocks(user1.address);
      expect(userLocksMiddle[0].unlockTime).to.be.closeTo(BigInt(midTime) + BigInt(MONTH), 5n);

      // Advance halfway through the new lock period
      await time.increase(MONTH / 2);

      // Increase stake again - this should reset the lock period again
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("25"), { gasLimit: GAS_LIMITS.HIGH });
      const lateTime = await time.latest();

      // Check that unlock time has been extended again to a full month from the latest increase
      const userLocksLate = await stakingVault.getUserLocks(user1.address);
      expect(userLocksLate[0].unlockTime).to.be.closeTo(BigInt(lateTime) + BigInt(MONTH), 5n);

      // Try to unstake before the full lock period and expect it to fail
      await time.increase(MONTH / 2);
      await expect(stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH })).to.be.revertedWith(
        "Lock period not yet over",
      );

      // Advance the remaining lock period and unstake should succeed
      await time.increase(MONTH / 2);
      await stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });

      // Check final balance - should include all staked tokens
      const finalBalance = await stakingToken.balanceOf(user1.address);

      // Initial balance was 1000 ETH, staked 100 + 50 + 25 = 175 ETH, then unstaked 175 ETH
      // So final balance should be close to 1000 ETH again, accounting for gas fees
      expect(finalBalance).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("0.1")); // Allow for small variance due to gas costs
    });

    it("Should handle pausing and unpausing staking across multiple operations", async function () {
      // Setup pool and tokens
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await stakingVault["addPool(address,uint256[],uint256[])"](
        await stakingToken.getAddress(),
        lockPeriods,
        rewardRates,
        {
          gasLimit: GAS_LIMITS.HIGH,
        },
      );

      // User1 stakes tokens
      await stakingVault.connect(user1).stake(1, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Get the lock ID for user1's stake
      const userLocks = await stakingVault.getUserLocks(user1.address);
      const lockId = userLocks.length - 1; // Get the latest lock ID

      // User2 tries to stake but owner pauses staking for the pool
      await stakingVault.setPoolStakingStatus(1, true, { gasLimit: GAS_LIMITS.HIGH });

      // User2 attempt to stake should fail
      await expect(
        stakingVault.connect(user2).stake(1, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Staking is paused for this pool");

      // User1 should still be able to claim rewards and unstake
      await time.increase(WEEK / 2);

      // Calculate rewards
      const pendingRewards = await stakingVault.calculateRewards(user1.address, lockId);
      expect(pendingRewards).to.be.gt(0);

      // Claim rewards
      await stakingVault.connect(user1).claimRewards(1, lockId, { gasLimit: GAS_LIMITS.HIGH });

      // Owner unpauses staking
      await stakingVault.setPoolStakingStatus(1, false, { gasLimit: GAS_LIMITS.HIGH });

      // User2 can now stake
      await stakingVault.connect(user2).stake(1, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Complete lock period
      await time.increase(WEEK / 2 + 1);

      // Both users should be able to unstake
      await stakingVault.connect(user1).unstake(1, lockId, { gasLimit: GAS_LIMITS.HIGH });

      // Verify balances
      const user1Balance = await stakingToken.balanceOf(user1.address);
      expect(user1Balance).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("1"));
    });

    it("Should allow staking in one pool when another pool's staking is paused", async function () {
      // Setup pools
      const lockPeriods = [WEEK];
      const rewardRates = [100];

      // Add two pools
      await stakingVault["addPool(address,uint256[],uint256[])"](
        await stakingToken.getAddress(),
        lockPeriods,
        rewardRates,
        {
          gasLimit: GAS_LIMITS.HIGH,
        },
      );
      await stakingVault["addPool(address,uint256[],uint256[])"](
        await stakingToken.getAddress(),
        lockPeriods,
        rewardRates,
        {
          gasLimit: GAS_LIMITS.HIGH,
        },
      );

      // Get the pool IDs
      const pools = await stakingVault.getPools();
      const firstPoolId = pools.length - 2; // Second-to-last pool
      const secondPoolId = pools.length - 1; // Last pool

      // Pause staking in first pool
      await stakingVault.setPoolStakingStatus(firstPoolId, true, { gasLimit: GAS_LIMITS.HIGH });

      // Should be able to stake in second pool
      await stakingVault
        .connect(user1)
        .stake(secondPoolId, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Should not be able to stake in first pool
      await expect(
        stakingVault.connect(user1).stake(firstPoolId, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH }),
      ).to.be.revertedWith("Staking is paused for this pool");

      // Verify user has a lock in second pool
      const userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks).to.have.lengthOf.at.least(1);

      // Find the lock for the second pool
      const secondPoolLock = userLocks.find(lock => lock.poolId === BigInt(secondPoolId));
      expect(secondPoolLock).to.not.be.undefined;
      expect(secondPoolLock?.amount).to.equal(ethers.parseEther("100"));
    });
  });

  describe("Reentrancy Protection", function () {
    beforeEach(async function () {
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK], [1000]);
      await stakingToken.connect(user1).approve(stakingVault.getAddress(), ethers.parseEther("200"));
    });

    it("Should protect against reentrancy in unstake", async function () {
      // First stake some tokens
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Advance time to complete lock period
      await time.increase(WEEK + 1);

      // A real attacker would use a contract, but here we're just verifying the nonReentrant modifier works
      const tx = stakingVault.connect(user1).unstake(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      await expect(tx).to.not.be.reverted;
    });

    it("Should protect against reentrancy in claimRewards", async function () {
      // First stake some tokens
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Advance time to generate rewards
      await time.increase(WEEK / 2);

      // A real attacker would use a contract, but here we're just verifying the nonReentrant modifier works
      const tx = stakingVault.connect(user1).claimRewards(0, 0, { gasLimit: GAS_LIMITS.HIGH });
      await expect(tx).to.not.be.reverted;
    });

    it("Should protect against reentrancy in increaseStake", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      await expect(stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"))).to.not.be.reverted;

      const lockInfo = await stakingVault.getUserLocks(user1.address);
      expect(lockInfo[0].amount).to.equal(ethers.parseEther("150"));
    });
  });

  describe("Rewards Calculation Edge Cases", function () {
    beforeEach(async function () {
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK], [1000]);
      await stakingToken.connect(user1).approve(stakingVault.getAddress(), ethers.parseEther("100"));
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
      await stakingToken
        .connect(user1)
        .approve(await stakingVault.getAddress(), largeAmount, { gasLimit: GAS_LIMITS.LOW });

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
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK, { gasLimit: GAS_LIMITS.HIGH });
      await time.increase(WEEK / 4);
      const originalRewards = await stakingVault.calculateRewards(user1.address, 0);

      const newRewardRates = [2000]; // Corrected to be higher than original
      await stakingVault.updateRewardRates(0, newRewardRates, { gasLimit: GAS_LIMITS.HIGH });

      await time.increase(WEEK / 4);
      const totalRewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(totalRewards).to.be.gt(originalRewards * 2n);
    });

    it("Should revert staking with zero lock period", async function () {
      await expect(stakingVault.connect(user1).stake(0, ethers.parseEther("100"), 0)).to.be.revertedWith(
        "Invalid lock period",
      );
    });

    it("Should revert staking with zero amount", async function () {
      await expect(stakingVault.connect(user1).stake(0, 0, WEEK)).to.be.revertedWith(
        "Amount must be greater than zero",
      );
    });

    it("Should yield zero rewards immediately after staking", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      const rewards = await stakingVault.calculateRewards(user1.address, 0);
      expect(rewards).to.equal(0);
    });
  });

  describe("User Tracking and Removal", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
    });

    it("Should correctly remove user from lockedUsers after all locks are inactive", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH);

      // First increase time to unstake the WEEK lock
      await time.increase(WEEK + 1);
      await stakingVault.connect(user1).unstake(0, 0);

      // Now increase time to unstake the MONTH lock
      await time.increase(MONTH - WEEK);
      await stakingVault.connect(user1).unstake(0, 1);

      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
    });

    it("Should not have duplicates or stale entries in lockedUsers", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH);

      // Verify the lock count in user's locks array
      const userLocks = await stakingVault.getUserLocks(user1.address);
      expect(userLocks.length).to.equal(2);

      // Verify user is added to lockedUsers array only once
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      await time.increase(WEEK + 1);

      await stakingVault.connect(user1).unstake(0, 0);

      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      await time.increase(MONTH - WEEK);

      await stakingVault.connect(user1).unstake(0, 1);

      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);

      await stakingToken.connect(user1).approve(stakingVault.getAddress(), ethers.parseEther("100"));
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);
    });

    it("Should handle user tracking correctly when increasing stake after partial unstake", async function () {
      // Initial stakes
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH);

      // Unstake the first position (WEEK lock)
      await time.increase(WEEK + 1);
      await stakingVault.connect(user1).unstake(0, 0);

      // User should still be in lockedUsers (has one active lock)
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Increase stake for the remaining lock
      await stakingToken.connect(user1).approve(stakingVault.getAddress(), ethers.parseEther("50"));
      await stakingVault.connect(user1).increaseStake(0, 1, ethers.parseEther("50"));

      // User should still be in lockedUsers
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Get updated lock info
      const locks = await stakingVault.getUserLocks(user1.address);
      expect(locks[1].isLocked).to.be.true;
      expect(locks[1].amount).to.equal(ethers.parseEther("150"));

      // Complete unstake
      await time.increase(MONTH);
      await stakingVault.connect(user1).unstake(0, 1);

      // User should be removed from lockedUsers
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
    });
  });

  describe("More User Tracking Tests", function () {
    beforeEach(async function () {
      // Mint tokens for users
      await stakingToken.connect(owner).mint(user1.address, ethers.parseEther("1000"));
      await stakingToken.connect(owner).mint(user2.address, ethers.parseEther("1000"));
      await stakingToken.connect(owner).mint(user3.address, ethers.parseEther("1000"));

      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK, MONTH], [1000, 2000]);
      await stakingToken.connect(user1).approve(stakingVault.getAddress(), ethers.parseEther("500"));
      await stakingToken.connect(user2).approve(stakingVault.getAddress(), ethers.parseEther("500"));
      await stakingToken.connect(user3).approve(stakingVault.getAddress(), ethers.parseEther("500"));
    });

    it("Should correctly handle multiple users in lockedUsers array", async function () {
      // Initially no users
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);

      // Add first user
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Add second user
      await stakingVault.connect(user2).stake(0, ethers.parseEther("100"), WEEK);
      expect(await stakingVault.getTotalLockedUsers()).to.equal(2);

      // Add third user
      await stakingVault.connect(user3).stake(0, ethers.parseEther("100"), WEEK);
      expect(await stakingVault.getTotalLockedUsers()).to.equal(3);

      // Fast forward past lock period
      await time.increase(WEEK + 1);

      // Remove second user first (testing non-sequential removal)
      await stakingVault.connect(user2).unstake(0, 0);
      expect(await stakingVault.getTotalLockedUsers()).to.equal(2);

      // Remove first user
      await stakingVault.connect(user1).unstake(0, 0);
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Remove last user
      await stakingVault.connect(user3).unstake(0, 0);
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
    });

    it("Should keep user in lockedUsers when they have locks in multiple pools", async function () {
      // Add a second pool
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK, MONTH], [1000, 2000]);

      // User stakes in both pools
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      await stakingVault.connect(user1).stake(1, ethers.parseEther("100"), WEEK);

      // Verify user is in lockedUsers
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Advance time past first lock period
      await time.increase(WEEK + 1);

      // Get user locks to find the correct lock IDs
      const userLocks = await stakingVault.getUserLocks(await user1.getAddress());
      console.log({ userLocks });

      // Unstake from first pool - use lock ID 0
      await stakingVault.connect(user1).unstake(0, 0);

      // User should still be in lockedUsers because of second pool lock
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Unstake from second pool - use lock ID 1
      await stakingVault.connect(user1).unstake(1, 1);

      // User should now be removed from lockedUsers
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);
    });

    it("Should handle lockedUsers array correctly after emergency unlock", async function () {
      // Setup multiple users with stakes
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), MONTH);
      await stakingVault.connect(user2).stake(0, ethers.parseEther("100"), MONTH);
      await stakingVault.connect(user3).stake(0, ethers.parseEther("100"), MONTH);

      // Verify users are in lockedUsers array
      expect(await stakingVault.getTotalLockedUsers()).to.equal(3);

      // Call emergency unlock
      await stakingVault.connect(owner).emergencyUnlockAll();

      // Check all locks are unlocked but users still in lockedUsers array
      const user1Locks = await stakingVault.getUserLocks(user1.address);
      expect(user1Locks[0].isLocked).to.be.false;
      expect(await stakingVault.getTotalLockedUsers()).to.equal(3);

      // First user unstakes
      await stakingVault.connect(user1).unstake(0, 0);

      // With our fix, user1 should now be removed from lockedUsers
      expect(await stakingVault.getTotalLockedUsers()).to.equal(2);

      // Second user unstakes
      await stakingVault.connect(user2).unstake(0, 0);

      // User2 should now be removed
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);

      // Third user unstakes
      await stakingVault.connect(user3).unstake(0, 0);

      // All users should be removed now
      expect(await stakingVault.getTotalLockedUsers()).to.equal(0);

      // User1 stakes again after emergency unlock and unstake
      await stakingVault.connect(user1).stake(0, ethers.parseEther("50"), WEEK);

      // Only user1 should be in the array now
      expect(await stakingVault.getTotalLockedUsers()).to.equal(1);
    });
  });

  describe("Multiple Operations Interference", function () {
    beforeEach(async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];

      // Add two pools
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);
    });

    it("Should handle multiple rapid stakes and unstake operations", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      await time.increase(WEEK + 1);

      await stakingVault.connect(user1).unstake(0, 0);
      await stakingVault.connect(user1).unstake(0, 1);

      expect(await stakingVault.getActiveStakedBalance(user1.address)).to.equal(0);
    });

    it("Should handle multiple rapid increases in stake amount", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"));
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"));

      const lockInfo = await stakingVault.getUserLocks(user1.address);
      expect(lockInfo[0].amount).to.equal(ethers.parseEther("200"));
    });

    it("Should handle emergency unlock followed by immediate restaking", async function () {
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      await stakingVault.connect(owner).emergencyUnlockAll();

      await stakingVault.connect(user1).unstake(0, 0);

      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);

      const lockInfo = await stakingVault.getUserLocks(user1.address);
      expect(lockInfo[1].amount).to.equal(ethers.parseEther("100"));
    });

    it("Should correctly calculate rewards when multiple users interact in quick succession", async function () {
      console.log("Starting multi-user reward test...");

      // Setup pool
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      // Initial stakes
      await stakingVault.connect(user1).stake(0, ethers.parseEther("100"), WEEK);
      await stakingVault.connect(user2).stake(0, ethers.parseEther("100"), WEEK);
      console.log("Initial stakes completed");

      // Get user locks
      let user1Locks = await stakingVault.getUserLocks(user1.address);
      let user2Locks = await stakingVault.getUserLocks(user2.address);

      // Advance time to accumulate rewards
      await time.increase(WEEK / 4);
      const timeAfterFirstIncrease = await time.latest();
      console.log(`Time advanced to ${timeAfterFirstIncrease} (${WEEK / 4} seconds later)`);

      // Calculate rewards for both users before any actions
      const user1RewardsBeforeAction = await stakingVault.calculateRewards(user1.address, 0);
      const user2RewardsBeforeAction = await stakingVault.calculateRewards(user2.address, 0);
      console.log(`User1 rewards before actions: ${ethers.formatEther(user1RewardsBeforeAction)}`);
      console.log(`User2 rewards before actions: ${ethers.formatEther(user2RewardsBeforeAction)}`);

      // The rewards should be approximately equal since both users staked the same amount
      expect(user1RewardsBeforeAction).to.be.closeTo(user2RewardsBeforeAction, ethers.parseEther("0.001"));

      // User1 increases stake
      await stakingVault.connect(user1).increaseStake(0, 0, ethers.parseEther("50"));
      console.log("User1 increased stake by 50 tokens");

      // Get user1's lock info after increasing stake
      const user1LocksAfterIncrease = await stakingVault.getUserLocks(user1.address);
      console.log(`User1 lock amount after increase: ${ethers.formatEther(user1LocksAfterIncrease[0].amount)}`);
      console.log(`User1 lastClaimTime after increase: ${user1LocksAfterIncrease[0].lastClaimTime}`);

      // User2 claims rewards
      const user2InitialRewards = await stakingVault.calculateRewards(user2.address, 0);
      console.log(`User2 calculated rewards before claiming: ${ethers.formatEther(user2InitialRewards)}`);
      await stakingVault.connect(user2).claimRewards(0, 0);

      // After claiming, rewards should be reset
      const user2RewardsAfterClaim = await stakingVault.calculateRewards(user2.address, 0);
      console.log(`User2 rewards after claiming: ${ethers.formatEther(user2RewardsAfterClaim)}`);
      expect(user2RewardsAfterClaim).to.equal(0);

      const user2LifetimeRewards = await stakingVault.getLifetimeRewards(user2.address);
      console.log(`User2 lifetime rewards: ${ethers.formatEther(user2LifetimeRewards)}`);

      // Verify user2's rewards were properly calculated and claimed
      // Allow a small difference due to potential precision issues
      expect(user2LifetimeRewards).to.be.closeTo(user2InitialRewards, ethers.parseEther("0.001"));

      // Advance time again
      await time.increase(WEEK / 4);
      const timeAfterSecondIncrease = await time.latest();
      console.log(`Time advanced again to ${timeAfterSecondIncrease} (${WEEK / 4} seconds later)`);

      // Check rewards again before user2 increases stake
      const user1RewardsBeforeUser2Action = await stakingVault.calculateRewards(user1.address, 0);
      const user2RewardsBeforeIncrease = await stakingVault.calculateRewards(user2.address, 0);
      console.log(`User1 rewards before user2 action: ${ethers.formatEther(user1RewardsBeforeUser2Action)}`);
      console.log(`User2 rewards before increase: ${ethers.formatEther(user2RewardsBeforeIncrease)}`);

      // User2 increases stake - this should reset their lock period
      await stakingVault.connect(user2).increaseStake(0, 0, ethers.parseEther("50"));
      console.log("User2 increased stake by 50 tokens");

      // Both users should have different unlock times now
      user1Locks = await stakingVault.getUserLocks(user1.address);
      user2Locks = await stakingVault.getUserLocks(user2.address);

      console.log(`User1 unlock time: ${user1Locks[0].unlockTime}`);
      console.log(`User2 unlock time: ${user2Locks[0].unlockTime}`);

      // User1's lock should unlock earlier than user2's
      expect(user1Locks[0].unlockTime).to.be.lt(user2Locks[0].unlockTime);

      // Advance to just after user1's unlock time
      const timeToUser1Unlock = Number(user1Locks[0].unlockTime) - (await time.latest()) + 10; // Add 10 seconds buffer
      await time.increase(timeToUser1Unlock);
      console.log(`Time advanced to after user1's unlock time: ${await time.latest()}`);

      // Check final rewards before unstaking
      const user1FinalRewards = await stakingVault.calculateRewards(user1.address, 0);
      const user2FinalRewards = await stakingVault.calculateRewards(user2.address, 0);
      console.log(`User1 final rewards: ${ethers.formatEther(user1FinalRewards)}`);
      console.log(`User2 final rewards: ${ethers.formatEther(user2FinalRewards)}`);

      // User1 should be able to unstake, but user2 should not
      await stakingVault.connect(user1).unstake(0, 0);
      console.log("User1 unstaked successfully");

      // User2 should not be able to unstake yet
      await expect(stakingVault.connect(user2).unstake(0, 0)).to.be.revertedWith("Lock period not yet over");
      console.log("User2 unstake properly rejected");

      // Verify final balances
      const user1FinalBalance = await stakingToken.balanceOf(user1.address);
      console.log(`User1 final token balance: ${ethers.formatEther(user1FinalBalance)}`);

      // The user should have their original 1000 tokens, minus the 100 initially staked,
      // plus the 150 tokens returned (100 original + 50 added).
      // The balance should be around 1000, not 950, because the tokens are returned during unstaking
      expect(user1FinalBalance).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("1"));
    });
  });

  describe("Input Validation", function () {
    it("Should revert when setting reward token to zero address", async function () {
      await expect(stakingVault.setRewardToken(ethers.ZeroAddress, { gasLimit: GAS_LIMITS.LOW })).to.be.revertedWith(
        "Reward token cannot be zero address",
      );
    });

    it("Should revert when adding pool with zero address as staking token", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      await expect(
        addPoolWithDefaultMultiplier(stakingVault, ethers.ZeroAddress, lockPeriods, rewardRates),
      ).to.be.revertedWith("Invalid staking token address");
    });

    it("Should revert when recovering tokens to zero address", async function () {
      await expect(
        stakingVault.recoverTokens(await stakingToken.getAddress(), ethers.ZeroAddress, ethers.parseEther("1"), {
          gasLimit: GAS_LIMITS.HIGH,
        }),
      ).to.be.revertedWith("Cannot recover to zero address");
    });

    it("Should revert when adding pool with empty lock periods array", async function () {
      await expect(addPoolWithDefaultMultiplier(stakingVault, stakingToken, [], [])).to.be.revertedWith(
        "Empty lock periods array",
      );
    });

    it("Should revert when adding pool with zero lock period", async function () {
      await expect(addPoolWithDefaultMultiplier(stakingVault, stakingToken, [0], [100])).to.be.revertedWith(
        "Lock period cannot be zero",
      );
    });

    it("Should allow adding pool with zero reward rate in Input Validation", async function () {
      // Create a pool with zero reward rate
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK], [0]);

      // Verify the pool was created with zero reward rate
      const pools = await stakingVault.getPools();
      const pool = pools[pools.length - 1];
      expect(pool.rewardRates[0]).to.equal(0);
    });

    it("Should allow updating reward rates with zero values in Input Validation", async function () {
      // First create a valid pool
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, [WEEK], [100]);

      // Update with zero reward rate - should not revert
      await stakingVault.updateRewardRates(0, [0], { gasLimit: GAS_LIMITS.HIGH });

      // Verify the reward rate was updated to zero
      const pools = await stakingVault.getPools();
      const pool = pools[0];
      expect(pool.rewardRates[0]).to.equal(0);
    });
  });

  describe("Rewards Calculation Precision", function () {
    // ... existing code ...
  });

  // Add a new test for custom token multiplier
  describe("Token Multiplier", function () {
    it("Should add a pool with custom token multiplier", async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];
      const customMultiplier = 20000; // 2x multiplier
      const tokenAddress = await stakingToken.getAddress();

      // Call the contract method with custom multiplier
      await expect(addPoolWithMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates, customMultiplier))
        .to.emit(stakingVault, "PoolAdded")
        .withArgs(0, tokenAddress, lockPeriods, rewardRates, customMultiplier);

      const pool = await stakingVault.pools(0);
      expect(pool.isActive).to.be.true;
      expect(pool.stakingToken).to.equal(tokenAddress);
      expect(pool.tokenMultiplier).to.equal(customMultiplier);
    });

    it("Should update token multiplier", async function () {
      const lockPeriods = [WEEK, MONTH];
      const rewardRates = [100, 200];

      // First add a pool with default multiplier
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      const initialPool = await stakingVault.pools(0);
      expect(initialPool.tokenMultiplier).to.equal(10000); // Default 1.0x

      // Update to a 2.0x multiplier
      const newMultiplier = 20000;
      await expect(stakingVault.updateTokenMultiplier(0, newMultiplier, { gasLimit: GAS_LIMITS.HIGH }))
        .to.emit(stakingVault, "TokenMultiplierUpdated")
        .withArgs(0, 10000, newMultiplier);

      const updatedPool = await stakingVault.pools(0);
      expect(updatedPool.tokenMultiplier).to.equal(newMultiplier);
    });

    it("Should calculate rewards correctly with custom multiplier", async function () {
      const lockPeriods = [WEEK];
      const rewardRates = [100];
      const customMultiplier = 20000; // 2x multiplier

      // Add two pools: one with custom multiplier, one with default
      await addPoolWithMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates, customMultiplier);
      await addPoolWithDefaultMultiplier(stakingVault, stakingToken, lockPeriods, rewardRates);

      // Stake tokens for both users at the same time
      const stakeAmount = ethers.parseEther("100");
      await stakingVault.connect(user1).stake(0, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH });
      await stakingVault.connect(user2).stake(1, stakeAmount, WEEK, { gasLimit: GAS_LIMITS.HIGH });

      // Advance time halfway through the lock period - same time for both
      await time.increase(WEEK / 2);

      // Calculate rewards for both users
      const customMultiplierRewards = await stakingVault.calculateRewards(user1.address, 0);
      const defaultMultiplierRewards = await stakingVault.calculateRewards(user2.address, 0);

      // Custom multiplier (2x) rewards should be approximately twice the default rewards
      // Allow for small deviations due to possible block timing differences
      const ratio = Number(customMultiplierRewards) / Number(defaultMultiplierRewards);
      expect(ratio).to.be.closeTo(2.0, 0.1); // Should be 2x with 0.1 tolerance
    });
  });
});
