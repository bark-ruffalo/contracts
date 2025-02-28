/**
 * checkSnapshot.js
 * 
 * Compares the total staked tokens owed in the snapshot
 * with the available balance in the hot wallet.
 * 
 * This helps verify that there are enough tokens to distribute
 * to users affected by the emergency unlock bug.
 */

const dotenv = require('dotenv');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Constants
const HOT_WALLET_ADDRESS = '0xbdc2Be9628daEF54F8B802357A86B550fe164aCF'; // Deployer address

// Pool tokens (from the snapshot)
const POOL_TOKENS = {
  '0': {
    address: '0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a',
    symbol: 'PAWSY',
    decimals: 18
  },
  '1': {
    address: '0x1437819DF58Ad648e35ED4f6F642d992684B2004',
    symbol: 'mPAWSY',
    decimals: 18
  },
  '2': {
    address: '0x96FC64caE162C1Cb288791280c3Eff2255c330a8',
    symbol: 'LP',
    decimals: 18
  }
};

// ERC20 token ABI - only need balanceOf function
const ERC20_ABI = [
  // balanceOf
  {
    "constant": true,
    "inputs": [{ "name": "_owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "balance", "type": "uint256" }],
    "type": "function"
  }
];

/**
 * Function to find the latest staking snapshot summary file in the current directory
 * @returns {string} Path to the latest snapshot file
 */
function findLatestSnapshotFile() {
  try {
    // Get all files in the current directory
    const currentDir = process.cwd();
    const files = fs.readdirSync(currentDir);
    
    // Filter for snapshot summary files
    const snapshotFiles = files.filter(file => 
      file.startsWith('staking_snapshot_summary_') && file.endsWith('.json')
    );
    
    if (snapshotFiles.length === 0) {
      throw new Error('No staking snapshot summary files found in the current directory');
    }
    
    // Sort files by timestamp (newest first)
    snapshotFiles.sort((a, b) => {
      const timestampA = parseInt(a.replace('staking_snapshot_summary_', '').replace('.json', ''));
      const timestampB = parseInt(b.replace('staking_snapshot_summary_', '').replace('.json', ''));
      return timestampB - timestampA; // Descending order (newest first)
    });
    
    // Return the latest file
    const latestFile = snapshotFiles[0];
    console.log(`Using latest snapshot file: ${latestFile}`);
    return path.join(currentDir, latestFile);
  } catch (error) {
    console.error(`Error finding latest snapshot file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Helper function to format large numbers with commas as thousands separators
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Helper function to format token amounts to human-readable values
 */
function formatTokenAmount(amount, decimals = 18) {
  const formatted = ethers.formatUnits(amount, decimals);
  return formatted;
}

/**
 * Main function to check balances
 */
async function checkBalances() {
  try {
    console.log('Starting balance check...');
    
    // Find and read the latest snapshot file
    const snapshotFile = findLatestSnapshotFile();
    const snapshotData = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    
    // Extract total tokens owed from the snapshot
    const totalOwed = {
      '0': BigInt(snapshotData.summary.totalStaked['0']),
      '1': BigInt(snapshotData.summary.totalStaked['1']),
      '2': BigInt(snapshotData.summary.totalStaked['2']),
      'rewards': BigInt(snapshotData.summary.totalRewards.total)
    };
    
    // Create provider and wallet from private key
    const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
    const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    
    console.log(`Checking balances for wallet: ${wallet.address}`);
    
    // Verify hot wallet address matches
    if (wallet.address.toLowerCase() !== HOT_WALLET_ADDRESS.toLowerCase()) {
      console.warn(
        `⚠️ Warning: The wallet address (${wallet.address}) doesn't match the expected hot wallet address (${HOT_WALLET_ADDRESS}). 
        Make sure you're using the correct private key.`
      );
    }
    
    // Check native token balance (ETH or BASE)
    const nativeBalance = await provider.getBalance(wallet.address);
    console.log(`\nNative token balance: ${formatTokenAmount(nativeBalance)} ETH/BASE`);
    
    // Check token balances and compare with owed amounts
    console.log('\n=== TOKEN BALANCES VS OWED AMOUNTS ===');
    console.log('Pool | Token | Wallet Balance | Total Owed | Sufficient | % Coverage');
    console.log('-----|-------|---------------|------------|------------|------------');
    
    const results = [];
    
    // Check each pool token
    for (const poolId in POOL_TOKENS) {
      const token = POOL_TOKENS[poolId];
      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, provider);
      
      // Get token balance
      const balance = await tokenContract.balanceOf(wallet.address);
      
      // Calculate if balance is sufficient and coverage percentage
      const isSufficient = balance >= totalOwed[poolId];
      const coverage = totalOwed[poolId] > 0 
        ? Number((balance * 10000n) / totalOwed[poolId]) / 100
        : 100;
      
      // Save result
      results.push({
        poolId,
        symbol: token.symbol,
        balance,
        owed: totalOwed[poolId],
        isSufficient,
        coverage
      });
      
      // Print result
      console.log(
        `${poolId}    | ${token.symbol.padEnd(5)} | ${formatTokenAmount(balance).padStart(13)} | ` +
        `${formatTokenAmount(totalOwed[poolId]).padStart(10)} | ${isSufficient ? '✅ Yes' : '❌ No'} | ${coverage.toFixed(2)}%`
      );
    }
    
    // Summary
    console.log('\n=== SUMMARY ===');
    
    let allSufficient = true;
    for (const result of results) {
      if (!result.isSufficient) {
        allSufficient = false;
        console.log(`❌ Insufficient ${result.symbol} tokens: ${formatTokenAmount(result.balance)} available, ${formatTokenAmount(result.owed)} needed (${result.coverage.toFixed(2)}% coverage)`);
      }
    }
    
    if (allSufficient) {
      console.log('✅ Hot wallet has sufficient tokens to cover all owed amounts!');
    } else {
      console.log('\n⚠️ Hot wallet does not have sufficient tokens to cover all owed amounts.');
    }
    
    // Rewards token check is a special case, since it'll be a new token
    console.log('\n=== REWARDS NEEDED ===');
    console.log(`Total rewards to be distributed: ${formatTokenAmount(totalOwed.rewards)}`);
    console.log('Note: You mentioned creating a new rewards token, so this balance check is informational only.');
    
    // User stats
    console.log('\n=== USER STATS ===');
    console.log(`Total users with outstanding balances: ${snapshotData.summary.usersWithOutstandingBalances}`);
    console.log(`Total outstanding positions: ${snapshotData.summary.totalOutstandingPositions}`);
    
  } catch (error) {
    console.error('Error checking balances:', error);
  }
}

// Execute the script
checkBalances().catch(error => {
  console.error('Fatal error in checkBalances:', error);
  process.exit(1);
}); 