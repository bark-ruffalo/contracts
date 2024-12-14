# Contracts used in the Bark Ruffalo ecosystem

> **🎁 Free to Use for any crypto project or AI Agent builder!**  
> We just ask the teams to consider airdropping our DAO address or our $PAWSY holders with a small amount.
>
> Holders: https://basescan.org/token/0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a#balances
>
> DAO address: 0xc638FB83d2bad5dD73d4C7c7deC0445d46a0716F

## Overview

The ecosystem consists of four main contracts:

1. **Staking vault:** Stake and lock $PAWSY for various periods of time.
2. **Reward token:** Only mintable by the staking vault; tracks user ecosystem contributions.
3. **Rewards market:** Enables devs/DAO to create campaigns for token exchanges (e.g., reward tokens for NFTs).
4. **Token Migration:** Facilitates migration from $PAWSY to $mPAWSY, a new token with enhanced features.

## Core Contracts

### TokenMigration.sol

A contract that manages the migration process from the existing $PAWSY token to the new $mPAWSY token.

#### Key Features

- **Migration Mechanics**
  - One-way migration from $PAWSY to $mPAWSY
  - 1:1 token exchange ratio
  - Supports partial and complete migrations
  - Migrated tokens are burned to maintain supply

- **Access Control**
  - Only allows migration from token holders
  - Admin functions for migration control and setup

- **Integration**
  - Works with existing $PAWSY token contract
  - Mints new $mPAWSY tokens during migration

### MigratedToken.sol

The new $mPAWSY token contract with additional features and upgradability.

#### Key Features

- **ERC20 Extensions**
  - Mintable supply for reward distribution
  - Permit functionality for gasless approvals
  - Votes tracking by block number
  - Detailed NatSpec comments

- **Access Control**
  - Role-based access control for minting and admin functions
  - Ownership transfer capabilities

- **Upgradability**
  - Implements transparent proxy pattern for upgradeability
  - Allows addition of new features and fixes post-deployment

### RewardsMarket.sol

A sophisticated campaign management system that enables configurable reward distributions through token burning or spending mechanics.

#### Key Features

- **Token Management**
  - Optional and mutable reward token integration
  - Support for native RewardToken burning
  - Integration with any ERC20 token
  - Configurable token recipient (burn or transfer)
  - Safe token transfer handling via OpenZeppelin's SafeERC20

- **Campaign Management**
  - Create campaigns with customizable parameters
  - Modify existing campaign configurations
  - Deactivate campaigns when needed
  - Support for both time-limited and unlimited duration campaigns
  - Maximum reward caps with tracking
  - Campaign activity status tracking

- **Security Features**
  - ReentrancyGuard implementation
  - Pausable functionality for emergency stops
  - Owner-controlled administrative functions
  - Token recovery for mistakenly sent tokens
  - Comprehensive input validation

- **Campaign Querying**
  - Efficient pagination support
  - Active/Inactive campaign filtering
  - Detailed campaign information retrieval
  - User participation tracking

#### Campaign Structure

```solidity
struct Campaign {
  uint256 minBurnAmount;    // Minimum tokens required
  uint256 endDate;          // Campaign end timestamp
  uint256 maxRewards;       // Maximum reward limit
  uint256 rewardsIssued;    // Current reward count
  address targetContract;    // External contract for rewards
  bytes targetCalldata;     // External call configuration
  bool isActive;            // Campaign status
  uint256 createdAt;        // Creation timestamp
  address tokenAddress;      // Token to be spent
  address recipientAddress; // Token recipient
}
```

### RewardToken.sol

An ERC20 token implementation specifically designed for the rewards system.

#### Features

- **Token Standards**
  - ERC20 compliant
  - Burnable token functionality
  - Permit functionality for gasless approvals

- **Access Control**
  - Role-based access control system
  - Configurable minting permissions
  - Controlled burning mechanics

- **Integration Features**
  - Seamless integration with RewardsMarket
  - Burn-from capability for campaign mechanics
  - Supply tracking and management

### StakingVault.sol

A flexible staking system that manages token deposits and rewards distribution.

#### Key Features

- **Staking Mechanics**
  - Flexible stake duration configuration
  - Minimum/maximum stake amounts
  - Stake locking with time constraints
  - Early withdrawal penalties

- **Reward System**
  - Time-based reward calculation
  - Configurable reward rates
  - Compound interest mechanics
  - Reward boost multipliers

- **Security Features**
  - Emergency withdrawal system
  - Rate limiting on critical functions
  - Slippage protection
  - Reentrancy protection

#### Staking Rate Calculations

