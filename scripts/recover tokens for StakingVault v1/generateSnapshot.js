/**
 * generateSnapshot.js
 * 
 * Creates a snapshot of all staking positions and calculates 
 * what is owed to users after the emergencyUnlockAll bug
 * 
 * The script captures:
 * - Staked token amounts for each user by pool
 * - Unclaimed reward token amounts for each user
 * - Creates both detailed and summary JSON files
 * - Properly handles BigInt serialization
 * 
 * Usage:
 * - No arguments: Process all blocks from deployment to latest
 * - -n COUNT: Process only COUNT blocks from deployment
 */

const dotenv = require('dotenv');
const ethers = require('ethers');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Constants for block range
const DEPLOYMENT_BLOCK = 23699108;  // StakingVault deployment block
const EMERGENCY_UNLOCK_BLOCK = 26882126; // Block when emergency unlock happened
const DEFAULT_BLOCK_LIMIT = 4000000; // Default block limit if no argument provided
let blockLimit = DEFAULT_BLOCK_LIMIT;

// Chunk size for fetching logs - smaller chunks to avoid RPC timeouts
const FETCH_CHUNK_SIZE = 50000;

// Maximum retry attempts for RPC calls
const MAX_RETRIES = 3;
// Backoff time in ms between retries
const RETRY_BACKOFF = 2000;

// Staking Vault contract address
const STAKING_VAULT_ADDRESS = '0xA6FaCD417faf801107bF19F4a24062Ff15AE9C61';

// Pool tokens and their addresses
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

// Reward rates by pool ID and lock period from the contract
const POOL_REWARD_RATES = {
  '0': { 
    '4320000': 14,    // 50 days
    '8640000': 55,    // 100 days
    '17280000': 164,  // 200 days
    '34560000': 438   // 400 days
  },
  '1': { 
    '4320000': 68,    // 50 days
    '8640000': 164,   // 100 days
    '17280000': 383,  // 200 days
    '34560000': 876   // 400 days
  },
  '2': { 
    '4320000': 8118,  // 50 days
    '8640000': 18084, // 100 days
    '17280000': 39732,// 200 days
    '34560000': 86724 // 400 days
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
let useLatestBlock = true; // Default to using latest block
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-n' && i + 1 < args.length) {
    if (args[i + 1].toLowerCase() === 'latest') {
      useLatestBlock = true;
      console.log("Processing all blocks up to the latest block");
    } else {
      blockLimit = parseInt(args[i + 1]);
      if (isNaN(blockLimit)) {
        console.error(`Invalid block limit: ${args[i + 1]}. Using default value of ${DEFAULT_BLOCK_LIMIT}.`);
        blockLimit = DEFAULT_BLOCK_LIMIT;
      } else {
        useLatestBlock = false;
        console.log(`Processing only ${blockLimit} blocks from deployment`);
      }
    }
    i++;
  }
}

// Generate timestamp for file naming
const timestamp = Math.floor(Date.now() / 1000);

// Initialize provider using the Alchemy RPC URL from .env
const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
console.log('Connected to provider:', provider.connection?.url);

// Event signatures for topic filtering - using keccak256 hash of the event signature
const EVENT_SIGNATURES = {
  LOCKED: ethers.id("Locked(address,uint256,uint256,uint256,uint256,uint256)"),
  UNLOCKED: ethers.id("Unlocked(address,uint256,uint256,uint256)"),
  REWARDS_CLAIMED: ethers.id("RewardsClaimed(address,uint256,uint256)"),
  UNSTAKED: ethers.id("Unstaked(address,uint256,uint256,uint256)")
};

/**
 * Helper function to get reward rate based on pool ID and lock period
 * Matches the contract's getRewardRate logic
 */
const getRewardRate = (poolId, lockPeriod) => {
  const poolRates = POOL_REWARD_RATES[poolId.toString()];
  if (!poolRates) return 0;
  
  const rate = poolRates[lockPeriod.toString()];
  return rate || 0;
};

/**
 * Helper function to convert wei to a human-readable format with proper decimal places
 * @param {string} weiAmount - The amount in wei as a string
 * @param {number} decimals - Number of decimal places (default: 18)
 */
