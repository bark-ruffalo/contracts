# Contracts used in the Bark Ruffalo ecosystem

> **🎁 Free to Use for any crypto project or AI Agent builder!**  
> We just ask the teams to consider airdropping our DAO address or our $PAWSY holders with a small amount.
>
> Holders: https://basescan.org/token/0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a#balances
>
> DAO address: 0xc638FB83d2bad5dD73d4C7c7deC0445d46a0716F

## Overview

The ecosystem consists of three main contracts:

1. **Staking vault:** Stake and lock $PAWSY for various periods of time.
2. **Reward token:** Only mintable by the staking vault; tracks user ecosystem contributions.
3. **Rewards market:** Enables devs/DAO to create campaigns for token exchanges (e.g., reward tokens for NFTs).

## Core Contracts

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

The deployment is split into two main parts that can be deployed independently:

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

#### Other Deployment Options

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

Required environment variables for deployment:

```bash
DEPLOYER_PRIVATE_KEY=your_private_key
PAWSY_TOKEN=pawsy_token_address  # Optional, defaults to mainnet address
LP_TOKEN=lp_token_address        # Optional, defaults to mainnet address
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
