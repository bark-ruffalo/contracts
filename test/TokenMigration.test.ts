import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { TokenMigration, MigratedToken, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { GAS_LIMITS } from "./constants";

describe("TokenMigration", function () {
  let tokenMigration: TokenMigration;
  let migratedToken: MigratedToken;
  let oldToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy MockERC20 as the old token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    oldToken = await MockERC20.deploy("Old PAWSY", "PAWSY", { gasLimit: GAS_LIMITS.DEPLOY });
    await oldToken.waitForDeployment();

    // Deploy MigratedToken first
    const MigratedToken = await ethers.getContractFactory("MigratedToken");
    const _migratedToken = await upgrades.deployProxy(MigratedToken, [owner.address, owner.address], {
      initializer: "initialize",
    });
    await _migratedToken.waitForDeployment();
    migratedToken = await ethers.getContractAt("MigratedToken", await _migratedToken.getAddress());

    // Deploy TokenMigration
    const TokenMigration = await ethers.getContractFactory("TokenMigration");
    tokenMigration = await TokenMigration.deploy(await oldToken.getAddress(), await migratedToken.getAddress(), {
      gasLimit: GAS_LIMITS.DEPLOY,
    });
    await tokenMigration.waitForDeployment();

    // Grant PAUSER_ROLE to owner
    const PAUSER_ROLE = await tokenMigration.PAUSER_ROLE();
    await tokenMigration.grantRole(PAUSER_ROLE, owner.address);

    // Grant MINTER_ROLE to TokenMigration contract
    const MINTER_ROLE = await migratedToken.MINTER_ROLE();
    await migratedToken.grantRole(MINTER_ROLE, await tokenMigration.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the correct old and new token addresses", async function () {
      expect(await tokenMigration.oldToken()).to.equal(await oldToken.getAddress());
      expect(await tokenMigration.newToken()).to.equal(await migratedToken.getAddress());
    });
  });

  describe("Token Migration", function () {
    it("Should migrate tokens correctly", async function () {
      const mintAmount = ethers.parseEther("100");
      await oldToken.mint(user1.address, mintAmount);
      await oldToken.connect(user1).approve(await tokenMigration.getAddress(), mintAmount);

      await expect(tokenMigration.connect(user1).migrateTokens(mintAmount))
        .to.emit(tokenMigration, "TokensMigrated")
        .withArgs(user1.address, mintAmount);

      expect(await oldToken.balanceOf(user1.address)).to.equal(0);
      expect(await migratedToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should revert if amount is zero", async function () {
      await expect(tokenMigration.connect(user1).migrateTokens(0)).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should revert if migration is paused", async function () {
      await tokenMigration.pause();
      await expect(tokenMigration.connect(user1).migrateTokens(100))
        .to.be.revertedWithCustomError(tokenMigration, "EnforcedPause");
    });
  });

  describe("Access Control", function () {
    let PAUSER_ROLE: string;
    let DEFAULT_ADMIN_ROLE: string;

    beforeEach(async function() {
      PAUSER_ROLE = await tokenMigration.PAUSER_ROLE();
      DEFAULT_ADMIN_ROLE = await tokenMigration.DEFAULT_ADMIN_ROLE();
    });

    it("Should allow admin to pause and unpause migration", async function () {
      await expect(tokenMigration.pause()).to.emit(tokenMigration, "MigrationPaused").withArgs(owner.address);

      await expect(tokenMigration.unpause()).to.emit(tokenMigration, "MigrationUnpaused").withArgs(owner.address);
    });

    it("Should revert if non-admin tries to pause or unpause migration", async function () {
      await expect(tokenMigration.connect(user1).pause())
        .to.be.revertedWithCustomError(tokenMigration, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, PAUSER_ROLE);

      await expect(tokenMigration.connect(user1).unpause())
        .to.be.revertedWithCustomError(tokenMigration, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, PAUSER_ROLE);
    });

    it("Should allow admin to recover ERC20 tokens", async function () {
      const mintAmount = ethers.parseEther("100");
      await migratedToken.mint(await tokenMigration.getAddress(), mintAmount);

      await expect(tokenMigration.recoverERC20(await migratedToken.getAddress(), mintAmount))
        .to.emit(migratedToken, "Transfer")
        .withArgs(await tokenMigration.getAddress(), owner.address, mintAmount);
    });

    it("Should revert if non-admin tries to recover ERC20 tokens", async function () {
      await expect(tokenMigration.connect(user1).recoverERC20(await migratedToken.getAddress(), 100))
        .to.be.revertedWithCustomError(tokenMigration, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("Should revert if trying to recover the old token", async function () {
      await expect(tokenMigration.recoverERC20(await oldToken.getAddress(), 100))
        .to.be.revertedWith("Cannot recover old token");
    });
  });
});