The staking system uses Simple Interest Rate (SIR) calculations to determine reward rates. The rates are configured during deployment and can be calculated using the following formula:

```
Contract Rate = (Target SIR % / 100) * (Lock Period / Year in Seconds) * 10000
```

For example, for a 50-day lock period targeting 5% SIR:

- Lock Period = 50 days = 4,320,000 seconds
- Year = 365.2425 days = 31,556,952 seconds
- Contract Rate = (5/100) _ (4,320,000/31,556,952) _ 10000 ≈ 68

The contract uses these rates to calculate rewards:

```solidity
rewards = (amount * rate * stakingTime) / (lockPeriod * 10000)
```

#### Rate Configuration Tools

##### Utility Script

Use the `calculateStakingRates.ts` script to calculate contract rates:

```bash
# Calculate rates for specific SIRs and periods
yarn ts-node scripts/calculateStakingRates.ts 1 2 3 4 --periods "50,100,200,400"

# Example output:
📊 Staking Rate Calculations:
Target SIRs: 1%, 2%, 3%, 4%
Calculated Rates: 68, 137, 274, 548

Detailed Breakdown:
50 days lock:
  Target SIR: 1%
  Rate to use in contract: 68
  Actual SIR: 1.00%
  Rate per period: 0.68%
```

##### Deployment Configuration

The deployment script (`00_deployStaking.ts`) accepts target SIRs as input and automatically calculates the appropriate contract rates. Current configuration:

```typescript
// PAWSY token staking rates
const PAWSY_TARGET_SIRS = [1, 2, 3, 4]; // Target SIRs in percentage
const TIMELOCK_PERIODS = [
  50 * 24 * 60 * 60, // 50 days
  100 * 24 * 60 * 60, // 100 days
  200 * 24 * 60 * 60, // 200 days
  400 * 24 * 60 * 60, // 400 days
];

// LP token staking rates
const LP_TARGET_SIRS = [5, 6, 7, 8]; // Higher rates for LP staking
```

To modify staking rates:

1. Update the target SIRs in `00_deployStaking.ts`
2. Use `calculateStakingRates.ts` to verify calculations
3. Deploy with new rates:

```bash
yarn deploy --tags Staking --network baseSepolia
```

## Development Commands

### Installation & Setup

```bash
# Install dependencies
yarn install

# Compile contracts
yarn compile
```

### Testing

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn coverage
```

### Deployment

The deployment is split into three main parts that can be deployed independently:

#### 1. Staking System

Deploys the RewardToken and StakingVault contracts on Base Sepolia:

```bash
yarn deploy --tags Staking --network baseSepolia
```

#### 2. Rewards Market

Deploys the RewardsMarket contract (requires Staking system to be deployed first) on Base Sepolia:

```bash
yarn deploy --tags RewardsMarket --network baseSepolia
```

#### 3. Token Migration

Deploys the TokenMigration and MigratedToken contracts on Base Sepolia:

```bash
yarn deploy --tags Migration --network baseSepolia
```

### Deployment Tags

The deployment scripts use tags to enable granular deployments. Available tags:

- `Staking`: Deploys the staking system (`00_deployStaking.ts`)
- `RewardsMarket`: Deploys the rewards market (`01_deployRewardsMarket.ts`)
- `Migration`: Deploys the token migration system (`02_deployTokenMigration.ts`) 
- `TestnetToken`: Deploys a test token on the testnet (`03_deployTestnetToken.ts`)

To deploy with specific tags:

```bash
yarn deploy --tags Staking,RewardsMarket
```

This allows for targeted deployments and avoids unnecessary redeployments of unmodified contracts.

### Other Deployment Options

```bash
# Deploy everything at once
yarn deploy

# Deploy to Base Sepolia testnet
yarn deploy:base-sepolia

# Verify contracts on Base Sepolia
yarn verify:base-sepolia
```

### Manual Contract Verification

If you need to verify contracts individually:

```bash
# Verify RewardToken
npx hardhat verify --network baseSepolia DEPLOYED_REWARD_TOKEN_ADDRESS

# Verify StakingVault (requires RewardToken address as constructor arg)
npx hardhat verify --network baseSepolia DEPLOYED_STAKING_VAULT_ADDRESS REWARD_TOKEN_ADDRESS

