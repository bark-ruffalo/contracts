import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { verifyContract } from "../utils/verification";
import * as readline from "readline";

/**
 * Part 2 of the staking system deployment
 * This script:
 * 1. Deploys the StakingVault contract
 * 2. Grants the MINTER_ROLE to StakingVault on the RewardToken
 * 
 * The StakingVault needs minting permissions on the RewardToken
 * so it can mint reward tokens when users claim their staking rewards,
 * but ownership of the RewardToken remains with the deployer
 */
const deployStakingVault: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;

  // Get deployer address either from named accounts or ledger
  // This provides flexibility for different deployment environments
  let deployer: string;
  try {
    // First attempt to get deployer from hardhat config (uses DEPLOYER_PRIVATE_KEY)
    ({ deployer } = await getNamedAccounts());
  } catch {
    // Fallback to ledger wallet if named accounts are not available (uses LEDGER_PUBLIC_KEY)
    const networkConfig = hre.network.config as any;
    if (networkConfig.ledgerAccounts && networkConfig.ledgerAccounts.length > 0) {
      deployer = networkConfig.ledgerAccounts[0];
      console.log(`Using ledger account: ${deployer}`);
    } else {
      throw new Error("No deployer account available");
    }
  }

  const network = hre.network.name;
  console.log(`\n📡 Preparing to deploy StakingVault to ${network} as ${deployer}...\n`);

  // Create a readline interface for user confirmation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Helper function to prompt for confirmation
  const promptForConfirmation = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      rl.question(`${message} (y/N): `, (answer) => {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  };

  try {
    // Get the previously deployed RewardToken address
    // This will throw an error if RewardToken hasn't been deployed yet
    const rewardTokenDeployment = await get("RewardToken");
    console.log(`\n✅ Found existing RewardToken at: ${rewardTokenDeployment.address}`);
    
    // Ask for confirmation to continue with the detected RewardToken
    const confirmed = await promptForConfirmation(`Continue with RewardToken at ${rewardTokenDeployment.address}?`);
    
    if (!confirmed) {
      console.log("\n⛔ Deployment cancelled by user");
      rl.close();
      return;
    }

    // Ask for confirmation before deploying StakingVault
    const deployConfirmed = await promptForConfirmation(`Deploy StakingVault contract with RewardToken at ${rewardTokenDeployment.address}?`);
    
    if (!deployConfirmed) {
      console.log("\n⛔ StakingVault deployment cancelled by user");
      rl.close();
      return;
    }

    // Deploy the StakingVault contract with the RewardToken address as a constructor argument
    console.log(`\n📡 Deploying StakingVault to ${network} as ${deployer}...\n`);
    
    const stakingVaultDeployment = await deploy("StakingVault", {
      from: deployer,
      args: [rewardTokenDeployment.address],
      log: true,
      autoMine: true,
      // Use appropriate confirmation counts based on network type
      waitConfirmations: network === "localhost" || network === "hardhat" ? 1 : 5,
    });

    console.log(`\n🔨 StakingVault deployed at: ${stakingVaultDeployment.address}\n`);

    // Only perform role assignment and verification on public networks (not localhost/hardhat)
    if (network !== "localhost" && network !== "hardhat") {
      // Grant minter permissions to StakingVault
      // This gives StakingVault minting permissions without transferring ownership
      console.log("\n🔑 Granting minting permissions to StakingVault...\n");

      // Get the RewardToken contract instance
      // Use 'any' type to avoid TypeScript errors since we don't know the exact interface
      const rewardToken = await ethers.getContractAt("RewardToken", rewardTokenDeployment.address) as any;
      
      try {
        // First attempt: Try AccessControl pattern (OpenZeppelin standard)
        console.log("Attempting to grant minter role using AccessControl pattern...");
        
        // Get the MINTER_ROLE bytes32 value
        const MINTER_ROLE = await rewardToken.MINTER_ROLE();
        console.log(`Found MINTER_ROLE: ${MINTER_ROLE}`);
        
        // Check if StakingVault already has the minter role
        const hasMinterRole = await rewardToken.hasRole(MINTER_ROLE, stakingVaultDeployment.address);
        
        if (!hasMinterRole) {
          const tx = await rewardToken.grantRole(MINTER_ROLE, stakingVaultDeployment.address);
          await tx.wait(5);
          console.log(`✅ MINTER_ROLE granted to: ${stakingVaultDeployment.address}`);
        } else {
          console.log(`StakingVault already has MINTER_ROLE on RewardToken`);
        }
      } catch (error) {
        console.log("AccessControl pattern not detected. Trying alternative methods...");
        
        try {
          // Second attempt: Try the addMinter method (another common pattern)
          console.log("Attempting to grant minter role using addMinter pattern...");
          const tx = await rewardToken.addMinter(stakingVaultDeployment.address);
          await tx.wait(5);
          console.log(`✅ Minter role granted to: ${stakingVaultDeployment.address}`);
        } catch (innerError) {
          // Third attempt: Check if the contract might be using a custom approach
          console.log("Standard minter patterns not detected. Checking for custom implementation...");
          
          try {
            // Some tokens use a setMinter function
            const tx = await rewardToken.setMinter(stakingVaultDeployment.address, true);
            await tx.wait(5);
            console.log(`✅ Minter role granted to: ${stakingVaultDeployment.address}`);
          } catch (finalError) {
            console.error("❌ Failed to grant minting permissions using known patterns");
            console.error("Please check the RewardToken contract and update this script accordingly.");
            console.error("You may need to manually grant minting permissions to:", stakingVaultDeployment.address);
          }
        }
      }

      // Verify the StakingVault contract on the block explorer
      console.log("\n🔍 Verifying StakingVault contract...\n");
      try {
        await verifyContract(hre, stakingVaultDeployment.address, [rewardTokenDeployment.address]);
        console.log("✅ StakingVault verified");
      } catch (error) {
        console.error("❌ Failed to verify StakingVault:", error);
      }
    }
  } catch (error) {
    // If RewardToken was not found, log a clear error message
    console.error("\n❌ Error: RewardToken not found");
    console.error("Please deploy RewardToken first using the 00_part_1_deployRewardToken.ts script");
    console.error("This script depends on RewardToken being already deployed");
  } finally {
    // Close the readline interface
    rl.close();
  }
};

export default deployStakingVault;
deployStakingVault.tags = ["StakingVault"];
// This script depends on the RewardToken being already deployed
deployStakingVault.dependencies = ["RewardToken"]; 