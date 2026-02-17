import { ethers } from "hardhat";

async function main() {
  const USDT_ADDRESS = "0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F";

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "tBNB");

  // 1. Deploy new PredictionMarket
  console.log("\n1. Deploying new PredictionMarket...");
  const PM = await ethers.getContractFactory("PredictionMarket");
  const pm = await PM.deploy(USDT_ADDRESS);
  await pm.waitForDeployment();
  const pmAddress = await pm.getAddress();
  console.log("PredictionMarket deployed to:", pmAddress);
  await (await pm.setStrictArbitrationMode(true)).wait();
  console.log("Strict arbitration mode enabled");

  // 2. Deploy new NFA
  console.log("\n2. Deploying new NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(USDT_ADDRESS);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("NFA deployed to:", nfaAddress);

  // 3. Link PM <-> NFA
  console.log("\n3. Linking PM <-> NFA...");
  await (await pm.setNFAContract(nfaAddress)).wait();
  console.log("PM.setNFAContract done");
  await (await nfa.setPredictionMarket(pmAddress)).wait();
  console.log("NFA.setPredictionMarket done");

  console.log("\n========================================");
  console.log("USDT (unchanged):", USDT_ADDRESS);
  console.log("PredictionMarket (NEW):", pmAddress);
  console.log("NFA (NEW):", nfaAddress);
  console.log("========================================");
  console.log("\nUpdate these addresses in:");
  console.log("  - bsc.address");
  console.log("  - src/app/config/nfaContracts.ts (NFA_CONTRACT_ADDRESS)");
  console.log("  - server .env (NFA_CONTRACT_ADDRESS, PREDICTION_MARKET_ADDRESS)");
}

main().catch(console.error);
