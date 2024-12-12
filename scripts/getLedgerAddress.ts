import { ethers } from "ethers";

async function main() {
  // HD Path from your config
  const hdPath = "m/44'/60'/0'/3"; // Index 0 is appended to match the first address

  try {
    // Create HD Node from path
    const mnemonic = "ledger";
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
    const derivedNode = masterNode.derivePath(hdPath);
    
    console.log("\nLedger Address Derivation Info:");
    console.log("--------------------------------");
    console.log("HD Path:", hdPath);
    console.log("Derived Address:", derivedNode.address);
    console.log("--------------------------------");
    console.log("\nVerify this matches your Ledger address!");
    
  } catch (error) {
    console.error("Error deriving address:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 