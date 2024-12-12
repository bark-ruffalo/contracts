import { ethers } from "hardhat";
import chalk from "chalk";

async function main() {
  try {
    // Contract addresses
    const TOKEN_MIGRATION_ADDRESS = "0xb77f643DB213CdC6da0cc3c926Fd010B983819C2";
    const OLD_TOKEN_ADDRESS = "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a";
    const MIGRATED_TOKEN_PROXY = "0xF94Cc0EcB84dE25FC7aa5411a437902eaaB4d410";
    const DEPLOYER = "0xcfdc7f77c37268c14293ebd466768f6068d99461";

    console.log(chalk.blue("\n🔍 Checking TokenMigration Contract Status...\n"));

    // Get contract instances
    const tokenMigration = await ethers.getContractAt("TokenMigration", TOKEN_MIGRATION_ADDRESS);
    const migratedToken = await ethers.getContractAt("MigratedToken", MIGRATED_TOKEN_PROXY);

    // Basic contract info
    console.log(chalk.yellow("📋 Basic Information:"));
    try {
      const oldTokenAddress = await tokenMigration.oldToken();
      const newTokenAddress = await tokenMigration.newToken();
      const migrationRatio = await tokenMigration.MIGRATION_RATIO();
      const isPaused = await tokenMigration.paused();

      console.log(`Old Token Address: ${oldTokenAddress}`);
      console.log(`New Token Address: ${newTokenAddress}`);
      console.log(`Migration Ratio: ${migrationRatio}`);
      console.log(`Migration Paused: ${isPaused ? chalk.red('Yes') : chalk.green('No')}`);

      console.log("\nAddress Verification:");
      console.log(`Old Token Address Match: ${oldTokenAddress.toLowerCase() === OLD_TOKEN_ADDRESS.toLowerCase() ? chalk.green('✅') : chalk.red('❌')}`);
      console.log(`New Token Address Match: ${newTokenAddress.toLowerCase() === MIGRATED_TOKEN_PROXY.toLowerCase() ? chalk.green('✅') : chalk.red('❌')}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to get basic info"));
      console.log(`Error: ${error.message}\n`);
    }

    // Check roles (only the ones defined in the contract)
    console.log(chalk.yellow("\n🔑 Checking Roles:"));
    try {
      const PAUSER_ROLE = await tokenMigration.PAUSER_ROLE();
      const DEFAULT_ADMIN_ROLE = await tokenMigration.DEFAULT_ADMIN_ROLE();

      const hasPauserRole = await tokenMigration.hasRole(PAUSER_ROLE, DEPLOYER);
      const hasAdminRole = await tokenMigration.hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER);

      console.log(`Deployer has PAUSER_ROLE: ${hasPauserRole ? chalk.green('✅') : chalk.red('❌')}`);
      console.log(`Deployer has DEFAULT_ADMIN_ROLE: ${hasAdminRole ? chalk.green('✅') : chalk.red('❌')}`);
    } catch (error) {
      console.log(chalk.red("❌ Failed to check roles"));
      console.log(`Error: ${error.message}\n`);
    }

    // Check past events (only events defined in the contract)
    console.log(chalk.yellow("\n📜 Recent Events:"));
    try {
      const migrationFilter = tokenMigration.filters.TokensMigrated();
      const pauseFilter = tokenMigration.filters.MigrationPaused();
      const unpauseFilter = tokenMigration.filters.MigrationUnpaused();

      const [migrationEvents, pauseEvents, unpauseEvents] = await Promise.all([
        tokenMigration.queryFilter(migrationFilter, -1000),
        tokenMigration.queryFilter(pauseFilter, -1000),
        tokenMigration.queryFilter(unpauseFilter, -1000)
      ]);

      if (migrationEvents.length > 0) {
        console.log("\nToken Migration Events:");
        migrationEvents.forEach(event => {
          console.log(`User: ${event.args.user}, Amount: ${ethers.formatEther(event.args.amount)} tokens`);
        });
      } else {
        console.log("No migration events found in the last 1000 blocks");
      }

      if (pauseEvents.length > 0 || unpauseEvents.length > 0) {
        console.log("\nPause/Unpause Events:");
        [...pauseEvents, ...unpauseEvents].sort((a, b) => a.blockNumber - b.blockNumber).forEach(event => {
          const eventType = event.fragment.name === "MigrationPaused" ? "Paused" : "Unpaused";
          console.log(`${eventType} by: ${event.args.pauser}`);
        });
      }
    } catch (error) {
      console.log(chalk.red("❌ Failed to fetch events"));
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