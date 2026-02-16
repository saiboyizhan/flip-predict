import { ethers } from "hardhat";

async function main() {
  const USDT_ADDRESS = "0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F";
  const NFA_ADDRESS = "0xf59Ecd163388197865fC53C6F51298352d925f0E";

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "BNB");

  // Deploy new PredictionMarket
  console.log("\nDeploying new PredictionMarket...");
  const PM = await ethers.getContractFactory("PredictionMarket");
  const pm = await PM.deploy(USDT_ADDRESS);
  await pm.waitForDeployment();
  const pmAddress = await pm.getAddress();
  console.log("PredictionMarket deployed to:", pmAddress);

  // Update NFA to point to new PredictionMarket
  console.log("\nUpdating NFA.setPredictionMarket...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = NFA.attach(NFA_ADDRESS);
  const tx = await nfa.setPredictionMarket(pmAddress);
  await tx.wait();
  console.log("NFA.predictionMarket updated to:", pmAddress);

  console.log("\n=== Summary ===");
  console.log("USDT:", USDT_ADDRESS);
  console.log("PredictionMarket (NEW):", pmAddress);
  console.log("NFA:", NFA_ADDRESS);
  console.log("\nUpdate these in:");
  console.log("  - src/app/config/contracts.ts (DEFAULT_PM_ADDRESS)");
  console.log("  - Railway env: PREDICTION_MARKET_ADDRESS");
}

main().catch(console.error);
