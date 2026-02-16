import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "tBNB");

  // 1. Deploy MockUSDT
  console.log("\n1. Deploying MockUSDT...");
  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const mockUSDT = await MockUSDT.deploy();
  await mockUSDT.waitForDeployment();
  const usdtAddress = await mockUSDT.getAddress();
  console.log("MockUSDT:", usdtAddress);

  // 2. Deploy PredictionMarket
  console.log("\n2. Deploying PredictionMarket...");
  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const pm = await PredictionMarket.deploy(usdtAddress);
  await pm.waitForDeployment();
  const pmAddress = await pm.getAddress();
  console.log("PredictionMarket:", pmAddress);
  await (await pm.setStrictArbitrationMode(true)).wait();

  // 3. Deploy NFA
  console.log("\n3. Deploying NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(usdtAddress);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("NFA:", nfaAddress);

  // 4. Link contracts
  console.log("\n4. Linking...");
  await (await pm.setNFAContract(nfaAddress)).wait();
  await (await nfa.setPredictionMarket(pmAddress)).wait();

  console.log("\n========================================");
  console.log("MockUSDT:", usdtAddress, "(anyone can call mint)");
  console.log("PredictionMarket:", pmAddress);
  console.log("NFA:", nfaAddress);
  console.log("========================================");

  // Write .env.contracts
  const fs = await import("fs");
  fs.writeFileSync(".env.contracts", [
    `VITE_CHAIN_ID=97`,
    `VITE_USDT_ADDRESS=${usdtAddress}`,
    `VITE_PREDICTION_MARKET_ADDRESS=${pmAddress}`,
    `VITE_NFA_ADDRESS=${nfaAddress}`,
  ].join("\n") + "\n");
  console.log("Written to .env.contracts");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
