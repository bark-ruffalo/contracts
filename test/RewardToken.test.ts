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
    const gasLimit = 30000000; // Adjust this as necessary
    rewardToken = await RewardToken.deploy({ gasLimit });
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
      await expect(rewardToken.mint(user1.address, mintAmount, { gasLimit: 30000000 }))
        .to.emit(rewardToken, "TokensMinted")
        .withArgs(user1.address, mintAmount);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should revert if non-owner tries to mint", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(
        rewardToken.connect(user1).mint(user2.address, mintAmount, { gasLimit: 30000000 }),
      ).to.be.revertedWithCustomError(rewardToken, "OwnableUnauthorizedAccount");
    });

    it("Should revert when minting to zero address", async function () {
      const mintAmount = ethers.parseEther("100");
      await expect(rewardToken.mint(ethers.ZeroAddress, mintAmount, { gasLimit: 30000000 })).to.be.revertedWith(
        "Cannot mint to zero address",
      );
    });
  });

  describe("Burning", function () {
    const initialAmount = ethers.parseEther("1000");

    beforeEach(async function () {
      await rewardToken.mint(user1.address, initialAmount, { gasLimit: 30000000 });
    });

    it("Should allow users to burn their own tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(rewardToken.connect(user1).burn(burnAmount, { gasLimit: 30000000 }))
        .to.emit(rewardToken, "TokensBurned")
        .withArgs(user1.address, burnAmount);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialAmount - burnAmount);
    });

    it("Should allow approved users to burn tokens via burnFrom", async function () {
      const burnAmount = ethers.parseEther("100");
      await rewardToken.connect(user1).approve(user2.address, burnAmount, { gasLimit: 30000000 });

      await expect(rewardToken.connect(user2).burnFrom(user1.address, burnAmount, { gasLimit: 30000000 }))
        .to.emit(rewardToken, "TokensBurned")
        .withArgs(user1.address, burnAmount);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialAmount - burnAmount);
    });

    it("Should revert burnFrom if allowance is insufficient", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(
        rewardToken.connect(user2).burnFrom(user1.address, burnAmount, { gasLimit: 30000000 }),
      ).to.be.revertedWith("ERC20: burn amount exceeds allowance");
    });

    it("Should revert burnFrom for zero address", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(rewardToken.burnFrom(ethers.ZeroAddress, burnAmount, { gasLimit: 30000000 })).to.be.revertedWith(
        "Cannot burn from zero address",
      );
    });
  });
});
