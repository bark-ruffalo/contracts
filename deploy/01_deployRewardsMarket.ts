import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../utils/verification";
import { GAS_LIMITS } from "../test/constants";
import { ethers } from "hardhat";

const deployRewardsMarket: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const network = hre.network.name;
  console.log(`\n Deploying RewardsMarket to ${network}...\n`);

  // Get RewardToken address (optional)
  let rewardTokenAddress = ethers.ZeroAddress;
  try {
    const existingRewardToken = await get("RewardToken");
    rewardTokenAddress = existingRewardToken.address;
    console.log("📝 Found existing RewardToken at:", rewardTokenAddress);
  } catch {
    console.log("⚠️ No RewardToken found. Deploying without reward token...");
  }

  // Deploy RewardsMarket
  let rewardsMarketAddress;
  let isNewDeployment = false;
  try {
    const existingRewardsMarket = await get("RewardsMarket");
    rewardsMarketAddress = existingRewardsMarket.address;
    console.log("📝 RewardsMarket already deployed at:", rewardsMarketAddress);
  } catch {
    const rewardsMarketDeployment = await deploy("RewardsMarket", {
      from: deployer,
      args: [rewardTokenAddress],
      log: true,
      autoMine: true,
      waitConfirmations: network === "localhost" ? 1 : 5,
      gasLimit: GAS_LIMITS.DEPLOY,
    });
    rewardsMarketAddress = rewardsMarketDeployment.address;
    isNewDeployment = true;
    console.log("🔨 RewardsMarket deployed to:", rewardsMarketAddress);
  }

  // Only verify new deployments on non-local networks
  if (isNewDeployment && network !== "localhost" && network !== "hardhat") {
    console.log("\n🔍 Verifying new contract...\n");
    await verifyContract(hre, rewardsMarketAddress, [rewardTokenAddress]);
  }
};

export default deployRewardsMarket;
deployRewardsMarket.tags = ["RewardsMarket"];
deployRewardsMarket.dependencies = ["Staking"];
