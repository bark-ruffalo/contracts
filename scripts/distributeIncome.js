const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Configuration
const TOKEN_ADDRESS = "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a";
const TOTAL_AMOUNT = ethers.parseUnits("10218124.191131321909275265", 18);  // Total amount to distribute
const NORMALIZATION_FACTOR = 0.2;  // How much to normalize (20% towards mean)

// ERC20 ABI (only the functions we need)
const TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// Parse command line arguments
const SHOULD_NORMALIZE = process.argv.includes('--normalize');
const SHOULD_EXECUTE = process.argv.includes('--doit');

// Add this near the top of the file
const SNAPSHOT_FILE = path.join(__dirname, 'staking-snapshot-2024-12-23T17-01-12-430Z.json'); // or whatever your JSON file is named

// Helper function to format table row
function formatTableRow(address, value, permille) {
  const paddedAddress = address.padEnd(43, ' ');
  const paddedValue = value.toFixed(2).padStart(13, ' ');
  const paddedPermille = permille.toFixed(4).padStart(11, ' ');
  return `${paddedAddress}| ${paddedValue} | ${paddedPermille}`;
}

// Normalize per mill values towards mean
function normalizePerMills(stakers) {
  const totalPerMill = stakers.reduce((sum, s) => sum + parseFloat(s.adjustedPerMill), 0);
  const meanPerMill = totalPerMill / stakers.length;
  
  return stakers.map(staker => ({
    ...staker,
    normalizedPerMill: parseFloat(staker.adjustedPerMill) + 
      (meanPerMill - parseFloat(staker.adjustedPerMill)) * NORMALIZATION_FACTOR
  }));
}

// Calculate token amounts based on per mill values
function calculateDistribution(stakers, totalAmount, useNormalized = false) {
  const perMillKey = useNormalized ? 'normalizedPerMill' : 'adjustedPerMill';
  const totalPerMill = stakers.reduce((sum, s) => sum + parseFloat(s[perMillKey]), 0);
  
  return stakers.map(staker => ({
    ...staker,
    tokenAmount: (BigInt(totalAmount) * BigInt(Math.floor(parseFloat(staker[perMillKey]) * 1e6))) / BigInt(Math.floor(totalPerMill * 1e6))
  }));
}