function formatWei(weiAmount, decimals = 18) {
  if (!weiAmount || weiAmount === '0') return '0';
  
  // Convert string to BigInt
  const amount = BigInt(weiAmount);
  
  // Convert to a decimal with proper decimal places
  const divisor = BigInt(10) ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  
  // Format integer part with commas for thousands separator
  const formattedInt = integerPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  
  // If no fractional part, return only integer part
  if (fractionalPart === BigInt(0)) return formattedInt;
  
  // Otherwise format the fractional part with leading zeros if needed
  let fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  // Trim trailing zeros
  fractionalStr = fractionalStr.replace(/0+$/, '');
  
  return `${formattedInt}.${fractionalStr}`;
}

/**
 * Helper function to safely serialize BigInt values in JSON
 * @param {any} key - The key in the JSON object
 * @param {any} value - The value which might be a BigInt
 */
function replacer(key, value) {
  // Convert BigInt to string to avoid serialization errors
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Helper function to retry a function with exponential backoff
 * @param {Function} fn - The async function to retry
 * @param {number} retries - Number of retries
 * @param {number} backoff - Initial backoff time in ms
 */
async function retryWithBackoff(fn, retries = MAX_RETRIES, backoff = RETRY_BACKOFF) {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) {
      throw error;
    }
    
    console.log(`Retrying after error: ${error.message}. Retries left: ${retries}`);
    await new Promise(resolve => setTimeout(resolve, backoff));
    
    return retryWithBackoff(fn, retries - 1, backoff * 2);
  }
}

/**
 * Optimized function to fetch events using Alchemy's eth_getLogs
 * @param {string} eventSignature - The event signature hash
 * @param {number} fromBlock - Start block
 * @param {number} toBlock - End block
 * @param {Array} additionalTopics - Optional additional topics for filtering
 */
async function fetchEvents(eventSignature, fromBlock, toBlock, additionalTopics = []) {
  const topics = [eventSignature, ...additionalTopics];
  
  // Create filter with proper hexadecimal block numbers as required by Alchemy
  const filter = {
    address: STAKING_VAULT_ADDRESS,
    topics: topics,
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16)
  };
  
  return await retryWithBackoff(async () => {
    return await provider.getLogs(filter);
  });
}

/**
 * Helper function to get a block's timestamp
 * @param {number} blockNumber - The block number
 * @returns {Promise<number>} - The block timestamp
 */
