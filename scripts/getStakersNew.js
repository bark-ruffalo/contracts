const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Parse command line arguments
const SKIP_INCOME_CALC = process.argv.includes("--nocalc");
const TOTAL_INCOME_USD = SKIP_INCOME_CALC ? 0 : 27700; // Only set if not skipping calcs

// Base network configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL;
if (!BASE_RPC_URL) {
  throw new Error("BASE_RPC_URL not found in .env file");
}

const STAKING_VAULT_ADDRESS = "0xcdb42f68A2Da339cB6fEEfA08B96359b0Bf2736F";
const REQUEST_DELAY_MS = 50; // Delay between RPC requests

// Pool configurations
const POOL_TOKENS = {
  0: "$mPAWSY", // This vault only has mPAWSY pool at index 0
  1: "$PAWSY", // Legacy reference
  2: "LP $PAWSY/$VIRTUAL", // Legacy reference
};

const POOL_MODIFIERS = {
  0: 1.0, // $PAWSY: no modifier
  1: 1.0, // $mPAWSY: no modifier (simplified calculation)
  2: 1.0, // LP: no modifier (simplified calculation)
};

// Helper function to add delay between requests
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fun titles for stakers based on amount
function getStakerTitle(amount) {
  const amountNum = Number(ethers.formatUnits(amount, 18));
  if (amountNum >= 50000) return "🐋 Whale Boss";
  if (amountNum >= 20000) return "🦈 Shark";
  if (amountNum >= 10000) return "🦍 Gorilla";
  return "🦊 Fox";
}

// Get token name for pool
function getPoolTokenName(poolId) {
  return POOL_TOKENS[poolId] || `Pool ${poolId} Token`;
}

// Calculate adjusted value for a pool
function getAdjustedValue(amount, poolId) {
  const modifier = POOL_MODIFIERS[poolId] || 1.0;
  return Number(ethers.formatUnits(amount, 18)) * modifier;
}

// Calculate income share based on permille
function calculateIncomeShare(permille) {
  return (permille * TOTAL_INCOME_USD) / 1000;
}

