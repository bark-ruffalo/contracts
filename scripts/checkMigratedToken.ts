import { ethers } from "hardhat";
import chalk from "chalk"; // yarn add chalk@4.1.2

async function main() {
  try {
    // Contract addresses
    const PROXY_ADDRESS = "0x286c27870b97bc1c79ebe3df890c72e7a7838817";
    const DEPLOYER = "0xcfdc7f77c37268c14293ebd466768f6068d99461";

    console.log(chalk.blue("\n🔍 Checking MigratedToken Contract Status...\n"));

    // Get contract instance
    const migratedToken = await ethers.getContractAt("MigratedToken", PROXY_ADDRESS);

    // Basic contract info
    console.log(chalk.yellow("📋 Basic Information:"));
    try {
      const name = await migratedToken.name();
      const symbol = await migratedToken.symbol();
      const decimals = await migratedToken.decimals();
      console.log(`Name: ${name}`);
      console.log(`Symbol: ${symbol}`);
      console.log(`Decimals: ${decimals}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to get basic info - Contract might not be initialized"));
      console.log(`Error: ${error.message}\n`);
    }

    // Check roles
    console.log(chalk.yellow("\n🔑 Checking Roles:"));
    try {
      const MINTER_ROLE = await migratedToken.MINTER_ROLE();
      const DEFAULT_ADMIN_ROLE = await migratedToken.DEFAULT_ADMIN_ROLE();

      const hasMinterRole = await migratedToken.hasRole(MINTER_ROLE, DEPLOYER);
      const hasAdminRole = await migratedToken.hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER);

      console.log(`Deployer has MINTER_ROLE: ${hasMinterRole ? chalk.green('✅') : chalk.red('❌')}`);
      console.log(`Deployer has DEFAULT_ADMIN_ROLE: ${hasAdminRole ? chalk.green('✅') : chalk.red('❌')}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to check roles"));
      console.log(`Error: ${error.message}\n`);
    }

    // Check total supply and deployer balance
    console.log(chalk.yellow("\n💰 Token Supply Information:"));
    try {
      const totalSupply = await migratedToken.totalSupply();
      const deployerBalance = await migratedToken.balanceOf(DEPLOYER);

      console.log(`Total Supply: ${ethers.formatEther(totalSupply)} tokens`);
      console.log(`Deployer Balance: ${ethers.formatEther(deployerBalance)} tokens`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to check supply information"));
      console.log(`Error: ${error.message}\n`);
    }

    // Check if contract is initialized (indirect check)
    console.log(chalk.yellow("\n🔧 Initialization Status:"));
    try {
      // Try to call initialize function
      const initializeTx = await migratedToken.initialize.staticCall(DEPLOYER, DEPLOYER);
      console.log(chalk.red("⚠️ Contract might NOT be initialized (initialize call didn't revert)"));
    } catch (error) {
      if (error.message.includes("already initialized")) {
        console.log(chalk.green("✅ Contract is initialized"));
      } else {
        console.log(chalk.red("❓ Unclear initialization status"));
        console.log(`Error: ${error.message}`);
      }
    }

    // Implementation address (if using transparent proxy)
    console.log(chalk.yellow("\n📝 Proxy Information:"));
    try {
      const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const implementationAddress = await ethers.provider.getStorage(PROXY_ADDRESS, implementationSlot);
      console.log(`Implementation Address: ${implementationAddress}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to get implementation address"));
      console.log(`Error: ${error.message}\n`);
    }

  } catch (error) {
    console.error(chalk.red("\n❌ Script failed:"));
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 