# Verify RewardsMarket (requires RewardToken address as constructor arg)
npx hardhat verify --network baseSepolia DEPLOYED_REWARDS_MARKET_ADDRESS REWARD_TOKEN_ADDRESS
```

For example:

```bash
# Example with real addresses
npx hardhat verify --network baseSepolia 0x1234...5678
npx hardhat verify --network baseSepolia 0x8765...4321 0x1234...5678
```

### Environment Variables

The project uses a `.env` file to manage sensitive information and configuration. The `.env.example` file provides a template:

```bash
# Forking RPC URL for local testing
FORKING_URL=

# Private key for the deployer account
DEPLOYER_PRIVATE_KEY=

# Public key of the Ledger hardware wallet 
# If not set, defaults to DEPLOYER_PRIVATE_KEY
LEDGER_PUBLIC_KEY=

# Etherscan API key for contract verification  
ETHERSCAN_API_KEY=

# Alchemy API key for network access
ALCHEMY_API_KEY=

# Enable gas reporting
REPORT_GAS=true

# Base network RPC URL
BASE_RPC_URL=

# Existing token addresses  
PAWSY_TOKEN=
LP_TOKEN=
mPAWSY_TOKEN=
```

To use the `.env` file:

1. Copy `.env.example` to `.env`
2. Fill in the required values
3. Access variables via `process.env.VARIABLE_NAME`

Note: The `LEDGER_PUBLIC_KEY` variable is optional. If not set, the deployment scripts will default to using the `DEPLOYER_PRIVATE_KEY` for deployments.

### Utility Scripts

The project includes several utility scripts to assist with development and testing:

- `generateAccount.ts`: Generates a new random private key and saves it to the `.env` file.
- `listAccount.ts`: Displays the deployer account address and balances across different networks.

To run the scripts:

```bash
# Generate a new deployer account
yarn generate

# List deployer account details
yarn list  
```

### Code Quality

```bash
# Run linters
yarn lint

# Format code
yarn format
```

### Local Development

```bash
# Start local hardhat network
yarn hardhat node

# Clean artifacts and cache
yarn clean
```

### Static Analysis

Static analysis tools help identify potential vulnerabilities and code quality issues before deployment. We use Slither as our primary static analyzer.

#### Installing Slither

```bash
# Install Slither
pip3 install slither-analyzer

# Verify installation
slither --version
```

#### Running Analysis

```bash
# Run basic Slither analysis
slither .

# Run with specific configuration
slither . --config-file slither.config.json

# Generate detailed JSON report
slither . --json slither-report.json

# Check specific contract
slither contracts/RewardsMarket.sol
```

Common Slither detectors include:

- Reentrancy vulnerabilities
- Access control issues
- Arithmetic operations that could overflow
- Uninitialized state variables
- Gas optimization opportunities
- Unused state variables
- Incorrect function visibility

### Development Environment

#### Core Tools

- Hardhat v2.19.x
- TypeScript v5.x
- Ethers.js v6.x
- OpenZeppelin Contracts v5.x

#### Testing Framework

- Chai for assertions
- Hardhat-deploy for deployment testing
- Hardhat Network for local blockchain
- Solidity Coverage for test coverage
- Gas Reporter for optimization

#### Code Quality Tools

- Solhint for Solidity linting
- ESLint for TypeScript
- Prettier for formatting
- TypeChain for type safety

### Deployment Architecture

The deployment process follows a specific order to ensure proper contract initialization:

1. **Staking System (`00_deployStaking.ts`)**
   - Deploys RewardToken
   - Deploys StakingVault
   - Transfers RewardToken ownership to StakingVault
   - Initializes staking pools with configurable parameters

2. **Rewards Market (`01_deployRewardsMarket.ts`)**
   - Requires RewardToken to be deployed
   - Deploys RewardsMarket with RewardToken integration
   - Independent operation after deployment

3. **Token Migration (`02_deployTokenMigration.ts`)**
   - Requires existing $PAWSY token
   - Deploys MigratedToken ($mPAWSY)
   - Deploys TokenMigration with $PAWSY and $mPAWSY integration
   - Enables migration from $PAWSY to $mPAWSY

Each deployment script:

- Checks for existing deployments
- Handles contract verification
- Includes proper error handling
- Supports different network configurations
- Waits for appropriate confirmation counts

### Security Considerations

#### Smart Contract Security

- Comprehensive reentrancy protection
- Secure token handling patterns
- Access control implementation
- Emergency pause functionality
- Rate limiting on sensitive operations

#### Best Practices

- Pull over push payment patterns
- Check-Effects-Interactions pattern
- Secure math operations
- Gas optimization techniques
- Extensive input validation

#### Audit Status

- Internal security review completed
- External audit pending
- Bug bounty program planned

### License

MIT

### Contributing

Contributions are welcome! Please submit a pull request for review.
