import { HardhatRuntimeEnvironment } from "hardhat/types";
import { verifyContract } from "../utils/verification";

async function main() {
  // Get the HRE
  const hre = require("hardhat");
  
  // Get deployer address
  let deployer;
  try {
    ({ deployer } = await hre.getNamedAccounts());
  } catch {
    const networkConfig = hre.network.config;
    if (networkConfig.ledgerAccounts && networkConfig.ledgerAccounts.length > 0) {
      deployer = networkConfig.ledgerAccounts[0];
      console.log(`Using ledger account: ${deployer}`);
    } else {
      throw new Error("No deployer account available");
    }
  }

  // Get the contract address from deployments
  const deployments = await hre.deployments.all();
  const rewardTokenDeployment = deployments["RewardToken"];
  
  if (!rewardTokenDeployment) {
    throw new Error("RewardToken deployment not found");
  }
  
  const contractAddress = rewardTokenDeployment.address;
  console.log(`\n🔍 Verifying RewardToken contract at ${contractAddress}...\n`);
  
  try {
    // Pass the constructor arguments to the verification function
    await verifyContract(hre, contractAddress, [deployer, deployer]);
    console.log("✅ RewardToken verified");
  } catch (error) {
    console.error("❌ Failed to verify RewardToken:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 