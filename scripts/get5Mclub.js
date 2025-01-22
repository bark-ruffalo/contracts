const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config();

// Configuration
const STAKING_VAULT_ADDRESS = "0xA6FaCD417faf801107bF19F4a24062Ff15AE9C61";
const THRESHOLD = ethers.parseUnits("5000000", 18); // 5M tokens
const REQUEST_DELAY = 50; // ms between requests
const POOL_ID = 1; // Only check pool 1 ($mPAWSY)
const IGNORED_ADDRESS = "0xCfdc7f77c37268c14293ebD466768F6068D99461".toLowerCase();

// ABI for the functions we need
const ABI = [
  "function getLockedUsersByPool(uint256 poolId) external view returns (address[] memory)",
  "function getUserLocks(address user) external view returns (tuple(uint256 lockId, uint256 amount, uint256 lockPeriod, uint256 unlockTime, uint256 lastClaimTime, uint256 poolId, bool isLocked)[] memory)",
  "event Staked(address indexed user, uint256 indexed poolId, uint256 amount, uint256 lockPeriod)"
];

// Helper function to add delay between requests
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  // Initialize provider and contract
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const stakingVault = new ethers.Contract(STAKING_VAULT_ADDRESS, ABI, provider);

  console.log(`\nChecking Pool ${POOL_ID} ($mPAWSY) for addresses with >5M tokens staked:`);
  console.log('------------------------------------------------');

  try {
    // Get all stakers in the pool
    const stakers = await stakingVault.getLockedUsersByPool(POOL_ID);
    console.log(`Total stakers in pool: ${stakers.length}`);
    await delay(REQUEST_DELAY);

    let highStakersCount = 0;
    
    // Check each staker's locks
    for (const staker of stakers) {
      // Skip ignored address
      if (staker.toLowerCase() === IGNORED_ADDRESS) continue;

      const locks = await stakingVault.getUserLocks(staker);
      await delay(REQUEST_DELAY);

      // Calculate total staked amount in this pool
      const totalStaked = locks.reduce((sum, lock) => {
        if (lock.poolId === BigInt(POOL_ID) && lock.isLocked) {
          return sum + BigInt(lock.amount);
        }
        return sum;
      }, BigInt(0));

      // If staker has more than threshold
      if (totalStaked >= BigInt(THRESHOLD)) {
        highStakersCount++;
        console.log(`\nAddress: ${staker}`);
        console.log(`Total Staked: ${ethers.formatUnits(totalStaked, 18)}`);

        // Get staking transactions
        const filter = stakingVault.filters.Staked(staker, POOL_ID);
        const events = await stakingVault.queryFilter(filter);
        await delay(REQUEST_DELAY);

        // Print transaction links
        if (events.length > 0) {
          console.log('Staking Transactions:');
          events.forEach(event => {
            console.log(`https://basescan.org/tx/${event.transactionHash}`);
          });
        }
      }
    }
    
    console.log(`\nTotal high stakers (>5M): ${highStakersCount}`);
  } catch (error) {
    console.error(`Error processing pool ${POOL_ID}:`, error);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
