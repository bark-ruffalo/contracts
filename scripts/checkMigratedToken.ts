import { ethers } from "hardhat";
import chalk from "chalk"; // yarn add chalk@4.1.2

async function main() {
  try {
    // Contract addresses
    const PROXY_ADDRESS = "0xBF71BD090E3f25066615dF7f4ccA90a7e6Cc6505";
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

    // Check roles and their bytes32 values
    console.log(chalk.yellow("\n🔑 Role Identifiers:"));
    try {
      const MINTER_ROLE = await migratedToken.MINTER_ROLE();
      const DEFAULT_ADMIN_ROLE = await migratedToken.DEFAULT_ADMIN_ROLE();

      console.log(`MINTER_ROLE: ${MINTER_ROLE}`);
      console.log(`DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
      
      // Calculate role hashes manually to verify
      const calculatedMinterRole = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      const calculatedDefaultAdminRole = ethers.ZeroHash;

      console.log("\nRole Hash Verification:");
      console.log(`MINTER_ROLE matches calculation: ${MINTER_ROLE === calculatedMinterRole ? chalk.green('✅') : chalk.red('❌')}`);
      console.log(`DEFAULT_ADMIN_ROLE matches known value: ${DEFAULT_ADMIN_ROLE === calculatedDefaultAdminRole ? chalk.green('✅') : chalk.red('❌')}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to get role identifiers"));
      console.log(`Error: ${error.message}\n`);
    }

    // Check role assignments (simplified version)
    console.log(chalk.yellow("\n👤 Role Assignments:"));
    try {
      const MINTER_ROLE = await migratedToken.MINTER_ROLE();
      const DEFAULT_ADMIN_ROLE = await migratedToken.DEFAULT_ADMIN_ROLE();

      const hasMinterRole = await migratedToken.hasRole(MINTER_ROLE, DEPLOYER);
      const hasAdminRole = await migratedToken.hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER);

      console.log(`Deployer has MINTER_ROLE: ${hasMinterRole ? chalk.green('✅') : chalk.red('❌')}`);
      console.log(`Deployer has DEFAULT_ADMIN_ROLE: ${hasAdminRole ? chalk.green('✅') : chalk.red('❌')}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to check role assignments"));
      console.log(`Error: ${error.message}\n`);
    }

    // Improved initialization check
    console.log(chalk.yellow("\n🔧 Initialization Status:"));
    try {
      const name = await migratedToken.name();
      const symbol = await migratedToken.symbol();
      const totalSupply = await migratedToken.totalSupply();
      
      const isInitialized = name === "Migrated PAWSY" && 
                           symbol === "mPAWSY" && 
                           totalSupply > 0;
                           
      console.log(isInitialized ? 
        chalk.green("✅ Contract is initialized (verified by state)") : 
        chalk.red("❌ Contract might not be initialized"));
    } catch (error) {
      console.log(chalk.red("❌ Failed to check initialization status"));
      console.log(`Error: ${error.message}\n`);
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