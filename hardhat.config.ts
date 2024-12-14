import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import "@nomicfoundation/hardhat-ledger";
import "@openzeppelin/hardhat-upgrades";

// If not set, it uses the hardhat account 0 private key.
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
// If not set, it uses ours Etherscan default API key.
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
// forking rpc url
const forkingURL = process.env.FORKING_URL || "";
// Ledger public key
const ledgerPublicKey = process.env.LEDGER_PUBLIC_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.22",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "paris",
        },
      },
    ],
  },
  defaultNetwork: "localhost",
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: forkingURL,
        enabled: process.env.MAINNET_FORKING_ENABLED === "true",
      },
      blockGasLimit: 30000000,
      gas: "auto",
      gasPrice: "auto",
      allowUnlimitedContractSize: true,
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts: deployerPrivateKey ? [deployerPrivateKey] : undefined,
      ledgerAccounts: !deployerPrivateKey && ledgerPublicKey ? [ledgerPublicKey] : undefined,
      ledgerOptions: {
        derivationFunction: (x) => `m/44'/60'/0'/0/${x}`
      },
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: deployerPrivateKey ? [deployerPrivateKey] : undefined,
      ledgerAccounts: !deployerPrivateKey && ledgerPublicKey ? [ledgerPublicKey] : undefined,
      ledgerOptions: {
        derivationFunction: (x) => `m/44'/60'/0'/0/${x}`
      },
    },
  },
  etherscan: {
    apiKey: `${etherscanApiKey}`,
  },
  verify: {
    etherscan: {
      apiKey: `${etherscanApiKey}`,
    },
  },
  sourcify: {
    enabled: false,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  mocha: {
    timeout: 100000,
  },
};

export default config;
