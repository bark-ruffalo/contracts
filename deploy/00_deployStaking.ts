import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { verifyContract } from "../utils/verification";

const TIMELOCK_PERIODS = [
  50 * 24 * 60 * 60, // 50 days
  100 * 24 * 60 * 60, // 100 days
  200 * 24 * 60 * 60, // 200 days
  400 * 24 * 60 * 60, // 400 days
] as const;

const PAWSY_RATES = [100, 200, 300, 400] as const; // 1%, 2%, 3%, 4%
const LP_RATES = [500, 600, 700, 800] as const; // 5%, 6%, 7%, 8%

// Move addresses to config file or env variables
const PAWSY_TOKEN = process.env.PAWSY_TOKEN || "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a";
const LP_TOKEN = process.env.LP_TOKEN || "0x96fc64cae162c1cb288791280c3eff2255c330a8";

const deployStaking: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const network = hre.network.name;
  console.log(`\n📡 Deploying staking contracts to ${network}...\n`);

  // Deploy RewardToken
  let rewardTokenAddress;
  let isNewDeployment = false;
  try {
    const existingRewardToken = await get("RewardToken");
    rewardTokenAddress = existingRewardToken.address;
    console.log("📝 RewardToken already deployed at:", rewardTokenAddress);
  } catch {
    const rewardTokenDeployment = await deploy("RewardToken", {
      from: deployer,
      log: true,
      autoMine: true,
      waitConfirmations: network === "localhost" ? 1 : 5,
    });
    rewardTokenAddress = rewardTokenDeployment.address;
    isNewDeployment = true;
    console.log("🔨 RewardToken deployed to:", rewardTokenAddress);
  }

  // Deploy StakingVault
  let stakingVaultAddress;
  try {
    const existingStakingVault = await get("StakingVault");
    stakingVaultAddress = existingStakingVault.address;
    console.log("📝 StakingVault already deployed at:", stakingVaultAddress);
  } catch {
    const stakingVaultDeployment = await deploy("StakingVault", {
      from: deployer,
      args: [rewardTokenAddress],
      log: true,
      autoMine: true,
      waitConfirmations: network === "localhost" ? 1 : 5,
    });
    stakingVaultAddress = stakingVaultDeployment.address;
    isNewDeployment = true;
    console.log("🔨 StakingVault deployed to:", stakingVaultAddress);
  }

  // Only perform post-deployment setup for new deployments on non-local networks
  if (isNewDeployment && network !== "localhost" && network !== "hardhat") {
    console.log("\n🔧 Setting up new contracts...\n");

    const rewardToken = await ethers.getContractAt("RewardToken", rewardTokenAddress);
    const stakingVault = await ethers.getContractAt("StakingVault", stakingVaultAddress);

    // Transfer ownership
    const currentOwner = await rewardToken.owner();
    if (currentOwner !== stakingVaultAddress) {
      console.log("📤 Transferring RewardToken ownership to StakingVault...");
      const tx = await rewardToken.transferOwnership(stakingVaultAddress);
      await tx.wait(network === "localhost" ? 1 : 5);
      console.log("✅ Ownership transferred to:", stakingVaultAddress);
    }

    // Initialize pools for new deployment
    console.log("🏊 Initializing pools...");

    const addPawsyPool = await stakingVault.addPool(PAWSY_TOKEN, TIMELOCK_PERIODS, PAWSY_RATES);
    await addPawsyPool.wait(network === "localhost" ? 1 : 5);
    console.log("✅ PAWSY pool added");

    const addLpPool = await stakingVault.addPool(LP_TOKEN, TIMELOCK_PERIODS, LP_RATES);
    await addLpPool.wait(network === "localhost" ? 1 : 5);
    console.log("✅ LP pool added");

    // Verify new contracts
    console.log("\n🔍 Verifying new contracts...\n");
    await verifyContract(hre, rewardTokenAddress);
    await verifyContract(hre, stakingVaultAddress, [rewardTokenAddress]);
  }
};

export default deployStaking;
deployStaking.tags = ["Staking"];
deployStaking.dependencies = [];
