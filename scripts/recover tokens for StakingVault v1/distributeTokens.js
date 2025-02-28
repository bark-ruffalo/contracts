/**
 * distributeTokens.js
 * 
 * Distributes tokens back to users based on the staking snapshot.
 * 
 * Features:
 * - Processes pools in order: 1 (mPAWSY), 0 (PAWSY), 2 (LP)
 * - Distributes from lowest to highest amounts
 * - Runs in simulation mode by default
 * - Use --doit flag to execute actual transactions with confirmation
 * 
 * Usage:
 * - Simulation: node distributeTokens.js
 * - Execution: node distributeTokens.js --doit
 */

const dotenv = require('dotenv');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load environment variables
dotenv.config();

// Constants
const HOT_WALLET_ADDRESS = '0xbdc2Be9628daEF54F8B802357A86B550fe164aCF'; // Deployer address
const POOL_ORDER = [1, 0, 2]; // Process pool 1 first, then 0, then 2
const SNAPSHOT_FILE = 'snapshot.json'; // Use specific snapshot file

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

// ERC20 token ABI - need transfer and balanceOf functions
const ERC20_ABI = [
  // balanceOf
  {
    "constant": true,
    "inputs": [{ "name": "_owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "balance", "type": "uint256" }],
    "type": "function"
  },
  // transfer
  {
    "constant": false,
    "inputs": [
      { "name": "_to", "type": "address" },
      { "name": "_value", "type": "uint256" }
    ],
    "name": "transfer",
    "outputs": [{ "name": "", "type": "bool" }],
    "type": "function"
  }
];

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Check for --doit argument
const args = process.argv.slice(2);
const SIMULATION_MODE = !args.includes('--doit');

/**
 * Helper function to format token amounts to human-readable values
 */
function formatTokenAmount(amount, decimals = 18) {
  const formatted = ethers.formatUnits(amount, decimals);
  return formatted;
}

/**
 * Prompts the user for confirmation
 * @param {string} message - The message to display
 * @returns {Promise<boolean>} - Whether the user confirmed or not
 */
function promptForConfirmation(message) {
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Main function to distribute tokens
 */
async function distributeTokens() {
  try {
    console.log('Starting token distribution script');
    
    if (SIMULATION_MODE) {
      console.log('⚠️ SIMULATION MODE: No actual transactions will be sent');
      console.log('To execute real transactions, run with --doit flag');
    } else {
      console.log('⚠️ EXECUTION MODE: Actual transactions will be sent after confirmation');
      
      // Double-check with user
      const confirmed = await promptForConfirmation(
        '⚠️ WARNING: This will send actual token transactions. Are you sure you want to continue?'
      );
      
      if (!confirmed) {
        console.log('Distribution cancelled by user');
        rl.close();
        return;
      }
    }
    
    console.log('\nReading snapshot and initializing...');
    
    // Read the snapshot file
    try {
      console.log(`Using snapshot file: ${SNAPSHOT_FILE}`);
      const snapshotData = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      
      // Create provider and wallet from private key
      const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
      const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
      console.log(`Using wallet: ${wallet.address}`);
      
      // Verify hot wallet address matches
      if (wallet.address.toLowerCase() !== HOT_WALLET_ADDRESS.toLowerCase()) {
        console.warn(
          `⚠️ Warning: The wallet address (${wallet.address}) doesn't match the expected hot wallet address (${HOT_WALLET_ADDRESS}).`
        );
        const proceed = await promptForConfirmation('Do you want to continue anyway?');
        if (!proceed) {
          console.log('Distribution cancelled by user');
          rl.close();
          return;
        }
      }
      
      // Initialize token contracts
      const tokenContracts = {};
      for (const poolId in POOL_TOKENS) {
        tokenContracts[poolId] = new ethers.Contract(
          POOL_TOKENS[poolId].address,
          ERC20_ABI,
          wallet
        );
      }
      
      // Verify token balances are sufficient
      console.log('\nVerifying token balances...');
      
      const hotWalletBalances = {};
      let allBalancesSufficient = true;
      
      for (const poolId in POOL_TOKENS) {
        const token = POOL_TOKENS[poolId];
        const totalOwed = BigInt(snapshotData.summary.totalStaked[poolId]);
        
        // Check balance
        const balance = await tokenContracts[poolId].balanceOf(wallet.address);
        hotWalletBalances[poolId] = balance;
        
        const isSufficient = balance >= totalOwed;
        const coverage = totalOwed > 0 
          ? Number((balance * 10000n) / totalOwed) / 100
          : 100;
        
        console.log(
          `${token.symbol}: ${formatTokenAmount(balance)} available, ${formatTokenAmount(totalOwed)} needed ` +
          `(${coverage.toFixed(2)}% coverage) - ${isSufficient ? '✅ Sufficient' : '❌ Insufficient'}`
        );
        
        if (!isSufficient) {
          allBalancesSufficient = false;
        }
      }
      
      if (!allBalancesSufficient) {
        console.error('❌ Insufficient token balance for at least one pool');
        const proceed = await promptForConfirmation('Do you want to continue anyway? (will likely fail on some transactions)');
        if (!proceed) {
          console.log('Distribution cancelled by user');
          rl.close();
          return;
        }
      }
      
      // Process each pool in the specified order
      for (const poolId of POOL_ORDER) {
        const token = POOL_TOKENS[poolId];
        console.log(`\n=== Processing Pool ${poolId} (${token.symbol}) ===`);
        
        // Structure data for each user who has tokens in this pool
        const usersWithTokens = [];
        
        for (const [address, userData] of Object.entries(snapshotData.users)) {
          const tokenAmount = BigInt(userData.tokens[poolId]);
          if (tokenAmount > 0) {
            usersWithTokens.push({
              address,
              amount: tokenAmount,
              amountReadable: formatTokenAmount(tokenAmount)
            });
          }
        }
        
        // Sort users by amount (ascending)
        usersWithTokens.sort((a, b) => {
          // Compare as BigInt for accurate sorting
          if (a.amount < b.amount) return -1;
          if (a.amount > b.amount) return 1;
          return 0;
        });
        
        console.log(`Found ${usersWithTokens.length} users with ${token.symbol} tokens to distribute`);
        
        if (usersWithTokens.length === 0) {
          console.log(`No users with ${token.symbol} tokens to distribute, skipping pool`);
          continue;
        }
        
        let successCount = 0;
        let failCount = 0;
        
        // Distribute tokens to each user
        for (let i = 0; i < usersWithTokens.length; i++) {
          const user = usersWithTokens[i];
          console.log(`\n[${i+1}/${usersWithTokens.length}] Processing ${user.address}`);
          console.log(`Amount: ${user.amountReadable} ${token.symbol}`);
          
          try {
            if (SIMULATION_MODE) {
              // In simulation mode, just log what would happen
              console.log(`SIMULATION: Would send ${user.amountReadable} ${token.symbol} to ${user.address}`);
              successCount++;
            } else {
              // In execution mode, send the actual transaction after confirmation
              const confirmed = await promptForConfirmation(
                `Send ${user.amountReadable} ${token.symbol} to ${user.address}?`
              );
              
              if (confirmed) {
                console.log(`Sending ${user.amountReadable} ${token.symbol} to ${user.address}...`);
                
                // Execute the transaction
                const tx = await tokenContracts[poolId].transfer(user.address, user.amount);
                console.log(`Transaction sent: ${tx.hash}`);
                
                // Wait for transaction to be mined
                console.log('Waiting for transaction confirmation...');
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                  console.log(`✅ Transaction confirmed: ${tx.hash}`);
                  successCount++;
                } else {
                  console.error(`❌ Transaction failed: ${tx.hash}`);
                  failCount++;
                }
              } else {
                console.log(`Skipping ${user.address} by user request`);
              }
            }
          } catch (error) {
            console.error(`Error processing ${user.address}: ${error.message}`);
            failCount++;
          }
        }
        
        console.log(`\n=== Pool ${poolId} (${token.symbol}) Summary ===`);
        console.log(`Total users: ${usersWithTokens.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${failCount}`);
      }
      
      console.log('\n=== Distribution Complete ===');
      
      if (SIMULATION_MODE) {
        console.log('This was a simulation. To execute real transactions, run with --doit flag');
      }
      
    } catch (error) {
      console.error(`Error reading snapshot file: ${error.message}`);
      console.error('Make sure "snapshot.json" exists in the current directory.');
      rl.close();
      process.exit(1);
    }
    
    rl.close();
  } catch (error) {
    console.error('Error in distributeTokens:', error);
    rl.close();
    process.exit(1);
  }
}

// Execute the script
distributeTokens().catch(error => {
  console.error('Fatal error in distributeTokens:', error);
  rl.close();
  process.exit(1);
}); 