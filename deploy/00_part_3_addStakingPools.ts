import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

/**
 * Part 3 of the staking system deployment
 * This script:
 * 1. Calculates staking rates based on target Simple Interest Rates (SIR)
 * 2. Adds staking pools to the StakingVault for different tokens
 * 
 * Each pool has different timelock periods and reward rates
 */

// Constants for staking configuration
const YEAR_IN_SECONDS = 365.2425 * 24 * 60 * 60;
// Timelock periods in seconds (50 days, 100 days, 200 days, 400 days)
const TIMELOCK_PERIODS = [50 * 24 * 60 * 60, 100 * 24 * 60 * 60, 200 * 24 * 60 * 60, 400 * 24 * 60 * 60];

/**
 * Calculate interest rates based on Simple Interest Rate targets for each timelock period
 * Formula: Rate = (Target SIR % / 100) * (Lock Period / Year in Seconds) * 10000
 * 
 * @param targetSIRs Array of target Simple Interest Rates in percentage
 * @returns Array of calculated rates for the contract
 */
function calculateRates(targetSIRs: number[]): number[] {
  return targetSIRs.map((sir, index) => Math.round((sir / 100) * (TIMELOCK_PERIODS[index] / YEAR_IN_SECONDS) * 10000));
}

/**
 * Display the calculated Simple Interest Rates for each timelock period
 * This helps verify that the rates match the expected annual yields
 * 
 * @param name Token name for display purposes
 * @param rates The calculated contract rates
 * @param targetSIRs The target SIR percentages
 */
function displaySIRCalculations(name: string, rates: readonly number[], targetSIRs: number[]): void {
  console.log(`\n📊 ${name} Staking Simple Interest Rate Calculations:`);
  TIMELOCK_PERIODS.forEach((period, index) => {
    const daysInPeriod = period / (24 * 60 * 60);
    const rate = rates[index];
    const targetSIR = targetSIRs[index];

    // Calculate period rate (e.g., 1% for 50 days)
    const periodRate = rate / 10000; // Convert from basis points

    // Calculate how many full periods in a year
    const periodsPerYear = YEAR_IN_SECONDS / period;

    // Simple interest formula: rate per period * periods per year
    const actualSIR = periodRate * periodsPerYear * 100;

    console.log(`   ${daysInPeriod} days lock:`);
    console.log(`     Target SIR: ${targetSIR}%`);
    console.log(`     Rate to use in contract: ${rate}`);
    console.log(`     Actual SIR: ${actualSIR.toFixed(2)}%`);
    console.log(`     Rate per period: ${(rate / 100).toFixed(2)}%`);
  });
}