async function main() {
  // Load the specified snapshot
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`Snapshot file not found: ${SNAPSHOT_FILE}`);
  }

  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  
  // Normalize addresses and check for duplicates
  const addressMap = new Map();
  snapshot.stakers.forEach(staker => {
    const normalizedAddress = staker.address.toLowerCase();
    if (addressMap.has(normalizedAddress)) {
      throw new Error(`Duplicate address found: ${staker.address}`);
    }
    staker.address = normalizedAddress;
    addressMap.set(normalizedAddress, staker);
  });

  let stakers = Array.from(addressMap.values());

  // Sort stakers by per mill (descending)
  stakers.sort((a, b) => parseFloat(b.adjustedPerMill) - parseFloat(a.adjustedPerMill));

  // Show original distribution
  console.log("📊 Original Per Mill Distribution:");
  console.log("-----------------------------");
  console.log("Address                                      | Adjusted Value | Per Mill (‰)");
  console.log("-------------------------------------------|---------------|-------------");
  
  let totalPerMill = 0;
  stakers.forEach(staker => {
    const perMill = parseFloat(staker.adjustedPerMill);
    totalPerMill += perMill;
    console.log(formatTableRow(staker.address, parseFloat(staker.adjustedTotal), perMill));
  });
  
  console.log("-------------------------------------------|---------------|-------------");
  console.log(formatTableRow("TOTAL", parseFloat(snapshot.totalAdjustedStaked), totalPerMill));

  if (SHOULD_NORMALIZE) {
    // Normalize per mills
    stakers = normalizePerMills(stakers);
    
    // Sort by normalized per mill
    stakers.sort((a, b) => b.normalizedPerMill - a.normalizedPerMill);

    // Explain normalization
    console.log("\n📝 Normalization Process:");
    console.log("----------------------");
    console.log(`Each per mill is moved ${NORMALIZATION_FACTOR * 100}% towards the mean.`);
    console.log(`For example, if mean is 100‰ and a value is 200‰:`);
    console.log(`  200‰ + (100‰ - 200‰) × ${NORMALIZATION_FACTOR} = 180‰`);
    console.log("This reduces extreme values while maintaining relative positions.\n");

    // Show normalized distribution
    console.log("📊 Normalized Per Mill Distribution:");
    console.log("--------------------------------");
    console.log("Address                                      | Adjusted Value | Per Mill (‰)");
    console.log("-------------------------------------------|---------------|-------------");
    
    totalPerMill = 0;
    stakers.forEach(staker => {
      totalPerMill += staker.normalizedPerMill;
      console.log(formatTableRow(staker.address, parseFloat(staker.adjustedTotal), staker.normalizedPerMill));
    });
    
    console.log("-------------------------------------------|---------------|-------------");
    console.log(formatTableRow("TOTAL", parseFloat(snapshot.totalAdjustedStaked), totalPerMill));
  }

  // Verify per mill totals
  const perMillKey = SHOULD_NORMALIZE ? 'normalizedPerMill' : 'adjustedPerMill';
  const perMillSum = stakers.reduce((sum, s) => sum + parseFloat(s[perMillKey]), 0);
  if (Math.abs(perMillSum - 1000) > 0.0001) {
    console.error(`\n⚠️  Warning: Total per mill (${perMillSum.toFixed(4)}‰) deviates from 1000‰ by ${Math.abs(perMillSum - 1000).toFixed(4)}‰`);
  }

  if (SHOULD_EXECUTE) {
    // Initialize provider and signer
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("DEPLOYER_PRIVATE_KEY not found in .env file");
    }

    const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);
    const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

    // Calculate token distribution
    const distribution = calculateDistribution(stakers, TOTAL_AMOUNT, SHOULD_NORMALIZE);
    
    // Sort by amount ascending for execution
    distribution.sort((a, b) => a.tokenAmount < b.tokenAmount ? -1 : 1);
    
    // Check token balance
    const balance = await token.balanceOf(signer.address);
    if (balance < TOTAL_AMOUNT) {
      throw new Error(`Insufficient token balance. Have: ${ethers.formatUnits(balance, 18)}, Need: ${ethers.formatUnits(TOTAL_AMOUNT, 18)}`);
    }

    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice;

    console.log("\n🚀 Starting token distribution...");
    console.log(`Using ${SHOULD_NORMALIZE ? 'normalized' : 'original'} per mill values`);
    console.log(`Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
    console.log("Processing transactions from smallest to largest amount\n");

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query) => new Promise((resolve) => readline.question(query, resolve));

    try {
      let autoConfirm = false;
      for (let i = 0; i < distribution.length; i++) {
        const staker = distribution[i];
        console.log(`\nTransaction ${i + 1}/${distribution.length}:`);
        console.log(`To: ${staker.address}`);
        console.log(`Amount: ${ethers.formatUnits(staker.tokenAmount, 18)} tokens`);
        
        if (!autoConfirm) {
          const answer = await question('Continue with this transaction? (Y/n/a): ');
          if (answer.toLowerCase() === 'n') {
            console.log('Distribution cancelled by user');
            break;
          }
          if (answer.toLowerCase() === 'a') {
            autoConfirm = true;
            console.log('Auto-confirming all remaining transactions...');
          }
          if (answer !== '' && !['y', 'Y', 'a', 'A'].includes(answer)) {
            console.log('Distribution cancelled by user');
            break;
          }
        }

        console.log('Sending transaction...');
        const tx = await token.transfer(staker.address, staker.tokenAmount, {
          gasPrice
        });
        console.log(`Transaction hash: ${tx.hash}`);
        
        console.log('Waiting for confirmation...');
        const receipt = await tx.wait();
        console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
        
        // Optional delay between transactions
        if (i < distribution.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } finally {
      readline.close();
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }); 