// Format USD amount
function formatUSD(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Parse command line arguments for simulation
function getSimulatedAmounts() {
  const simulateArg = process.argv.find(arg => arg.startsWith("--simulate="));
  if (!simulateArg) return [];
  return simulateArg.split("=")[1].split(",").map(Number);
}

// Filter pool stakes to only include significant amounts (>= 10)
function filterSignificantStakes(poolStakes) {
  const minAmount = ethers.parseUnits("10", 18);
  return Object.fromEntries(Object.entries(poolStakes).filter(([_, amount]) => amount >= minAmount));
}

// Import the ABI from the deployment file
const STAKING_VAULT_ABI = [
  {
    inputs: [],
    name: "getTotalLockedUsers",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "lockedUsers",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getActiveStakedBalance",
    outputs: [{ internalType: "uint256", name: "totalStaked", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserLocks",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "lockId", type: "uint256" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "uint256", name: "lockPeriod", type: "uint256" },
          { internalType: "uint256", name: "unlockTime", type: "uint256" },
          { internalType: "uint256", name: "lastClaimTime", type: "uint256" },
          { internalType: "uint256", name: "poolId", type: "uint256" },
          { internalType: "bool", name: "isLocked", type: "bool" },
        ],
        internalType: "struct StakingVault.LockInfo[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

// Constants
const DAO_ADDRESS = "0xCfdc7f77c37268c14293ebD466768F6068D99461".toLowerCase();
const NEBU_SHARE_PERCENTAGE = 15; // Nebu gets 15% share as project developer

async function main() {
  console.log("🔍 PAWSY STAKING LEADERBOARD 🎮\n");

  console.log("Simplified Calculation (mPAWSY pool only):");
  console.log("- Only mPAWSY stakes are considered for income distribution");
  console.log("- No modifiers applied to any pools");
  console.log(`- Nebu (${DAO_ADDRESS}) gets fixed ${NEBU_SHARE_PERCENTAGE}% share`);
  console.log("- Other users split remaining 85% based on mPAWSY stake\n");
  console.log("Loading stakers... grab a 🦴 while you wait\n");

  // Initialize provider
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  const stakingVault = new ethers.Contract(STAKING_VAULT_ADDRESS, STAKING_VAULT_ABI, provider);

  // Get total number of locked users
  const totalLockedUsers = await stakingVault.getTotalLockedUsers();
  console.log(`🔍 Sniffing through ${totalLockedUsers} wallets...\n`);

  const highStakers = [];
  let totalStaked = 0n;

  // Calculate total adjusted value for a staker
  function calculateAdjustedTotal(poolStakes) {
    return Object.entries(poolStakes).reduce((total, [poolId, amount]) => {
      return total + getAdjustedValue(amount, Number(poolId));
    }, 0);
  }

  // Get all locked users addresses and calculate total staked
  for (let i = 0; i < totalLockedUsers; i++) {
    // Get user address and normalize to lowercase
    const user = (await stakingVault.lockedUsers(i)).toLowerCase();
    await delay(REQUEST_DELAY_MS);

    // Check balance
    const stakedBalance = await stakingVault.getActiveStakedBalance(user);

    // Get user's locks
    const locks = await stakingVault.getUserLocks(user);
    await delay(REQUEST_DELAY_MS);

    const activeLocks = locks.filter(lock => lock.isLocked);

    // Calculate total staked from active locks
    const poolStakes = {};
    activeLocks.forEach(lock => {
      const poolId = Number(lock.poolId);
      if (!poolStakes[poolId]) {
        poolStakes[poolId] = 0n;
      }
      poolStakes[poolId] += lock.amount;
    });

    // Calculate total balance from pool stakes
    const calculatedBalance = Object.values(poolStakes).reduce((sum, amount) => sum + amount, 0n);
    totalStaked += calculatedBalance;

    // Check if user has significant mPAWSY stake (pool 0)
    const mpawsyStake = poolStakes[0] || 0n;
    const mpawsyThreshold = ethers.parseUnits("5000", 18); // Same threshold but for mPAWSY specifically

    if (mpawsyStake >= mpawsyThreshold || user === DAO_ADDRESS) {
      const formattedAmount = ethers.formatUnits(mpawsyStake, 18);

      // Filter out insignificant stakes
      const significantStakes = filterSignificantStakes(poolStakes);

      highStakers.push({
        address: user,
        balance: calculatedBalance,
        title: getStakerTitle(mpawsyStake), // Use mPAWSY stake for title
        poolStakes: significantStakes,
      });

      console.log(`\n🎯 Found a ${getStakerTitle(mpawsyStake)}: ${user}`);
      console.log(`   mPAWSY staked: ${formattedAmount}`);
      if (Object.keys(significantStakes).length > 0) {
        console.log("   Stakes by pool:");
        Object.entries(significantStakes).forEach(([poolId, amount]) => {
          console.log(`   - Pool ${poolId} (${getPoolTokenName(poolId)}): ${ethers.formatUnits(amount, 18)}`);
        });
      }
    }
  }

  // Add simulated stakers if specified
  const simulatedAmounts = getSimulatedAmounts();
  if (simulatedAmounts.length > 0) {
    simulatedAmounts.forEach((amount, index) => {
      const simulatedBalance = ethers.parseUnits(amount.toString(), 18);
      totalStaked += simulatedBalance;
      const mpawsyThreshold = ethers.parseUnits("5000", 18);
      if (simulatedBalance >= mpawsyThreshold) {
        const simulatedAddress = `0xSIM${index + 1}${"0".repeat(37)}`;
        // For simulated stakers, put everything in pool 0 (mPAWSY)
        const poolStakes = { 0: simulatedBalance };
        highStakers.push({
          address: simulatedAddress,
          balance: simulatedBalance,
          title: getStakerTitle(simulatedBalance),
          poolStakes,
        });
        console.log(`\n🎯 Added simulated ${getStakerTitle(simulatedBalance)}: ${simulatedAddress}`);
        console.log(`   mPAWSY staked: ${amount}`);
        console.log("   Stakes by pool:");
        console.log(`   - Pool 0 (${getPoolTokenName(0)}): ${amount} (simulated)`);
      }
    });
  }

  // Calculate per mills based only on mPAWSY stake (pool 0) and sort by balance descending
  highStakers.forEach(staker => {
    // Use only pool 0 (mPAWSY) stake for calculations, no modifiers
    const mpawsyStake = staker.poolStakes[0] || 0n;
    staker.mpawsyStake = mpawsyStake;
    staker.mpawsyStakeNum = Number(ethers.formatUnits(mpawsyStake, 18));
  });
  highStakers.sort((a, b) => (b.mpawsyStake > a.mpawsyStake ? 1 : -1));

  // Print results with simplified mPAWSY-only calculation
  console.log("\n🏆 FINAL LEADERBOARD 🏆");
  console.log("=======================");
  console.log(`\n💰 Total Raw Staked: ${ethers.formatUnits(totalStaked, 18)}\n`);

  if (highStakers.length === 0) {
    console.log("😢 No big stakers found... everyone's a smol pup today!");
  } else {
    // Calculate total mPAWSY staked (excluding Nebu since he gets fixed share)
    const totalMpawsyStaked = highStakers.reduce((sum, staker) => {
      if (staker.address.toLowerCase() !== DAO_ADDRESS) {
        return sum + staker.mpawsyStakeNum;
      }
      return sum;
    }, 0);

    console.log(`Total mPAWSY staked (excluding Nebu): ${totalMpawsyStaked.toFixed(2)}\n`);

    // Calculate income shares for each staker
    const stakersWithShares = highStakers.map(staker => {
      let incomeShare = 0;
      let percentage = 0;

      if (staker.address.toLowerCase() === DAO_ADDRESS) {
        // Nebu gets fixed 15% share
        incomeShare = (NEBU_SHARE_PERCENTAGE / 100) * TOTAL_INCOME_USD;
        percentage = NEBU_SHARE_PERCENTAGE;
      } else {
        // Others get proportional share of remaining 85%
        const remainingPercentage = 100 - NEBU_SHARE_PERCENTAGE;
        const stakerShareOfRemaining = staker.mpawsyStakeNum / totalMpawsyStaked;
        percentage = remainingPercentage * stakerShareOfRemaining;
        incomeShare = (percentage / 100) * TOTAL_INCOME_USD;
      }

      return {
        ...staker,
        incomeShare,
        percentage,
      };
    });

    // Show simplified calculation (mPAWSY only, no modifiers)
    console.log("Income Shares (mPAWSY stake only, no modifiers):");
    console.log("------------------------------------------------");
    stakersWithShares.forEach(staker => {
      console.log(`\n${staker.address}:`);
      console.log(`mPAWSY staked: ${staker.mpawsyStakeNum.toFixed(2)}`);

      if (staker.address.toLowerCase() === DAO_ADDRESS) {
        console.log(`Share: Fixed ${NEBU_SHARE_PERCENTAGE}% (developer share)`);
      } else {
        const remainingPercentage = 100 - NEBU_SHARE_PERCENTAGE;
        const stakerShareOfRemaining = (staker.mpawsyStakeNum / totalMpawsyStaked) * 100;
        console.log(`Share of remaining ${remainingPercentage}%: ${stakerShareOfRemaining.toFixed(4)}%`);
        console.log(`Total share: ${staker.percentage.toFixed(4)}%`);
      }

      if (!SKIP_INCOME_CALC) {
        console.log(`Income: ${formatUSD(staker.incomeShare)}`);
      }
    });

    // Show income distribution summary only if not skipping calculations
    if (!SKIP_INCOME_CALC) {
      console.log("\n💰 Income Distribution Summary:");
      console.log("-----------------------------");
      console.log(`Total to distribute: ${formatUSD(TOTAL_INCOME_USD)}`);
      let totalDistributed = 0;
      stakersWithShares.forEach(staker => {
        totalDistributed += staker.incomeShare;
        console.log(`${staker.address}:`);
        console.log(`  Share: ${formatUSD(staker.incomeShare)} (${staker.percentage.toFixed(2)}%)`);
      });
      console.log(`\nTotal distributed: ${formatUSD(totalDistributed)}`);
    }

    // Show final percentage summary table
    console.log("\n📊 Final Income Distribution:");
    console.log("-----------------------------");
    console.log("Address                                      | mPAWSY Stake | Percentage");
    console.log("-------------------------------------------|-------------|-----------");
    stakersWithShares.forEach(staker => {
      const paddedAddress = staker.address.padEnd(43, " ");
      const paddedStake = staker.mpawsyStakeNum.toFixed(2).padStart(11, " ");
      const paddedPercentage = staker.percentage.toFixed(4).padStart(9, " ");
      console.log(`${paddedAddress}| ${paddedStake} | ${paddedPercentage}%`);
    });
    console.log("-------------------------------------------|-------------|-----------");
    const totalPercentage = stakersWithShares.reduce((sum, staker) => sum + staker.percentage, 0);
    const totalStake = totalMpawsyStaked;
    const paddedTotal = "TOTAL".padEnd(43, " ");
    const paddedTotalStake = totalStake.toFixed(2).padStart(11, " ");
    const paddedTotalPercentage = totalPercentage.toFixed(4).padStart(9, " ");
    console.log(`${paddedTotal}| ${paddedTotalStake} | ${paddedTotalPercentage}%`);
  }

  // Save results to JSON file only if not simulating
  if (simulatedAmounts.length === 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Calculate total mPAWSY staked for JSON (excluding Nebu for proportional calculation)
    const totalMpawsyStaked = highStakers.reduce((sum, staker) => {
      if (staker.address.toLowerCase() !== DAO_ADDRESS) {
        return sum + staker.mpawsyStakeNum;
      }
      return sum;
    }, 0);

    // For the JSON format, we need to simulate the old format with adjusted values
    // Since we have no modifiers, adjusted = raw
    let stakersWithAdjusted = highStakers.map(staker => {
      // Others get proportional share of remaining 85% = 850 per mill total
      const remainingPerMill = (100 - NEBU_SHARE_PERCENTAGE) * 10;
      const stakerShareOfRemaining = staker.mpawsyStakeNum / totalMpawsyStaked;
      const adjustedPerMill = remainingPerMill * stakerShareOfRemaining;

      return {
        ...staker,
        adjustedTotal: parseFloat(staker.mpawsyStakeNum.toFixed(6)), // No modifiers, so same as raw
        adjustedPerMill: adjustedPerMill,
        rawPerMill: adjustedPerMill, // Same since no modifiers
      };
    });

    // Add Nebu with his fixed share if he's not already in the list
    const nebuExists = stakersWithAdjusted.some(staker => staker.address.toLowerCase() === DAO_ADDRESS);
    if (!nebuExists) {
      // We need to get Nebu's actual stake amount
      // Find Nebu in the original highStakers list or add him with 0 stake
      let nebuStake = 0;
      const nebuStaker = highStakers.find(staker => staker.address.toLowerCase() === DAO_ADDRESS);
      if (nebuStaker) {
        nebuStake = nebuStaker.mpawsyStakeNum;
      }

      stakersWithAdjusted.push({
        address: DAO_ADDRESS,
        balance: 0n, // Not used in new logic
        title: "Developer", // Custom title for Nebu
        poolStakes: nebuStaker ? nebuStaker.poolStakes : {},
        mpawsyStake: 0n, // Not used in new logic
        mpawsyStakeNum: nebuStake,
        adjustedTotal: parseFloat(nebuStake.toFixed(6)),
        adjustedPerMill: NEBU_SHARE_PERCENTAGE * 10, // 15% = 150 per mill
        rawPerMill: NEBU_SHARE_PERCENTAGE * 10,
      });
    } else {
      // If Nebu is already in the list, update his adjustedPerMill
      const nebuIndex = stakersWithAdjusted.findIndex(staker => staker.address.toLowerCase() === DAO_ADDRESS);
      stakersWithAdjusted[nebuIndex].adjustedPerMill = NEBU_SHARE_PERCENTAGE * 10;
      stakersWithAdjusted[nebuIndex].rawPerMill = NEBU_SHARE_PERCENTAGE * 10;
    }

    const totalAdjusted = totalMpawsyStaked; // No modifiers applied

    const jsonData = {
      timestamp,
      totalStaked: ethers.formatUnits(totalStaked, 18),
      totalAdjustedStaked: totalAdjusted.toFixed(2),
      stakers: stakersWithAdjusted.map(staker => ({
        address: staker.address,
        rawHoldings: staker.mpawsyStakeNum.toFixed(6), // Use higher precision like old format
        rawPerMill: staker.rawPerMill.toFixed(4),
        adjustedTotal: staker.adjustedTotal.toFixed(2),
        adjustedPerMill: staker.adjustedPerMill.toFixed(4),
        poolStakes: Object.fromEntries(
          Object.entries(staker.poolStakes).map(([poolId, amount]) => [
            `${poolId} (${getPoolTokenName(poolId)})`,
            {
              raw: ethers.formatUnits(amount, 18),
              adjusted: ethers.formatUnits(amount, 18), // No modifiers, so same as raw
              modifier: POOL_MODIFIERS[poolId] || 1.0,
            },
          ]),
        ),
      })),
    };

    const fileName = path.join(__dirname, `staking-snapshot-${timestamp}.json`);
    fs.writeFileSync(fileName, JSON.stringify(jsonData, null, 2));
    console.log(`\n📝 Results saved to: ${path.basename(fileName)}`);
  }

  console.log("\n🎉 That's all folks! Keep staking! 🚀");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("\n❌ Ruh roh! Error:", error);
    process.exit(1);
  });
