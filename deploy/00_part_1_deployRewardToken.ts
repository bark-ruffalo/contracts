const { verifyContract } = require("../utils/verification");

/**
 * Part 1 of the staking system deployment
 * This script only deploys the RewardToken contract
 * 
 * The RewardToken is an ERC20 token that will be minted by the StakingVault
 * to reward users for staking tokens in the ecosystem
 */
const deployRewardToken = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  // Get deployer address either from named accounts or ledger
  // This provides flexibility for different deployment environments
  let deployer;
  try {
    // First attempt to get deployer from hardhat config (uses DEPLOYER_PRIVATE_KEY)
    ({ deployer } = await getNamedAccounts());
  } catch {
    // Fallback to ledger wallet if named accounts are not available (uses LEDGER_PUBLIC_KEY)
    const networkConfig = hre.network.config;
    if (networkConfig.ledgerAccounts && networkConfig.ledgerAccounts.length > 0) {
      deployer = networkConfig.ledgerAccounts[0];
      console.log(`Using ledger account: ${deployer}`);
    } else {
      throw new Error("No deployer account available");
    }
  }

  const network = hre.network.name;
  console.log(`\n📡 Deploying RewardToken to ${network} as ${deployer}...\n`);

  // Deploy the RewardToken contract
  // This token will be owned by the deployer initially, but ownership
  // will be transferred to the StakingVault in part 2
  const rewardTokenDeployment = await deploy("RewardToken", {
    from: deployer,
    args: [deployer, deployer], // Pass constructor arguments: defaultAdmin, minter
    log: true,
    autoMine: true,
    // Use appropriate confirmation counts based on network type
    waitConfirmations: network === "localhost" || network === "hardhat" ? 1 : 5,
  });

  console.log(`\n🔨 RewardToken deployed at: ${rewardTokenDeployment.address}\n`);

  // Only verify contracts on public networks (not localhost/hardhat)
  if (network !== "localhost" && network !== "hardhat") {
    console.log("\n🔍 Verifying RewardToken contract...\n");
    try {
      await verifyContract(hre, rewardTokenDeployment.address, [deployer, deployer]);
      console.log("✅ RewardToken verified");
    } catch (error) {
      console.error("❌ Failed to verify RewardToken:", error);
    }
  }
};

module.exports = deployRewardToken;
module.exports.tags = ["RewardToken"];
module.exports.dependencies = []; 