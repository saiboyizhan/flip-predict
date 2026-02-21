import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying v2 contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const { chainId } = await ethers.provider.getNetwork();

  let usdtAddress: string;

  if (chainId === 56n) {
    console.log("Deploying on BSC Mainnet");
    usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
  } else if (chainId === 97n) {
    console.log("Deploying on BSC Testnet — deploying MockUSDT...");
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const mockUSDT = await MockUSDT.deploy();
    await mockUSDT.waitForDeployment();
    usdtAddress = await mockUSDT.getAddress();
    console.log("MockUSDT deployed to:", usdtAddress);
  } else {
    console.log("Local/test network detected. Deploying MockUSDT...");
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const mockUSDT = await MockUSDT.deploy();
    await mockUSDT.waitForDeployment();
    usdtAddress = await mockUSDT.getAddress();
    console.log("MockUSDT deployed to:", usdtAddress);
  }

  // Deploy PredictionMarket v2 (non-custodial CPMM)
  console.log("\nDeploying PredictionMarket v2...");
  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const pm = await PredictionMarket.deploy(usdtAddress);
  await pm.waitForDeployment();
  const pmAddress = await pm.getAddress();
  console.log("PredictionMarket v2 deployed to:", pmAddress);

  const strictModeTx = await pm.setStrictArbitrationMode(true);
  await strictModeTx.wait();
  console.log("setStrictArbitrationMode -> true");

  // Deploy NFA contract
  console.log("\nDeploying NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(usdtAddress);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("NFA deployed to:", nfaAddress);

  // Link contracts
  console.log("\nLinking contracts...");
  const tx1 = await pm.setNFAContract(nfaAddress);
  await tx1.wait();
  console.log("PredictionMarket.setNFAContract ->", nfaAddress);

  const tx2 = await nfa.setPredictionMarket(pmAddress);
  await tx2.wait();
  console.log("NFA.setPredictionMarket ->", pmAddress);

  // Summary
  console.log("\n========================================");
  console.log("V2 Deployment Summary (Non-Custodial)");
  console.log("========================================");
  console.log("Network Chain ID:", chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("USDT Token:", usdtAddress);
  console.log("PredictionMarket v2:", pmAddress);
  console.log("NFA:", nfaAddress);
  console.log("========================================");

  console.log("\n# Frontend .env:");
  console.log(`VITE_CHAIN_ID=${chainId.toString()}`);
  console.log(`VITE_USDT_ADDRESS=${usdtAddress}`);
  console.log(`VITE_PREDICTION_MARKET_ADDRESS=${pmAddress}`);
  console.log(`VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_ADDRESS=${nfaAddress}`);

  const fs = await import("fs");
  const envContent = [
    `VITE_CHAIN_ID=${chainId.toString()}`,
    `VITE_USDT_ADDRESS=${usdtAddress}`,
    `VITE_PREDICTION_MARKET_ADDRESS=${pmAddress}`,
    `VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`,
    `VITE_NFA_ADDRESS=${nfaAddress}`,
  ].join("\n");

  fs.writeFileSync(".env.contracts", envContent + "\n");
  console.log("\nAddresses written to .env.contracts");

  if (chainId === 97n || chainId === 56n) {
    const network = chainId === 97n ? "bscTestnet" : "bsc";
    console.log("\n# Contract Verification:");
    console.log(`npx hardhat verify --network ${network} ${pmAddress} ${usdtAddress}`);
    console.log(`npx hardhat verify --network ${network} ${nfaAddress} ${usdtAddress}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
