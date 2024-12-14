import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { verifyContract } from "../utils/verification";

const YEAR_IN_SECONDS = 365.2425 * 24 * 60 * 60;
const TIMELOCK_PERIODS = [50 * 24 * 60 * 60, 100 * 24 * 60 * 60, 200 * 24 * 60 * 60, 400 * 24 * 60 * 60];

// Move addresses to config file or env variables
const PAWSY_TOKEN = process.env.PAWSY_TOKEN || "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a";
const mPAWSY_TOKEN = process.env.mPAWSY_TOKEN || "0x1437819DF58Ad648e35ED4f6F642d992684B2004";
const LP_TOKEN = process.env.LP_TOKEN || "0x96fc64cae162c1cb288791280c3eff2255c330a8";

// Calculate rates for PAWSY
const PAWSY_TARGET_SIRS = [1, 2, 3, 4]; // Target SIRs in percentage
const PAWSY_RATES = PAWSY_TARGET_SIRS.map((sir, index) => {
  const period = TIMELOCK_PERIODS[index];
  return Math.round((sir / 100) * (period / YEAR_IN_SECONDS) * 10000);
});

// Calculate rates for mPAWSY
const mPAWSY_TARGET_SIRS = [5, 6, 7, 8]; // Target SIRs in percentage
const mPAWSY_RATES = mPAWSY_TARGET_SIRS.map((sir, index) => {
  const period = TIMELOCK_PERIODS[index];
  return Math.round((sir / 100) * (period / YEAR_IN_SECONDS) * 10000);
});

// Calculate rates for LP
const LP_TARGET_SIRS = [9, 10, 11, 12]; // Target SIRs in percentage
const LP_RATES = LP_TARGET_SIRS.map((sir, index) => {
  const period = TIMELOCK_PERIODS[index];
  return Math.round((sir / 100) * (period / YEAR_IN_SECONDS) * 10000);
});

console.log("PAWSY_RATES:", PAWSY_RATES);
console.log("mPAWSY_RATES:", mPAWSY_RATES);
console.log("LP_RATES:", LP_RATES);

// Calculate and display yearly SIR for each timelock period
function calculateAndDisplaySIR(name: string, rates: readonly number[]) {
  console.log(`\n📊 ${name} Staking Simple Interest Rate Calculations:`);
  TIMELOCK_PERIODS.forEach((period, index) => {
    const daysInPeriod = period / (24 * 60 * 60);
    const rate = rates[index];
    const YEAR_IN_SECONDS = 365.2425 * 24 * 60 * 60;

    // Calculate period rate (e.g., 1% for 50 days)
    const periodRate = rate / 10000; // Convert from basis points

    // Calculate how many full periods in a year
    const periodsPerYear = YEAR_IN_SECONDS / period;

    // Simple interest formula: rate per period * periods per year
    const sir = periodRate * periodsPerYear * 100;

    console.log(`   ${daysInPeriod} days lock: ${sir.toFixed(2)}% SIR (${rate / 100}% per period)`);
  });
}

const deployStaking: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  
  // Get deployer address either from named accounts or ledger
  let deployer: string;
  try {
    ({ deployer } = await getNamedAccounts());
  } catch (error) {
    // If using ledger, get the first ledger account
    const network = hre.network.config;
    if (network.ledgerAccounts && network.ledgerAccounts.length > 0) {
      deployer = network.ledgerAccounts[0];
    } else {
      throw new Error("No deployer account available");
    }
  }

  const network = hre.network.name;
  console.log(`\n📡 Deploying staking contracts to ${network}...\n`);

  // Display SIR calculations
  calculateAndDisplaySIR("PAWSY", PAWSY_RATES);
  calculateAndDisplaySIR("mPAWSY", mPAWSY_RATES);
  calculateAndDisplaySIR("LP", LP_RATES);

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

    // Convert readonly arrays to regular arrays for contract interaction
    const lockPeriods = [...TIMELOCK_PERIODS];
    const pawsyRates = [...PAWSY_RATES];
    const mPawsyRates = [...mPAWSY_RATES];
    const lpRates = [...LP_RATES];

    const addPawsyPool = await stakingVault.addPool(PAWSY_TOKEN, lockPeriods, pawsyRates);
    await addPawsyPool.wait(network === "localhost" ? 1 : 5);
    console.log("✅ PAWSY pool added");

    const addMpawsyPool = await stakingVault.addPool(mPAWSY_TOKEN, lockPeriods, mPawsyRates);
    await addMpawsyPool.wait(network === "localhost" ? 1 : 5);
    console.log("✅ mPAWSY pool added");

    const addLpPool = await stakingVault.addPool(LP_TOKEN, lockPeriods, lpRates);
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
