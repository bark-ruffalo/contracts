/**
 * distributeRewards.js
 * 
 * Distributes reward tokens (rPAWSY) to users based on the staking snapshot.
 * 
 * Features:
 * - Processes users in order of smallest to largest reward amounts
 * - Distributes from lowest to highest amounts
 * - Runs in simulation mode by default
 * - Use --doit flag to execute actual transactions with confirmation
 * 
 * Usage:
 * - Simulation: node distributeRewards.js
 * - Execution: node distributeRewards.js --doit
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
const SNAPSHOT_FILE = 'snapshot.json'; // Use specific snapshot file
const MIN_REWARD_THRESHOLD = 1; // Minimum reward amount to distribute (in tokens, not wei)

// Reward token
const REWARD_TOKEN = {
  address: '0x11898013f8bd7f656f124d8b772fd8ae0b895279',
  symbol: 'rPAWSY',
  decimals: 18
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

// Track auto-confirm state
let AUTO_CONFIRM = false;

/**
 * Prompts the user for confirmation with enhanced options
 * @param {string} message - The message to display
 * @returns {Promise<string|boolean>} - 'all', 'cancel', true, or false
 */
function promptForConfirmation(message) {
  // Skip prompt if auto-confirm is enabled
  if (AUTO_CONFIRM) {
    // Still log what's happening but with a special indicator
    console.log("\n----------------------------------------");
    console.log(`🔄 AUTO-CONFIRM: ${message}`);
    console.log(`✅ Auto-approved (all option was selected)`);
    console.log("----------------------------------------");
    return Promise.resolve(true); // Return true instead of 'all' for consistency
  }
  
  return new Promise((resolve) => {
    // Make the prompt more visible with separator lines
    console.log("\n----------------------------------------");
    rl.question(`${message} (Y/n/a/c - Yes/no/all/cancel): `, (answer) => {
      const lowercaseAnswer = answer.toLowerCase();
      
      if (lowercaseAnswer === 'a') {
        console.log('🔄 AUTO-CONFIRM ENABLED: All remaining transactions will be approved automatically');
        AUTO_CONFIRM = true;
        console.log("----------------------------------------");
        resolve(true); // Return true instead of 'all' for consistency
      }
      else if (lowercaseAnswer === 'c') {
        console.log('⚠️ CANCELLATION REQUESTED - Distribution will stop...');
        console.log("----------------------------------------");
        resolve('cancel');
      }
      else if (lowercaseAnswer === 'n') {
        console.log("----------------------------------------");
        resolve(false);
      }
      else {
        // Default to yes for any other input including empty string
        console.log("----------------------------------------");
        resolve(true);
      }
    });
  });
}

/**
 * Helper function to format token amounts to human-readable values
 */
function formatTokenAmount(amount, decimals = 18) {
  const formatted = ethers.formatUnits(amount, decimals);
  return formatted;
}

/**
 * Handle negative reward values by treating them as zero
 * @param {string} rewardAmount - The reward amount as a string
 * @returns {bigint} - The non-negative reward amount as a bigint
 */
function sanitizeRewardAmount(rewardAmount) {
  const amount = BigInt(rewardAmount);
  // Return 0 if the amount is negative
  return amount < 0n ? 0n : amount;
}

/**
 * Main function to distribute rewards
 */
