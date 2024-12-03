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
  // const { deployer } = await hre.getNamedAccounts();
  const deployerPrivateKey =
    process.env.DEPLOYER_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const deployerWallet = new ethers.Wallet(deployerPrivateKey, hre.ethers.provider);

  const { deploy } = hre.deployments;
  const pawsyToken = "0x29e39327b5B1E500B87FC0fcAe3856CD8F96eD2a";
  const lpToken = "0x96fc64cae162c1cb288791280c3eff2255c330a8";

  const lockDeployment = await deploy("Lock", {
    from: deployerWallet.address,
    log: true,
    autoMine: true,
  });

  console.log("Lock deployed to:", lockDeployment.address);

  const stakingVaultDeployment = await deploy("StakingVault", {
    from: deployerWallet.address,
    args: [pawsyToken, lpToken, lockDeployment.address],
    log: true,
    autoMine: true,
  });

  console.log("StakingVault deployed to:", stakingVaultDeployment.address);
};

export default deployContracts;

deployContracts.tags = ["StakingContracts"];
