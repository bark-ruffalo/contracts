import { expect } from "chai";
import { ethers } from "hardhat";
import { RewardToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RewardToken", function () {
  let rewardToken: RewardToken;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const RewardToken = await ethers.getContractFactory("RewardToken");
    // Set a gas limit explicitly
    rewardToken = await RewardToken.deploy();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await rewardToken.name()).to.equal("DRUGS");
      expect(await rewardToken.symbol()).to.equal("DRUGS");
    });

    it("Should set the correct owner", async function () {
      expect(await rewardToken.owner()).to.equal(owner.address);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(rewardToken.mint(user1.address, mintAmount))
        .to.emit(rewardToken, "TokensMinted")
        .withArgs(user1.address, mintAmount);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should revert if non-owner tries to mint", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(rewardToken.connect(user1).mint(user2.address, mintAmount)).to.be.revertedWithCustomError(
        rewardToken,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert when minting to zero address", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(rewardToken.mint(ethers.ZeroAddress, mintAmount)).to.be.revertedWith("Cannot mint to zero address");
    });
  });

  describe("Burning", function () {
    const initialAmount = ethers.parseEther("1000");

    beforeEach(async function () {
      await rewardToken.mint(user1.address, initialAmount);
    });

    it("Should allow users to burn their own tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(rewardToken.connect(user1).burn(burnAmount))
        .to.emit(rewardToken, "TokensBurned")
        .withArgs(user1.address, burnAmount);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialAmount - burnAmount);
    });

    it("Should allow approved users to burn tokens via burnFrom", async function () {
      const burnAmount = ethers.parseEther("100");
      await rewardToken.connect(user1).approve(user2.address, burnAmount);

      await expect(rewardToken.connect(user2).burnFrom(user1.address, burnAmount))
        .to.emit(rewardToken, "TokensBurned")
        .withArgs(user1.address, burnAmount);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialAmount - burnAmount);
    });

    it("Should revert burnFrom if allowance is insufficient", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(rewardToken.connect(user2).burnFrom(user1.address, burnAmount)).to.be.revertedWith(
        "ERC20: burn amount exceeds allowance",
      );
    });

    it("Should revert burnFrom for zero address", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(rewardToken.burnFrom(ethers.ZeroAddress, burnAmount)).to.be.revertedWith(
        "Cannot burn from zero address",
      );
    });
  });
});