async function distributeRewards() {
  try {
    console.log('Starting reward distribution script');
    
    if (SIMULATION_MODE) {
      console.log('⚠️ SIMULATION MODE: No actual transactions will be sent');
      console.log('To execute real transactions, run with --doit flag');
    } else {
      console.log('⚠️ EXECUTION MODE: Actual transactions will be sent after confirmation');
      
      // Double-check with user
      const confirmed = await promptForConfirmation(
        '⚠️ WARNING: This will send actual rPAWSY reward token transactions. Are you sure you want to continue?'
      );
      
      if (confirmed === 'cancel' || confirmed === false) {
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
        if (proceed === 'cancel' || proceed === false) {
          console.log('Distribution cancelled by user');
          rl.close();
          return;
        }
      }
      
      // Initialize reward token contract
      const rewardToken = new ethers.Contract(
        REWARD_TOKEN.address,
        ERC20_ABI,
        wallet
      );
      
      // Verify reward token balance is sufficient
      console.log('\nVerifying reward token balance...');
      
      // Calculate total rewards owed
      let totalRewardsOwed = 0n;
      for (const [address, userData] of Object.entries(snapshotData.users)) {
        // Safely process rewards, handling potentially negative values as 0
        const rewardAmount = sanitizeRewardAmount(userData.rewards);
        totalRewardsOwed += rewardAmount;
      }
      
      // Check balance
      const rewardBalance = await rewardToken.balanceOf(wallet.address);
      
      const isSufficient = rewardBalance >= totalRewardsOwed;
      const coverage = totalRewardsOwed > 0 
        ? Number((rewardBalance * 10000n) / totalRewardsOwed) / 100
        : 100;
      
      console.log(
        `${REWARD_TOKEN.symbol}: ${formatTokenAmount(rewardBalance)} available, ${formatTokenAmount(totalRewardsOwed)} needed ` +
        `(${coverage.toFixed(2)}% coverage) - ${isSufficient ? '✅ Sufficient' : '❌ Insufficient'}`
      );
      
      if (!isSufficient) {
        console.error('❌ Insufficient reward token balance');
        const proceed = await promptForConfirmation('Do you want to continue anyway? (will likely fail on some transactions)');
        if (proceed === 'cancel' || proceed === false) {
          console.log('Distribution cancelled by user');
          rl.close();
          return;
        }
      }
      
      // Flag to track if distribution should be cancelled
      let distributionCancelled = false;
      
      console.log(`\n=== Processing Rewards (${REWARD_TOKEN.symbol}) ===`);
      
      // Structure data for each user who has rewards
      const usersWithRewards = [];
      let skippedDueToThreshold = 0;
      
      for (const [address, userData] of Object.entries(snapshotData.users)) {
        // Safely process rewards, handling potentially negative values
        const rewardAmount = sanitizeRewardAmount(userData.rewards);
        const rewardAmountReadable = Number(formatTokenAmount(rewardAmount));
        
        if (rewardAmount > 0n) {
          // Skip users with rewards below the threshold
          if (rewardAmountReadable < MIN_REWARD_THRESHOLD) {
            skippedDueToThreshold++;
            continue;
          }
          
          usersWithRewards.push({
            address,
            amount: rewardAmount,
            amountReadable: formatTokenAmount(rewardAmount)
          });
        }
      }
      
      // Sort users by reward amount (ascending)
      usersWithRewards.sort((a, b) => {
        // Compare as BigInt for accurate sorting
        if (a.amount < b.amount) return -1;
        if (a.amount > b.amount) return 1;
        return 0;
      });
      
      console.log(`Found ${usersWithRewards.length} users with ${REWARD_TOKEN.symbol} rewards to distribute`);
      console.log(`Skipped ${skippedDueToThreshold} users with rewards below the threshold of ${MIN_REWARD_THRESHOLD} ${REWARD_TOKEN.symbol}`);
      
      if (usersWithRewards.length === 0) {
        console.log(`No users with ${REWARD_TOKEN.symbol} rewards to distribute`);
        rl.close();
        return;
      }
      
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      
      // Distribute rewards to each user
      for (let i = 0; i < usersWithRewards.length; i++) {
        if (distributionCancelled) break;
        
        const user = usersWithRewards[i];
        console.log(`\n[${i+1}/${usersWithRewards.length}] Processing ${user.address}`);
        console.log(`Amount: ${user.amountReadable} ${REWARD_TOKEN.symbol}`);
        
        try {
          if (SIMULATION_MODE) {
            // In simulation mode, still show the prompt but don't actually send transactions
            const response = await promptForConfirmation(
              `SIMULATE: Would you like to send ${user.amountReadable} ${REWARD_TOKEN.symbol} to ${user.address}?`
            );
            
            if (response === 'cancel') {
              console.log('⛔ Distribution cancelled by user');
              distributionCancelled = true;
              break;
            } else if (response === false) {
              console.log(`Skipping ${user.address} by user request`);
              skippedCount++;
              continue;
            }
            
            // If we get here, response is true (either manual or auto-confirmed)
            console.log(`✅ SIMULATION: Would send ${user.amountReadable} ${REWARD_TOKEN.symbol} to ${user.address}`);
            successCount++;
          } else {
            // In execution mode, send the actual transaction after confirmation
            const response = await promptForConfirmation(
              `Send ${user.amountReadable} ${REWARD_TOKEN.symbol} to ${user.address}?`
            );
            
            if (response === 'cancel') {
              console.log('⛔ Distribution cancelled by user');
              distributionCancelled = true;
              break;
            } else if (response === false) {
              console.log(`Skipping ${user.address} by user request`);
              skippedCount++;
              continue;
            }
            
            // If we get here, response is true (either manual or auto-confirmed)
            console.log(`Sending ${user.amountReadable} ${REWARD_TOKEN.symbol} to ${user.address}...`);
            
            // Get the latest nonce before each transaction to avoid nonce issues
            const currentNonce = await provider.getTransactionCount(wallet.address);
            console.log(`Using nonce: ${currentNonce}`);
            
            // Execute the transaction with explicit nonce
            const tx = await rewardToken.transfer(
              user.address, 
              user.amount,
              { nonce: currentNonce }
            );
            console.log(`Transaction sent: ${tx.hash}`);
            
            // Wait for transaction to be mined
            console.log('Waiting for transaction confirmation...');
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
              console.log(`✅ Transaction confirmed: ${tx.hash}`);
              successCount++;
              
              // Add a small delay between transactions to allow the network to update
              if (i < usersWithRewards.length - 1) {
                console.log('Waiting 2 seconds before next transaction...');
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } else {
              console.error(`❌ Transaction failed: ${tx.hash}`);
              failCount++;
            }
          }
        } catch (error) {
          console.error(`❌ Error processing ${user.address}: ${error.message}`);
          
          // Check if it's a nonce error and retry with updated nonce
          if (error.message.includes('nonce') && !SIMULATION_MODE) {
            console.log('Detected nonce error, attempting to retry with updated nonce...');
            try {
              // Get the latest nonce again
              const updatedNonce = await provider.getTransactionCount(wallet.address);
              console.log(`Retrying with updated nonce: ${updatedNonce}`);
              
              // Retry the transaction with the updated nonce
              const tx = await rewardToken.transfer(
                user.address, 
                user.amount,
                { nonce: updatedNonce }
              );
              console.log(`Retry transaction sent: ${tx.hash}`);
              
              // Wait for transaction to be mined
              console.log('Waiting for transaction confirmation...');
              const receipt = await tx.wait();
              
              if (receipt.status === 1) {
                console.log(`✅ Retry successful! Transaction confirmed: ${tx.hash}`);
                successCount++;
                
                // Add a slightly longer delay after a retry
                if (i < usersWithRewards.length - 1) {
                  console.log('Waiting 3 seconds before next transaction...');
                  await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
                // Continue to the next user
                continue;
              } else {
                console.error(`❌ Retry failed: ${tx.hash}`);
                failCount++;
              }
            } catch (retryError) {
              console.error(`❌ Retry failed: ${retryError.message}`);
              failCount++;
            }
          } else {
            failCount++;
          }
          
          // Reset auto-confirm for errors to ensure user sees the error
          const wasAutoConfirm = AUTO_CONFIRM;
          if (wasAutoConfirm) {
            AUTO_CONFIRM = false;
            console.log('🛑 Auto-confirm disabled due to error');
          }
          
          // Ask if user wants to continue after an error
          const continueAfterError = await promptForConfirmation('Continue with remaining transactions?');
          
          if (continueAfterError === 'cancel' || continueAfterError === false) {
            console.log('⛔ Distribution cancelled after error');
            distributionCancelled = true;
            break;
          }
          
          // If user selected "all" again in the error prompt, don't need to restore
          // Otherwise, restore previous auto-confirm state if it was enabled
          if (wasAutoConfirm && !AUTO_CONFIRM) {
            AUTO_CONFIRM = true;
            console.log('🔄 Auto-confirm re-enabled');
          }
          
          // Add a delay after an error before continuing
          console.log('Waiting 5 seconds before continuing...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      console.log(`\n=== Reward Distribution Summary ===`);
      console.log(`Total users: ${usersWithRewards.length}`);
      console.log(`Successful: ${successCount}`);
      console.log(`Failed: ${failCount}`);
      console.log(`Skipped by user: ${skippedCount}`);
      console.log(`Skipped due to threshold (< ${MIN_REWARD_THRESHOLD} ${REWARD_TOKEN.symbol}): ${skippedDueToThreshold}`);
      
      if (distributionCancelled) {
        console.log('\n⛔ Distribution was cancelled before completion');
      } else {
        console.log('\n=== Distribution Complete ===');
      }
      
      if (SIMULATION_MODE) {
        console.log('This was a simulation. Run with --doit flag to execute actual transactions');
      }
      
    } catch (error) {
      console.error(`Error reading or processing snapshot file: ${error.message}`);
      console.error('Make sure "snapshot.json" exists in the current directory and has valid data.');
      rl.close();
      process.exit(1);
    }
    
    rl.close();
  } catch (error) {
    console.error('Error in distributeRewards:', error);
    rl.close();
    process.exit(1);
  }
}

// Execute the script
distributeRewards().catch(error => {
  console.error('Fatal error in distributeRewards:', error);
  rl.close();
  process.exit(1);
}); 