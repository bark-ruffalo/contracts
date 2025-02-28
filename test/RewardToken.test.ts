import { expect } from "chai";
import { ethers } from "hardhat";
import { RewardToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { GAS_LIMITS } from "./constants";

describe("RewardToken", function () {
  let rewardToken: RewardToken;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy(owner.address, owner.address, { gasLimit: GAS_LIMITS.DEPLOY });
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await rewardToken.name()).to.equal("Reward PAWSY");
      expect(await rewardToken.symbol()).to.equal("rPAWSY");
    });

    it("Should set the correct roles", async function () {
      expect(await rewardToken.hasRole(await rewardToken.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
      expect(await rewardToken.hasRole(await rewardToken.MINTER_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("100");
      await rewardToken.mint(user1.address, mintAmount, { gasLimit: GAS_LIMITS.LOW });

      expect(await rewardToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should revert if non-owner tries to mint", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(
        rewardToken.connect(user1).mint(user2.address, mintAmount, { gasLimit: GAS_LIMITS.LOW }),
      ).to.be.revertedWithCustomError(rewardToken, "AccessControlUnauthorizedAccount");
    });

    it("Should revert when minting to zero address", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(rewardToken.mint(ethers.ZeroAddress, mintAmount, { gasLimit: GAS_LIMITS.LOW })).to.be.reverted;
    });
  });

  describe("Burning", function () {
    const initialAmount = ethers.parseEther("1000");

    beforeEach(async function () {
      await rewardToken.mint(user1.address, initialAmount, { gasLimit: GAS_LIMITS.LOW });
    });

    it("Should allow users to burn their own tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      await rewardToken.connect(user1).burn(burnAmount, { gasLimit: GAS_LIMITS.LOW });

      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialAmount - burnAmount);
    });

    it("Should allow approved users to burn tokens via burnFrom", async function () {
      const burnAmount = ethers.parseEther("100");
      await rewardToken.connect(user1).approve(user2.address, burnAmount, { gasLimit: GAS_LIMITS.LOW });

      await rewardToken.connect(user2).burnFrom(user1.address, burnAmount, { gasLimit: GAS_LIMITS.LOW });

      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialAmount - burnAmount);
    });

    it("Should revert burnFrom if allowance is insufficient", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(
        rewardToken.connect(user2).burnFrom(user1.address, burnAmount, { gasLimit: GAS_LIMITS.LOW }),
      ).to.be.revertedWithCustomError(rewardToken, "ERC20InsufficientAllowance");
    });

    it("Should revert burnFrom for zero address", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(
        rewardToken.burnFrom(ethers.ZeroAddress, burnAmount, { gasLimit: GAS_LIMITS.LOW }),
      ).to.be.reverted;
    });
  });
});
