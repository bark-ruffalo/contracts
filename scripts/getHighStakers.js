const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Parse command line arguments
const SKIP_INCOME_CALC = process.argv.includes('--nocalc');
const TOTAL_INCOME_USD = SKIP_INCOME_CALC ? 0 : 27700;  // Only set if not skipping calcs

// Base network configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL;
if (!BASE_RPC_URL) {
  throw new Error("BASE_RPC_URL not found in .env file");
}

const STAKING_VAULT_ADDRESS = "0xA6FaCD417faf801107bF19F4a24062Ff15AE9C61";
const REQUEST_DELAY_MS = 50;  // Delay between RPC requests

// Pool configurations
const POOL_TOKENS = {
  0: "$PAWSY",
  1: "$mPAWSY",
  2: "LP $PAWSY/$VIRTUAL"
};

const POOL_MODIFIERS = {
  0: 1.0,      // $PAWSY: no modifier
  1: 1.1,      // $mPAWSY: 10% bonus
  2: 93.69     // LP: conversion rate to $PAWSY
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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

// Parse command line arguments for simulation
function getSimulatedAmounts() {
  const simulateArg = process.argv.find(arg => arg.startsWith('--simulate='));
  if (!simulateArg) return [];
  return simulateArg.split('=')[1].split(',').map(Number);
}

// Filter pool stakes to only include significant amounts (>= 10)
function filterSignificantStakes(poolStakes) {
  const minAmount = ethers.parseUnits("10", 18);
  return Object.fromEntries(
    Object.entries(poolStakes)
      .filter(([_, amount]) => amount >= minAmount)
  );
}

// Import the ABI from the deployment file
const STAKING_VAULT_ABI = [
  {
    "inputs": [],
    "name": "getTotalLockedUsers",
    "outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256","name": "","type": "uint256"}],
    "name": "lockedUsers",
    "outputs": [{"internalType": "address","name": "","type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address","name": "user","type": "address"}],
    "name": "getActiveStakedBalance",
    "outputs": [{"internalType": "uint256","name": "totalStaked","type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address","name": "user","type": "address"}],
    "name": "getUserLocks",
    "outputs": [{
      "components": [
        {"internalType": "uint256","name": "lockId","type": "uint256"},
        {"internalType": "uint256","name": "amount","type": "uint256"},
        {"internalType": "uint256","name": "lockPeriod","type": "uint256"},
        {"internalType": "uint256","name": "unlockTime","type": "uint256"},
        {"internalType": "uint256","name": "lastClaimTime","type": "uint256"},
        {"internalType": "uint256","name": "poolId","type": "uint256"},
        {"internalType": "bool","name": "isLocked","type": "bool"}
      ],
      "internalType": "struct StakingVault.LockInfo[]",
      "name": "",
      "type": "tuple[]"
    }],
    "stateMutability": "view",
    "type": "function"
  }
];

// Constants
const DAO_ADDRESS = "0xCfdc7f77c37268c14293ebD466768F6068D99461";
const IGNORED_POOL = 1;  // Only ignore pool 1 for DAO address