async function getBlockTimestamp(blockNumber) {
  try {
    return await retryWithBackoff(async () => {
      const block = await provider.getBlock(blockNumber);
      return block.timestamp;
    });
  } catch (error) {
    console.error(`Error getting block timestamp for block ${blockNumber}:`, error);
    // Return current timestamp as fallback
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Main function to generate the snapshot
 */
async function generateSnapshot() {
  try {
    console.log('Starting snapshot generation process');
    
    // Get the latest block number
    const latestBlock = await provider.getBlockNumber();
    console.log(`Latest block: ${latestBlock}`);
    
    // Set block range
    const START_BLOCK = DEPLOYMENT_BLOCK;
    let END_BLOCK;
    
    if (useLatestBlock) {
      // If using latest option, go from fixed start to current latest block
      END_BLOCK = latestBlock;
      console.log(`Using latest block (${END_BLOCK}) as end block`);
    } else {
      // Otherwise use the specified block limit
      END_BLOCK = Math.min(START_BLOCK + blockLimit, latestBlock);
      console.log(`Using block ${END_BLOCK} as end block (${END_BLOCK - START_BLOCK} blocks from deployment)`);
    }
    
    // Calculate total blocks to process
    const totalBlocks = END_BLOCK - START_BLOCK;
    console.log(`Total blocks to process: ${totalBlocks}`);
    
    // Snapshot data structure
    const snapshot = {
      metadata: {
        createdAt: new Date().toISOString(),
        startBlock: START_BLOCK,
        endBlock: END_BLOCK,
        totalBlocks: totalBlocks,
        emergencyUnlockBlock: EMERGENCY_UNLOCK_BLOCK,
        contract: STAKING_VAULT_ADDRESS,
        poolTokens: POOL_TOKENS
      },
      users: {},
      totalStaked: {
        '0': BigInt(0),
        '1': BigInt(0),
        '2': BigInt(0)
      },
      totalRewards: {
        total: BigInt(0)
      }
    };
    
    // Initialize position map to track all positions
    const positionMap = {};
    
    // Process all events
    
    // 1. First fetch and process Locked events
    console.log('Fetching Locked events');
    let totalLockedEvents = 0;
    
    for (let fromBlock = START_BLOCK; fromBlock < END_BLOCK; fromBlock += FETCH_CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + FETCH_CHUNK_SIZE - 1, END_BLOCK);
      
      const progress = Math.floor(((fromBlock - START_BLOCK) / totalBlocks) * 100);
      console.log(`Fetching Locked events: ${progress}% complete (blocks ${fromBlock} to ${toBlock})`);
      
      try {
        // Fetch Locked events
        const lockedLogs = await fetchEvents(EVENT_SIGNATURES.LOCKED, fromBlock, toBlock);
        
        console.log(`Found ${lockedLogs.length} Locked events in blocks ${fromBlock} to ${toBlock}`);
        totalLockedEvents += lockedLogs.length;
        
        // Process each Locked event
        for (const log of lockedLogs) {
          try {
            // Extract user address from first topic (indexed parameter)
            const userAddress = '0x' + log.topics[1].slice(26).toLowerCase();
            // Extract lockId from second topic (indexed parameter)
            const lockId = parseInt(log.topics[2], 16);
            
            // Parse the data field for non-indexed parameters
            const dataWithoutPrefix = log.data.slice(2); // Remove 0x prefix
            const amount = BigInt('0x' + dataWithoutPrefix.slice(0, 64));
            const lockPeriod = parseInt('0x' + dataWithoutPrefix.slice(64, 128), 16);
            const unlockTime = parseInt('0x' + dataWithoutPrefix.slice(128, 192), 16);
            const poolId = parseInt('0x' + dataWithoutPrefix.slice(192, 256), 16);
            
            // Create a position key for the map
            const key = `${userAddress.toLowerCase()}-${lockId}`;
            positionMap[key] = {
              user: userAddress.toLowerCase(),
              lockId,
              amount: amount,
              lockPeriod,
              unlockTime,
              poolId,
              rewards: BigInt(0),
              lastClaimTime: log.blockNumber, // Use block number as initial claim time reference
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              unstaked: false,
              isLocked: true // Initially all positions are locked
            };
            
            // Add user to the snapshot if not exists
            if (!snapshot.users[userAddress.toLowerCase()]) {
              snapshot.users[userAddress.toLowerCase()] = {
                address: userAddress.toLowerCase(),
                positions: [],
                totalOwed: {
                  tokens: {
                    '0': BigInt(0),
                    '1': BigInt(0),
                    '2': BigInt(0)
                  },
                  rewards: BigInt(0)
                }
              };
            }
            
            // Add position to the user's positions
            snapshot.users[userAddress.toLowerCase()].positions.push({
              lockId,
              amount: amount,
              lockPeriod,
              unlockTime,
              poolId,
              rewards: BigInt(0),
              lastClaimTime: log.blockNumber,
              unstaked: false,
              isLocked: true
            });
          } catch (error) {
            console.error(`Error processing Locked event:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching Locked events for blocks ${fromBlock} to ${toBlock}:`, error);
        // If we hit errors, slow down and try a smaller chunk
        const newChunkSize = Math.max(Math.floor(FETCH_CHUNK_SIZE / 2), 100);
        if (FETCH_CHUNK_SIZE !== newChunkSize) {
          console.log(`Reducing chunk size to ${newChunkSize} and retrying...`);
          FETCH_CHUNK_SIZE = newChunkSize;
          fromBlock -= FETCH_CHUNK_SIZE; // Back up to retry this block range
        }
      }
    }
    
    console.log(`Total locked events processed: ${totalLockedEvents}`);
    
    // 2. Fetch and process Unlocked events
    console.log('Fetching Unlocked events');
    let totalUnlockedEvents = 0;
    
    for (let fromBlock = START_BLOCK; fromBlock < END_BLOCK; fromBlock += FETCH_CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + FETCH_CHUNK_SIZE - 1, END_BLOCK);
      
      const progress = Math.floor(((fromBlock - START_BLOCK) / totalBlocks) * 100);
      console.log(`Fetching Unlocked events: ${progress}% complete (blocks ${fromBlock} to ${toBlock})`);
      
      try {
        // Fetch Unlocked events
        const unlockedLogs = await fetchEvents(EVENT_SIGNATURES.UNLOCKED, fromBlock, toBlock);
        
        console.log(`Found ${unlockedLogs.length} Unlocked events in blocks ${fromBlock} to ${toBlock}`);
        totalUnlockedEvents += unlockedLogs.length;
        
        // Process each Unlocked event
        for (const log of unlockedLogs) {
          try {
            // Extract user address from first topic (indexed parameter)
            const userAddress = '0x' + log.topics[1].slice(26).toLowerCase();
            // Extract lockId from second topic (indexed parameter)
            const lockId = parseInt(log.topics[2], 16);
            
            // Parse data for amount and poolId (not needed for this operation)
            const dataWithoutPrefix = log.data.slice(2);
            // Skip parsing these values as they're not used
            // const amount = BigInt('0x' + dataWithoutPrefix.slice(0, 64));
            // const poolId = parseInt('0x' + dataWithoutPrefix.slice(64, 128), 16);
            
            // Update position in the map
            const key = `${userAddress.toLowerCase()}-${lockId}`;
            
            if (positionMap[key]) {
              positionMap[key].isLocked = false;
              positionMap[key].unlocked = true; // Mark as unlocked
              positionMap[key].unlockBlock = log.blockNumber;
            }
            
            // Update position in the snapshot
            if (snapshot.users[userAddress.toLowerCase()]) {
              const position = snapshot.users[userAddress.toLowerCase()].positions.find(p => p.lockId === lockId);
              if (position) {
                position.isLocked = false;
                position.unlocked = true;
                position.unlockBlock = log.blockNumber;
              }
            }
          } catch (error) {
            console.error(`Error processing Unlocked event:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching Unlocked events for blocks ${fromBlock} to ${toBlock}:`, error);
      }
    }
    
    console.log(`Total unlocked events processed: ${totalUnlockedEvents}`);
    
    // 3. Fetch and process RewardsClaimed events
    console.log('Fetching RewardsClaimed events');
    let totalRewardsClaimedEvents = 0;
    
    for (let fromBlock = START_BLOCK; fromBlock < END_BLOCK; fromBlock += FETCH_CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + FETCH_CHUNK_SIZE - 1, END_BLOCK);
      
      const progress = Math.floor(((fromBlock - START_BLOCK) / totalBlocks) * 100);
      console.log(`Fetching RewardsClaimed events: ${progress}% complete (blocks ${fromBlock} to ${toBlock})`);
      
      try {
        // Fetch RewardsClaimed events
        const rewardsClaimedLogs = await fetchEvents(EVENT_SIGNATURES.REWARDS_CLAIMED, fromBlock, toBlock);
        
        console.log(`Found ${rewardsClaimedLogs.length} RewardsClaimed events in blocks ${fromBlock} to ${toBlock}`);
        totalRewardsClaimedEvents += rewardsClaimedLogs.length;
        
        // Process each RewardsClaimed event
        for (const log of rewardsClaimedLogs) {
          try {
            // Extract user address from first topic (indexed parameter)
            const userAddress = '0x' + log.topics[1].slice(26).toLowerCase();
            // Extract poolId from second topic (indexed parameter)
            const poolId = parseInt(log.topics[2], 16);
            
            // We don't need to parse the amount for this operation
            // const dataWithoutPrefix = log.data.slice(2);
            // const amount = BigInt('0x' + dataWithoutPrefix.slice(0, 64));
            
            // Update positions for this user with matching poolId
            if (snapshot.users[userAddress.toLowerCase()]) {
              const userPositions = snapshot.users[userAddress.toLowerCase()].positions;
              for (const position of userPositions) {
                if (position.poolId === poolId) {
                  position.lastClaimTime = log.blockNumber;
                }
              }
            }
            
            // Update position map entries
            for (const key in positionMap) {
              if (key.startsWith(userAddress.toLowerCase()) && positionMap[key].poolId === poolId) {
                positionMap[key].lastClaimTime = log.blockNumber;
              }
            }
          } catch (error) {
            console.error(`Error processing RewardsClaimed event:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching RewardsClaimed events for blocks ${fromBlock} to ${toBlock}:`, error);
      }
    }
    
    console.log(`Total rewards claimed events processed: ${totalRewardsClaimedEvents}`);
    
    // 4. Fetch and process Unstaked events
    console.log('Fetching Unstaked events');
    let totalUnstakedEvents = 0;
    
    for (let fromBlock = START_BLOCK; fromBlock < END_BLOCK; fromBlock += FETCH_CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + FETCH_CHUNK_SIZE - 1, END_BLOCK);
      
      const progress = Math.floor(((fromBlock - START_BLOCK) / totalBlocks) * 100);
      console.log(`Fetching Unstaked events: ${progress}% complete (blocks ${fromBlock} to ${toBlock})`);
      
      try {
        // Fetch Unstaked events
        const unstakedLogs = await fetchEvents(EVENT_SIGNATURES.UNSTAKED, fromBlock, toBlock);
        
        console.log(`Found ${unstakedLogs.length} Unstaked events in blocks ${fromBlock} to ${toBlock}`);
        totalUnstakedEvents += unstakedLogs.length;
        
        // Process each Unstaked event
        for (const log of unstakedLogs) {
          try {
            // Extract user address from first topic (indexed parameter)
            const userAddress = '0x' + log.topics[1].slice(26).toLowerCase();
            // Extract poolId from second topic (indexed parameter)
            const poolId = parseInt(log.topics[2], 16);
            
            // We don't need to parse these for our logic
            // const dataWithoutPrefix = log.data.slice(2);
            // const amount = BigInt('0x' + dataWithoutPrefix.slice(0, 64));
            
            // Update positions for this user with matching poolId
            if (snapshot.users[userAddress.toLowerCase()]) {
              const userPositions = snapshot.users[userAddress.toLowerCase()].positions;
              for (let i = 0; i < userPositions.length; i++) {
                if (userPositions[i].poolId === poolId && !userPositions[i].unstaked) {
                  userPositions[i].unstaked = true;
                  userPositions[i].unstakeBlock = log.blockNumber;
                  break; // Unstaked should only affect one position
                }
              }
            }
            
            // Update position map
            for (const key in positionMap) {
              if (key.startsWith(userAddress.toLowerCase()) && positionMap[key].poolId === poolId && !positionMap[key].unstaked) {
                positionMap[key].unstaked = true;
                positionMap[key].unstakeBlock = log.blockNumber;
                break; // Only affect one position per unstake event
              }
            }
          } catch (error) {
            console.error(`Error processing Unstaked event:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching Unstaked events for blocks ${fromBlock} to ${toBlock}:`, error);
      }
    }
    
    console.log(`Total unstaked events processed: ${totalUnstakedEvents}`);
    
    // Calculate rewards and total owed amounts for all positions
    console.log('Calculating rewards for all positions');
    
    let usersWithOutstandingBalances = 0;
    let totalOutstandingPositions = 0;
    
    // Get the last block timestamp for reward calculations
    console.log(`Fetching timestamp for block ${END_BLOCK}`);
    const latestBlockData = await provider.getBlock(END_BLOCK);
    const latestTimestamp = latestBlockData.timestamp;
    console.log(`Latest block timestamp: ${latestTimestamp} (${new Date(latestTimestamp * 1000).toISOString()})`);
    
    // Get emergency unlock block timestamp if applicable
    let emergencyUnlockTimestamp = null;
    if (EMERGENCY_UNLOCK_BLOCK && EMERGENCY_UNLOCK_BLOCK < END_BLOCK) {
      console.log(`Fetching timestamp for emergency unlock block ${EMERGENCY_UNLOCK_BLOCK}`);
      const emergencyBlockData = await provider.getBlock(EMERGENCY_UNLOCK_BLOCK);
      emergencyUnlockTimestamp = emergencyBlockData.timestamp;
      console.log(`Emergency unlock timestamp: ${emergencyUnlockTimestamp} (${new Date(emergencyUnlockTimestamp * 1000).toISOString()})`);
    }
    
    // Cache for block timestamps to avoid repeated requests
    const blockTimestampCache = {};
    
    /**
     * Helper function to get block timestamp with caching
     */
    async function getCachedBlockTimestamp(blockNumber) {
      if (blockTimestampCache[blockNumber]) {
        return blockTimestampCache[blockNumber];
      }
      
      const timestamp = await getBlockTimestamp(blockNumber);
      blockTimestampCache[blockNumber] = timestamp;
      return timestamp;
    }
    
    // Track users with outstanding amounts for the summary
    const summaryData = {
      metadata: {
        createdAt: new Date().toISOString(),
        startBlock: START_BLOCK,
        endBlock: END_BLOCK,
        totalBlocks: totalBlocks,
        emergencyUnlockBlock: EMERGENCY_UNLOCK_BLOCK
      },
      users: {}
    };
    
    // Process each user
    const userAddresses = Object.keys(snapshot.users);
    console.log(`Processing rewards for ${userAddresses.length} users`);
    
    for (let i = 0; i < userAddresses.length; i++) {
      const userAddress = userAddresses[i];
      console.log(`Processing user ${i+1}/${userAddresses.length} (${userAddress})`);
      
      let userHasOutstandingBalance = false;
      
      // Reset user's total owed amounts
      snapshot.users[userAddress].totalOwed = {
        tokens: {
          '0': BigInt(0),
          '1': BigInt(0),
          '2': BigInt(0)
        },
        rewards: BigInt(0)
      };
      
      // Process each position of the user
      for (const position of snapshot.users[userAddress].positions) {
        // Skip already unstaked positions
        if (position.unstaked) {
          continue;
        }
        
        // If position is still locked or unlocked but not unstaked,
        // the user is owed their staked tokens
        snapshot.users[userAddress].totalOwed.tokens[position.poolId] += position.amount;
        userHasOutstandingBalance = true;
        totalOutstandingPositions++;
        
        // Add to total staked by pool
        snapshot.totalStaked[position.poolId] += position.amount;
        
        // Get reward rate for this position
        const rewardRate = getRewardRate(position.poolId, position.lockPeriod);
        
        if (rewardRate === 0) {
          console.warn(`Warning: No reward rate found for pool ${position.poolId} and lock period ${position.lockPeriod}`);
          continue;
        }
        
        // Get timestamp for last claim or lock event
        const lastBlockTimestamp = await getCachedBlockTimestamp(position.lastClaimTime);
        
        // Determine staking end timestamp
        let stakingEndTimestamp;
        if (emergencyUnlockTimestamp) {
          // Use emergency unlock block timestamp if it exists
          stakingEndTimestamp = emergencyUnlockTimestamp;
        } else {
          // Otherwise use latest block timestamp
          stakingEndTimestamp = latestTimestamp;
        }
        
        // Calculate staking time in seconds
        const stakingTime = stakingEndTimestamp - lastBlockTimestamp;
        
        // Calculate rewards using the contract's formula:
        // rewards = (amount * rewardRate * stakingTime) / (lockPeriod * 10000)
        const rewards = (position.amount * BigInt(rewardRate) * BigInt(stakingTime)) / BigInt(position.lockPeriod * 10000);
        
        position.rewards = rewards;
        position.stakingTime = stakingTime;
        position.rewardRate = rewardRate;
        
        // Add to user's total rewards
        snapshot.users[userAddress].totalOwed.rewards += rewards;
        
        // Add to total rewards
        snapshot.totalRewards.total += rewards;
        
        console.log(`User ${userAddress} has lock with ID ${position.lockId} in pool ${position.poolId} with amount ${formatWei(position.amount.toString())} and calculated rewards ${formatWei(rewards.toString())}`);
      }
      
      // If user has outstanding balance, add to the summary
      if (userHasOutstandingBalance) {
        usersWithOutstandingBalances++;
        
        // Add user to summary data
        summaryData.users[userAddress] = {
          tokens: {
            '0': snapshot.users[userAddress].totalOwed.tokens['0'].toString(),
            '1': snapshot.users[userAddress].totalOwed.tokens['1'].toString(),
            '2': snapshot.users[userAddress].totalOwed.tokens['2'].toString()
          },
          tokensReadable: {
            '0': formatWei(snapshot.users[userAddress].totalOwed.tokens['0'].toString()),
            '1': formatWei(snapshot.users[userAddress].totalOwed.tokens['1'].toString()),
            '2': formatWei(snapshot.users[userAddress].totalOwed.tokens['2'].toString())
          },
          rewards: snapshot.users[userAddress].totalOwed.rewards.toString(),
          rewardsReadable: formatWei(snapshot.users[userAddress].totalOwed.rewards.toString())
        };
      }
      
      console.log(`Progress: ${i+1}/${userAddresses.length} users (${((i+1)/userAddresses.length*100).toFixed(2)}%)`);
    }
    
    console.log(`Found ${usersWithOutstandingBalances} users with outstanding balances or rewards`);
    
    // Add summary data to the full snapshot
    snapshot.summary = {
      usersWithOutstandingBalances,
      totalOutstandingPositions,
      totalStaked: {
        '0': snapshot.totalStaked['0'].toString(),
        '0Readable': formatWei(snapshot.totalStaked['0'].toString()),
        '1': snapshot.totalStaked['1'].toString(),
        '1Readable': formatWei(snapshot.totalStaked['1'].toString()),
        '2': snapshot.totalStaked['2'].toString(),
        '2Readable': formatWei(snapshot.totalStaked['2'].toString())
      },
      totalRewards: {
        total: snapshot.totalRewards.total.toString(),
        totalReadable: formatWei(snapshot.totalRewards.total.toString())
      }
    };
    
    // Add summary data to the summary file
    summaryData.summary = snapshot.summary;
    
    // Generate filenames with timestamp and block count
    const detailedFilename = `staking_snapshot_detailed_${totalBlocks}_blocks_${timestamp}.json`;
    const summaryFilename = `staking_snapshot_summary_${timestamp}.json`;
    
    // Convert BigInt to strings in the detailed snapshot before saving
    console.log('Converting BigInt values to strings for JSON serialization...');
    const processedSnapshot = JSON.parse(JSON.stringify(snapshot, replacer));
    
    // Save snapshots to files
    console.log(`Writing detailed snapshot to ${detailedFilename}...`);
    fs.writeFileSync(detailedFilename, JSON.stringify(processedSnapshot, null, 2));
    console.log(`Detailed snapshot saved to ${detailedFilename}`);
    
    console.log(`Writing summary snapshot to ${summaryFilename}...`);
    fs.writeFileSync(summaryFilename, JSON.stringify(summaryData, null, 2));
    console.log(`Summary snapshot saved to ${summaryFilename}`);
    
    console.log('Snapshot generation complete!');
    console.log(`Summary: ${usersWithOutstandingBalances} users with outstanding balances across ${totalOutstandingPositions} positions`);
    console.log(`Total staked tokens by pool:`);
    console.log(`  Pool 0 (PAWSY): ${formatWei(snapshot.totalStaked['0'].toString())}`);
    console.log(`  Pool 1 (mPAWSY): ${formatWei(snapshot.totalStaked['1'].toString())}`);
    console.log(`  Pool 2 (LP): ${formatWei(snapshot.totalStaked['2'].toString())}`);
    console.log(`Total rewards: ${formatWei(snapshot.totalRewards.total.toString())}`);
    
  } catch (error) {
    console.error('Fatal error in generateSnapshot:', error);
    throw error;
  }
}

// Execute the snapshot generation
generateSnapshot().catch(error => {
  console.error('Error generating snapshot:', error);
  process.exit(1);
}); 