const addStakingPools: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get } = deployments;
  
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
  console.log(`\n📡 Adding staking pools on ${network} as ${deployer}...\n`);

  // Get token addresses from environment or use defaults
  // These are the tokens that can be staked in the StakingVault
  const PAWSY_TOKEN = process.env.PAWSY_TOKEN || "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a";
  const mPAWSY_TOKEN = process.env.mPAWSY_TOKEN || "0x1437819DF58Ad648e35ED4f6F642d992684B2004";
  const LP_TOKEN = process.env.LP_TOKEN || "0x96fc64cae162c1cb288791280c3eff2255c330a8";

  // Warn if using default addresses on production networks
  if (network !== "localhost" && network !== "hardhat") {
    if (!process.env.PAWSY_TOKEN) {
      console.warn("⚠️ PAWSY_TOKEN environment variable not set! Using default address. Set this in .env file for production.");
    }
    if (!process.env.mPAWSY_TOKEN) {
      console.warn("⚠️ mPAWSY_TOKEN environment variable not set! Using default address. Set this in .env file for production.");
    }
    if (!process.env.LP_TOKEN) {
      console.warn("⚠️ LP_TOKEN environment variable not set! Using default address. Set this in .env file for production.");
    }
  }

  // Target Simple Interest Rates for each token and timelock period
  const PAWSY_TARGET_SIRS = [1, 2, 3, 4]; // Target SIRs in percentage
  const mPAWSY_TARGET_SIRS = [5, 6, 7, 8]; // Target SIRs in percentage
  const LP_TARGET_SIRS = [9, 10, 11, 12]; // Target SIRs in percentage

  // Calculate rates for each token based on SIR targets
  const PAWSY_RATES = calculateRates(PAWSY_TARGET_SIRS);
  const mPAWSY_RATES = calculateRates(mPAWSY_TARGET_SIRS);
  const LP_RATES = calculateRates(LP_TARGET_SIRS);

  // Display the calculated rates
  console.log("\nPAWSY_RATES:", PAWSY_RATES);
  console.log("mPAWSY_RATES:", mPAWSY_RATES);
  console.log("LP_RATES:", LP_RATES);

  // Display detailed SIR calculations
  displaySIRCalculations("PAWSY", PAWSY_RATES, PAWSY_TARGET_SIRS);
  displaySIRCalculations("mPAWSY", mPAWSY_RATES, mPAWSY_TARGET_SIRS);
  displaySIRCalculations("LP", LP_RATES, LP_TARGET_SIRS);

  // Get the StakingVault contract that was deployed in part 2
  let stakingVaultDeployment;
  try {
    stakingVaultDeployment = await get("StakingVault");
    console.log(`Found StakingVault at: ${stakingVaultDeployment.address}`);
  } catch (error) {
    throw new Error("StakingVault not deployed yet. Please run the 00_part_2_deployStakingVault script first.");
  }

  const stakingVault = await ethers.getContractAt("StakingVault", stakingVaultDeployment.address);

  // Convert readonly arrays to regular arrays for contract interaction
  const lockPeriods = [...TIMELOCK_PERIODS];
  const pawsyRates = [...PAWSY_RATES];
  const mPawsyRates = [...mPAWSY_RATES];
  const lpRates = [...LP_RATES];

  // Add the staking pools with proper error handling
  console.log("\n🏊 Adding pools to StakingVault...\n");

  // Add PAWSY pool
  try {
    console.log(`Adding PAWSY pool (${PAWSY_TOKEN})...`);
    const tx = await stakingVault.addPool(PAWSY_TOKEN, lockPeriods, pawsyRates);
    await tx.wait(network === "localhost" || network === "hardhat" ? 1 : 5);
    console.log("✅ PAWSY pool added");
  } catch (error) {
    // If the error contains "Pool already exists", it's not a critical error
    if (error instanceof Error && error.message.includes("Pool already exists")) {
      console.log("⚠️ PAWSY pool already exists, skipping");
    } else {
      console.error("❌ Failed to add PAWSY pool:", error);
      // Don't throw error, allow other pools to be added
    }
  }

  // Add mPAWSY pool
  try {
    console.log(`Adding mPAWSY pool (${mPAWSY_TOKEN})...`);
    const tx = await stakingVault.addPool(mPAWSY_TOKEN, lockPeriods, mPawsyRates);
    await tx.wait(network === "localhost" || network === "hardhat" ? 1 : 5);
    console.log("✅ mPAWSY pool added");
  } catch (error) {
    // If the error contains "Pool already exists", it's not a critical error
    if (error instanceof Error && error.message.includes("Pool already exists")) {
      console.log("⚠️ mPAWSY pool already exists, skipping");
    } else {
      console.error("❌ Failed to add mPAWSY pool:", error);
    }
  }

  // Add LP pool
  try {
    console.log(`Adding LP pool (${LP_TOKEN})...`);
    const tx = await stakingVault.addPool(LP_TOKEN, lockPeriods, lpRates);
    await tx.wait(network === "localhost" || network === "hardhat" ? 1 : 5);
    console.log("✅ LP pool added");
  } catch (error) {
    // If the error contains "Pool already exists", it's not a critical error
    if (error instanceof Error && error.message.includes("Pool already exists")) {
      console.log("⚠️ LP pool already exists, skipping");
    } else {
      console.error("❌ Failed to add LP pool:", error);
    }
  }

  console.log("\n✅ Staking pool initialization completed");
  console.log("\n🔍 You can now interact with the StakingVault at:", stakingVaultDeployment.address);
};

export default addStakingPools;
addStakingPools.tags = ["StakingPools"];
// This script depends on the StakingVault being already deployed
addStakingPools.dependencies = ["StakingVault"]; 