async function main() {
  console.log("🔍 PAWSY STAKING LEADERBOARD 🎮\n");
  
  console.log("Value Modifiers Applied:");
  console.log("- Pool 0 ($PAWSY): 1x (base value)");
  console.log("- Pool 1 ($mPAWSY): 1.1x (10% bonus)");
  console.log("- Pool 2 (LP): 93.69x (LP conversion rate)\n");
  console.log("Loading stakers... grab a 🦴 while you wait\n");

  // Initialize provider
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  const stakingVault = new ethers.Contract(
    STAKING_VAULT_ADDRESS,
    STAKING_VAULT_ABI,
    provider
  );

  // Get total number of locked users
  const totalLockedUsers = await stakingVault.getTotalLockedUsers();
  console.log(`🔍 Sniffing through ${totalLockedUsers} wallets...\n`);

  const threshold = ethers.parseUnits("5000", 18);
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
    // Get user address
    const user = await stakingVault.lockedUsers(i);
    await delay(REQUEST_DELAY_MS);

    // Check balance
    const stakedBalance = await stakingVault.getActiveStakedBalance(user);
    
    // Get user's locks
    const locks = await stakingVault.getUserLocks(user);
    await delay(REQUEST_DELAY_MS);
    
    const activeLocks = locks.filter(lock => {
      // For DAO address, ignore only pool 1
      if (user.toLowerCase() === DAO_ADDRESS.toLowerCase()) {
        return lock.isLocked && Number(lock.poolId) !== IGNORED_POOL;
      }
      return lock.isLocked;
    });

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
    
    if (calculatedBalance >= threshold) {
      const formattedAmount = ethers.formatUnits(calculatedBalance, 18);

      // Filter out insignificant stakes
      const significantStakes = filterSignificantStakes(poolStakes);

      highStakers.push({
        address: user,
        balance: calculatedBalance,
        title: getStakerTitle(calculatedBalance),
        poolStakes: significantStakes
      });

      console.log(`\n🎯 Found a ${getStakerTitle(calculatedBalance)}: ${user}`);
      console.log(`   Total staked: ${formattedAmount}`);
      if (Object.keys(significantStakes).length > 0) {
        console.log('   Stakes by pool:');
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
      if (simulatedBalance >= threshold) {
        const simulatedAddress = `0xSIM${index + 1}${'0'.repeat(37)}`;
        // For simulated stakers, put everything in pool 0
        const poolStakes = { 0: simulatedBalance };
        highStakers.push({
          address: simulatedAddress,
          balance: simulatedBalance,
          title: getStakerTitle(simulatedBalance),
          poolStakes
        });
        console.log(`\n🎯 Added simulated ${getStakerTitle(simulatedBalance)}: ${simulatedAddress}`);
        console.log(`   Total staked: ${amount}`);
        console.log('   Stakes by pool:');
        console.log(`   - Pool 0 (${getPoolTokenName(0)}): ${amount} (simulated)`);
      }
    });
  }

  // Calculate permilles (parts per thousand) and sort by balance descending
  highStakers.forEach(staker => {
    // Convert to number for precise division
    const balance = Number(ethers.formatUnits(staker.balance, 18));
    const total = Number(ethers.formatUnits(totalStaked, 18));
    staker.permille = (balance / total) * 1000;
  });
  highStakers.sort((a, b) => b.balance > a.balance ? 1 : -1);

  // Print results with both raw and adjusted values
  console.log("\n🏆 FINAL LEADERBOARD 🏆");
  console.log("=======================");
  console.log(`\n💰 Total Raw Staked: ${ethers.formatUnits(totalStaked, 18)}\n`);
  
  if (highStakers.length === 0) {
    console.log("😢 No big stakers found... everyone's a smol pup today!");
  } else {
    // Calculate adjusted totals and sort by them
    const stakersWithAdjusted = highStakers.map(staker => ({
      ...staker,
      adjustedTotal: calculateAdjustedTotal(staker.poolStakes)
    }));

    const totalAdjusted = stakersWithAdjusted.reduce((sum, staker) => sum + staker.adjustedTotal, 0);
    
    // Sort by adjusted total
    stakersWithAdjusted.sort((a, b) => b.adjustedTotal - a.adjustedTotal);

    // Show adjusted values
    console.log("Adjusted Values (with modifiers applied):");
    console.log("----------------------------------------");
    stakersWithAdjusted.forEach(staker => {
      const adjustedPermille = (staker.adjustedTotal / totalAdjusted) * 1000;
      
      console.log(`\n${staker.address}:`);
      console.log(`Raw total: ${ethers.formatUnits(staker.balance, 18)}`);
      
      // Show calculation for each pool
      if (Object.keys(staker.poolStakes).length > 0) {
        console.log('Calculation breakdown:');
        let totalAdjusted = 0;
        Object.entries(staker.poolStakes).forEach(([poolId, amount]) => {
          const rawAmount = Number(ethers.formatUnits(amount, 18));
          const modifier = POOL_MODIFIERS[poolId] || 1.0;
          const adjustedAmount = rawAmount * modifier;
          totalAdjusted += adjustedAmount;
          
          console.log(`  Pool ${poolId} (${getPoolTokenName(poolId)}):`);
          console.log(`    ${rawAmount.toFixed(2)} × ${modifier}x = ${adjustedAmount.toFixed(2)}`);
        });
        console.log(`  Total adjusted value: ${totalAdjusted.toFixed(2)}`);
      }
      
      console.log(`Final share: ${adjustedPermille.toFixed(4)}‰${!SKIP_INCOME_CALC ? ` = ${formatUSD(calculateIncomeShare(adjustedPermille))}` : ''}`);
    });

    // Show income distribution summary only if not skipping calculations
    if (!SKIP_INCOME_CALC) {
      console.log("\n💰 Income Distribution Summary:");
      console.log("-----------------------------");
      console.log(`Total to distribute: ${formatUSD(TOTAL_INCOME_USD)}`);
      let totalDistributed = 0;
      stakersWithAdjusted.forEach(staker => {
        const adjustedPermille = (staker.adjustedTotal / totalAdjusted) * 1000;
        const incomeShare = calculateIncomeShare(adjustedPermille);
        totalDistributed += incomeShare;
        const percentage = (incomeShare / TOTAL_INCOME_USD) * 100;
        console.log(`${staker.address}:`);
        console.log(`  Share: ${formatUSD(incomeShare)} (${percentage.toFixed(2)}%)`);
      });
      console.log(`\nTotal distributed: ${formatUSD(totalDistributed)}`);
    }

    // Show final permille summary table
    console.log("\n📊 Final Permille Distribution:");
    console.log("-----------------------------");
    console.log("Address                                      | Adjusted Value | Permille (‰)");
    console.log("-------------------------------------------|---------------|-------------");
    stakersWithAdjusted.forEach(staker => {
      const adjustedPermille = (staker.adjustedTotal / totalAdjusted) * 1000;
      const paddedAddress = staker.address.padEnd(43, ' ');
      const paddedValue = staker.adjustedTotal.toFixed(2).padStart(13, ' ');
      const paddedPermille = adjustedPermille.toFixed(4).padStart(11, ' ');
      console.log(`${paddedAddress}| ${paddedValue} | ${paddedPermille}`);
    });
    console.log("-------------------------------------------|---------------|-------------");
    const totalPermille = stakersWithAdjusted.reduce((sum, staker) => 
      sum + (staker.adjustedTotal / totalAdjusted) * 1000, 0
    );
    const paddedTotal = "TOTAL".padEnd(43, ' ');
    const paddedTotalValue = totalAdjusted.toFixed(2).padStart(13, ' ');
    const paddedTotalPermille = totalPermille.toFixed(4).padStart(11, ' ');
    console.log(`${paddedTotal}| ${paddedTotalValue} | ${paddedTotalPermille}`);
  }
  
  // Save results to JSON file only if not simulating
  if (simulatedAmounts.length === 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Calculate adjusted values for JSON
    const stakersWithAdjusted = highStakers.map(staker => ({
      ...staker,
      adjustedTotal: calculateAdjustedTotal(staker.poolStakes)
    }));
    const totalAdjusted = stakersWithAdjusted.reduce((sum, staker) => sum + staker.adjustedTotal, 0);

    const jsonData = {
      timestamp,
      totalStaked: ethers.formatUnits(totalStaked, 18),
      totalAdjustedStaked: totalAdjusted.toFixed(2),
      stakers: stakersWithAdjusted.map(staker => {
        const adjustedPermille = (staker.adjustedTotal / totalAdjusted) * 1000;
        return {
          address: staker.address,
          rawHoldings: ethers.formatUnits(staker.balance, 18),
          rawPermille: staker.permille.toFixed(4),
          adjustedTotal: staker.adjustedTotal.toFixed(2),
          adjustedPermille: adjustedPermille.toFixed(4),
          poolStakes: Object.fromEntries(
            Object.entries(staker.poolStakes).map(([poolId, amount]) => [
              `${poolId} (${getPoolTokenName(poolId)})`,
              {
                raw: ethers.formatUnits(amount, 18),
                adjusted: getAdjustedValue(amount, Number(poolId)).toFixed(2),
                modifier: POOL_MODIFIERS[poolId] || 1.0
              }
            ])
          )
        };
      })
    };

    const fileName = path.join(__dirname, `staking-snapshot-${timestamp}.json`);
    fs.writeFileSync(fileName, JSON.stringify(jsonData, null, 2));
    console.log(`\n📝 Results saved to: ${path.basename(fileName)}`);
  }
  
  console.log("\n🎉 That's all folks! Keep staking! 🚀");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Ruh roh! Error:", error);
    process.exit(1);
  }); 