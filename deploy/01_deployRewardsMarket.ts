import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../utils/verification";

const deployRewardsMarket: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const network = hre.network.name;
  console.log(`\n Deploying RewardsMarket to ${network}...\n`);

  // Get RewardToken address
  let rewardTokenAddress;
  try {
    const existingRewardToken = await get("RewardToken");
    rewardTokenAddress = existingRewardToken.address;
    console.log("📝 Using existing RewardToken at:", rewardTokenAddress);
  } catch {
    console.error("❌ RewardToken not found. Please deploy staking contracts first.");
    process.exit(1);
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
