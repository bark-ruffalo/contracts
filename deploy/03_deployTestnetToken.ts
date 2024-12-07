import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../utils/verification";

const deployTestnetToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Only deploy on baseSepolia
  if (network.name !== "baseSepolia") {
    console.log("\n⏭️ Skipping TestnetToken deployment on non-baseSepolia network");
    return;
  }

  console.log("\n🚀 Deploying TestnetToken...\n");

  const testnetToken = await deploy("TestnetToken", {
    from: deployer,
    args: ["TestnetToken", "TTK"],
    log: true,
    contract: "contracts/TestnetToken.sol:TestnetToken",
  });

  // Always attempt verification on baseSepolia, regardless of new deployment
  if (network.name === "baseSepolia") {
    console.log("\n🔍 Verifying TestnetToken...\n");
    await verifyContract(hre, testnetToken.address, ["TestnetToken", "TTK"], {
      contract: "contracts/TestnetToken.sol:TestnetToken",
    });
  }
};

export default deployTestnetToken;
deployTestnetToken.tags = ["TestnetToken"];
