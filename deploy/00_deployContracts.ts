// /**
//  * Deploys a contract named "YourContract" using the deployer account and
//  * constructor arguments set to the deployer address
//  *
//  * @param hre HardhatRuntimeEnvironment object.
//  */
// const deployYourContract: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
//   /*
//     On localhost, the deployer account is the one that comes with Hardhat, which is already funded.

//     When deploying to live networks (e.g `yarn deploy --network sepolia`), the deployer account
//     should have sufficient balance to pay for the gas fees for contract creation.

//     You can generate a random account with `yarn generate` which will fill DEPLOYER_PRIVATE_KEY
//     with a random private key in the .env file (then used on hardhat.config.ts)
//     You can run the `yarn account` command to check your balance in every network.
//   */
//   const { deployer } = await hre.getNamedAccounts();
//   const { deploy } = hre.deployments;

//   await deploy("YourContract", {
//     from: deployer,
//     // Contract constructor arguments
//     args: [deployer],
//     log: true,
//     // autoMine: can be passed to the deploy function to make the deployment process faster on local networks by
//     // automatically mining the contract deployment transaction. There is no effect on live networks.
//     autoMine: true,
//   });

//   // Get the deployed contract to interact with it after deploying.
//   const yourContract = await hre.ethers.getContract<Contract>("YourContract", deployer);
//   console.log("👋 Initial greeting:", await yourContract.greeting());
// };

// export default deployYourContract;

// // Tags are useful if you have multiple deploy files and only want to run one of them.
// // e.g. yarn deploy --tags YourContract
// deployYourContract.tags = ["YourContract"];

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const deployContracts: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const deployerPrivateKey =
    process.env.DEPLOYER_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const deployerWallet = new ethers.Wallet(deployerPrivateKey, hre.ethers.provider);

  const { deploy } = hre.deployments;

  // Define tokens
  const pawsyToken = "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a"; // ERC20 token
  const lpToken = "0x96fc64cae162c1cb288791280c3eff2255c330a8"; // LP token

  // Deploy RewardToken contract
  const rewardTokenDeployment = await deploy("RewardToken", {
    from: deployerWallet.address,
    log: true,
    autoMine: true,
  });
  console.log("RewardToken (DRUGS) deployed to:", rewardTokenDeployment.address);

  // Deploy StakingVault contract
  const stakingVaultDeployment = await deploy("StakingVault", {
    from: deployerWallet.address,
    args: [rewardTokenDeployment.address],
    log: true,
    autoMine: true,
  });
  console.log("StakingVault deployed to:", stakingVaultDeployment.address);

  // Transfer ownership of RewardToken to StakingVault
  const rewardTokenContract = await ethers.getContractAt("RewardToken", rewardTokenDeployment.address, deployerWallet);
  const tx = await rewardTokenContract.transferOwnership(stakingVaultDeployment.address);
  await tx.wait();
  console.log(`Ownership of RewardToken transferred to StakingVault: ${stakingVaultDeployment.address}`);

  // Initialize Pools
  const stakingVaultContract = await ethers.getContractAt(
    "StakingVault",
    stakingVaultDeployment.address,
    deployerWallet,
  );

  // Default timelock periods (in seconds) and reward rates
  const timelocks = [50 * 24 * 60 * 60, 100 * 24 * 60 * 60, 200 * 24 * 60 * 60, 400 * 24 * 60 * 60]; // 50, 100, 200, 400 days
  const pawsyRates = [100, 200, 300, 400]; // 1%, 2%, 3%, 4% for $PAWSY
  const lpRates = [500, 600, 700, 800]; // 5%, 6%, 7%, 8% for LP token

  // Add $PAWSY pool
  const addPawsyPoolTx = await stakingVaultContract.addPool(pawsyToken, timelocks, pawsyRates);
  await addPawsyPoolTx.wait();
  console.log("Pool added for $PAWSY");

  // Add LP pool
  const addLpPoolTx = await stakingVaultContract.addPool(lpToken, timelocks, lpRates);
  await addLpPoolTx.wait();
  console.log("Pool added for $PAWSY/$VIRTUAL LP Token");
};

export default deployContracts;

deployContracts.tags = ["StakingContracts"];
