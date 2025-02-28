/**
 * distributeFromCSV.js
 * 
 * Distributes tokens to users based on a CSV export of token balances.
 * 
 * Features:
 * - Processes users in order of smallest to largest amounts
 * - Distributes from lowest to highest amounts
 * - Runs in simulation mode by default
 * - Use --doit flag to execute actual transactions with confirmation
 * 
 * Usage:
 * - Simulation: node distributeFromCSV.js
 * - Execution: node distributeFromCSV.js --doit
 */

const dotenv = require('dotenv');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parse } = require('csv-parse/sync');

// Load environment variables
dotenv.config();

// Constants
const HOT_WALLET_ADDRESS = '0xbdc2Be9628daEF54F8B802357A86B550fe164aCF'; // Deployer address
const CSV_FILE = 'export-token-0xd2f2386a1c8a4c6d3605c9343b948b12056bd774.csv'; // CSV file with token amounts
const MIN_AMOUNT_THRESHOLD = 1; // Minimum amount to distribute (in tokens, not wei)

// Token to distribute
const TOKEN = {
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
 * Parse a token amount string from CSV (e.g. "1,234.56") into a BigInt in wei
 * @param {string} amountStr - The amount string from CSV
 * @returns {bigint} - The amount as a BigInt in wei
 */
function parseTokenAmount(amountStr) {
  // Remove quotes and commas, then convert to BigInt with 18 decimals
  const cleanedAmount = amountStr.replace(/"/g, '').replace(/,/g, '');
  return ethers.parseUnits(cleanedAmount, TOKEN.decimals);
}

/**
 * Main function to distribute tokens
 */
async function distributeFromCSV() {
  try {
    console.log('Starting token distribution from CSV script');
    
    if (SIMULATION_MODE) {
      console.log('⚠️ SIMULATION MODE: No actual transactions will be sent');
      console.log('To execute real transactions, run with --doit flag');
    } else {
      console.log('⚠️ EXECUTION MODE: Actual transactions will be sent after confirmation');
      
      // Double-check with user
      const confirmed = await promptForConfirmation(
        `⚠️ WARNING: This will send actual ${TOKEN.symbol} transactions. Are you sure you want to continue?`
      );
      
      if (confirmed === 'cancel' || confirmed === false) {
        console.log('Distribution cancelled by user');
        rl.close();
        return;
      }
    }
    
    console.log('\nReading CSV and initializing...');
    
    // Read the CSV file
    try {
      console.log(`Using CSV file: ${CSV_FILE}`);
      const csvData = fs.readFileSync(CSV_FILE, 'utf8');
      
      // Parse the CSV
      const records = parse(csvData, {
        columns: true,
        skip_empty_lines: true
      });
      
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
      
      // Initialize token contract
      const tokenContract = new ethers.Contract(
        TOKEN.address,
        ERC20_ABI,
        wallet
      );
      
      // Verify token balance is sufficient
      console.log('\nVerifying token balance...');
      
      // Calculate total amount to distribute
      let totalAmountToDistribute = 0n;
      for (const record of records) {
        // Only count amounts above the threshold
        const amount = parseTokenAmount(record.Quantity);
        const amountReadable = Number(formatTokenAmount(amount));
        
        if (amountReadable >= MIN_AMOUNT_THRESHOLD) {
          totalAmountToDistribute += amount;
        }
      }
      
      // Check balance
      const tokenBalance = await tokenContract.balanceOf(wallet.address);
      
      const isSufficient = tokenBalance >= totalAmountToDistribute;
      const coverage = totalAmountToDistribute > 0n 
        ? Number((tokenBalance * 10000n) / totalAmountToDistribute) / 100
        : 100;
      
      console.log(
        `${TOKEN.symbol}: ${formatTokenAmount(tokenBalance)} available, ${formatTokenAmount(totalAmountToDistribute)} needed ` +
        `(${coverage.toFixed(2)}% coverage) - ${isSufficient ? '✅ Sufficient' : '❌ Insufficient'}`
      );
      
      if (!isSufficient) {
        console.error('❌ Insufficient token balance');
        const proceed = await promptForConfirmation('Do you want to continue anyway? (will likely fail on some transactions)');
        if (proceed === 'cancel' || proceed === false) {
          console.log('Distribution cancelled by user');
          rl.close();
          return;
        }
      }
      
      // Flag to track if distribution should be cancelled
      let distributionCancelled = false;
      
      console.log(`\n=== Processing Distribution (${TOKEN.symbol}) ===`);
      
      // Structure data for each user
      const usersToReceiveTokens = [];
      let skippedDueToThreshold = 0;
      
      for (const record of records) {
        const address = record.Address;
        const amount = parseTokenAmount(record.Quantity);
        const amountReadable = Number(formatTokenAmount(amount));
        
        // Skip users with amounts below the threshold
        if (amountReadable < MIN_AMOUNT_THRESHOLD) {
          skippedDueToThreshold++;
          continue;
        }
        
        usersToReceiveTokens.push({
          address,
          amount,
          amountReadable: formatTokenAmount(amount),
          nameTag: record.Address_Nametag || ''
        });
      }
      
      // Sort users by amount (ascending)
      usersToReceiveTokens.sort((a, b) => {
        // Compare as BigInt for accurate sorting
        if (a.amount < b.amount) return -1;
        if (a.amount > b.amount) return 1;
        return 0;
      });
      
      console.log(`Found ${usersToReceiveTokens.length} users with ${TOKEN.symbol} amounts to distribute`);
      console.log(`Skipped ${skippedDueToThreshold} users with amounts below the threshold of ${MIN_AMOUNT_THRESHOLD} ${TOKEN.symbol}`);
      
      if (usersToReceiveTokens.length === 0) {
        console.log(`No users to distribute ${TOKEN.symbol} to after filtering`);
        rl.close();
        return;
      }
      
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      
      // Distribute tokens to each user
      for (let i = 0; i < usersToReceiveTokens.length; i++) {
        if (distributionCancelled) break;
        
        const user = usersToReceiveTokens[i];
        const displayName = user.nameTag ? `${user.address} (${user.nameTag})` : user.address;
        console.log(`\n[${i+1}/${usersToReceiveTokens.length}] Processing ${displayName}`);
        console.log(`Amount: ${user.amountReadable} ${TOKEN.symbol}`);
        
        try {
          if (SIMULATION_MODE) {
            // In simulation mode, still show the prompt but don't actually send transactions
            const response = await promptForConfirmation(
              `SIMULATE: Would you like to send ${user.amountReadable} ${TOKEN.symbol} to ${displayName}?`
            );
            
            if (response === 'cancel') {
              console.log('⛔ Distribution cancelled by user');
              distributionCancelled = true;
              break;
            } else if (response === false) {
              console.log(`Skipping ${displayName} by user request`);
              skippedCount++;
              continue;
            }
            
            // If we get here, response is true (either manual or auto-confirmed)
            console.log(`✅ SIMULATION: Would send ${user.amountReadable} ${TOKEN.symbol} to ${displayName}`);
            successCount++;
          } else {
            // In execution mode, send the actual transaction after confirmation
            const response = await promptForConfirmation(
              `Send ${user.amountReadable} ${TOKEN.symbol} to ${displayName}?`
            );
            
            if (response === 'cancel') {
              console.log('⛔ Distribution cancelled by user');
              distributionCancelled = true;
              break;
            } else if (response === false) {
              console.log(`Skipping ${displayName} by user request`);
              skippedCount++;
              continue;
            }
            
            // If we get here, response is true (either manual or auto-confirmed)
            console.log(`Sending ${user.amountReadable} ${TOKEN.symbol} to ${displayName}...`);
            
            // Get the latest nonce before each transaction to avoid nonce issues
            const currentNonce = await provider.getTransactionCount(wallet.address);
            console.log(`Using nonce: ${currentNonce}`);
            
            // Execute the transaction with explicit nonce
            const tx = await tokenContract.transfer(
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
              if (i < usersToReceiveTokens.length - 1) {
                console.log('Waiting 2 seconds before next transaction...');
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } else {
              console.error(`❌ Transaction failed: ${tx.hash}`);
              failCount++;
            }
          }
        } catch (error) {
          console.error(`❌ Error processing ${displayName}: ${error.message}`);
          
          // Check if it's a nonce error and retry with updated nonce
          if (error.message.includes('nonce') && !SIMULATION_MODE) {
            console.log('Detected nonce error, attempting to retry with updated nonce...');
            try {
              // Get the latest nonce again
              const updatedNonce = await provider.getTransactionCount(wallet.address);
              console.log(`Retrying with updated nonce: ${updatedNonce}`);
              
              // Retry the transaction with the updated nonce
              const tx = await tokenContract.transfer(
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
                if (i < usersToReceiveTokens.length - 1) {
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
      
      console.log(`\n=== Distribution Summary ===`);
      console.log(`Total users: ${usersToReceiveTokens.length}`);
      console.log(`Successful: ${successCount}`);
      console.log(`Failed: ${failCount}`);
      console.log(`Skipped by user: ${skippedCount}`);
      console.log(`Skipped due to threshold (< ${MIN_AMOUNT_THRESHOLD} ${TOKEN.symbol}): ${skippedDueToThreshold}`);
      
      if (distributionCancelled) {
        console.log('\n⛔ Distribution was cancelled before completion');
      } else {
        console.log('\n=== Distribution Complete ===');
      }
      
      if (SIMULATION_MODE) {
        console.log('This was a simulation. Run with --doit flag to execute actual transactions');
      }
      
    } catch (error) {
      console.error(`Error reading or processing CSV file: ${error.message}`);
      console.error(`Make sure "${CSV_FILE}" exists in the current directory and has valid data.`);
      rl.close();
      process.exit(1);
    }
    
    rl.close();
  } catch (error) {
    console.error('Error in distributeFromCSV:', error);
    rl.close();
    process.exit(1);
  }
}

// Execute the script
distributeFromCSV().catch(error => {
  console.error('Fatal error in distributeFromCSV:', error);
  rl.close();
  process.exit(1);
}); 