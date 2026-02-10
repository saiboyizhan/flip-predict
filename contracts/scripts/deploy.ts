import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // BSC Mainnet USDT: 0x55d398326f99059fF775485246999027B3197955
  // BSC Testnet USDT: 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd
  // For local testing, deploy mock contracts

  const { chainId } = await ethers.provider.getNetwork();
  let usdtAddress: string;
  let oracleAddress: string | undefined;

  if (chainId === 56n) {
    // BSC Mainnet - use real USDT
    usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
    console.log("Using BSC Mainnet USDT:", usdtAddress);
  } else if (chainId === 97n) {
    // BSC Testnet - use testnet USDT
    usdtAddress = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd";
    console.log("Using BSC Testnet USDT:", usdtAddress);
  } else {
    // Local or other network - deploy MockUSDT and MockOracle
    console.log("Local/test network detected. Deploying mock contracts...");

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const mockUsdt = await MockUSDT.deploy();
    await mockUsdt.waitForDeployment();
    usdtAddress = await mockUsdt.getAddress();
    console.log("MockUSDT deployed to:", usdtAddress);

    // Deploy MockOracle (BTC price at $100,000 with 8 decimals)
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy(10000000000000n, 8);
    await mockOracle.waitForDeployment();
    oracleAddress = await mockOracle.getAddress();
    console.log("MockOracle deployed to:", oracleAddress);
  }

  // Deploy PredictionMarket
  console.log("\nDeploying PredictionMarket...");
  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const predictionMarket = await PredictionMarket.deploy(usdtAddress);
  await predictionMarket.waitForDeployment();
  const predictionMarketAddress = await predictionMarket.getAddress();
  console.log("PredictionMarket deployed to:", predictionMarketAddress);

  // Deploy NFA contract
  console.log("\nDeploying NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy();
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("NFA deployed to:", nfaAddress);

  // Link NFA to PredictionMarket
  console.log("\nLinking contracts...");
  const tx1 = await predictionMarket.setNFAContract(nfaAddress);
  await tx1.wait();
  console.log("PredictionMarket.setNFAContract ->", nfaAddress);

  const tx2 = await nfa.setPredictionMarket(predictionMarketAddress);
  await tx2.wait();
  console.log("NFA.setPredictionMarket ->", predictionMarketAddress);

  // Summary
  console.log("\n========================================");
  console.log("Deployment Summary");
  console.log("========================================");
  console.log("Network Chain ID:", chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("USDT:", usdtAddress);
  if (oracleAddress) {
    console.log("MockOracle:", oracleAddress);
  }
  console.log("PredictionMarket:", predictionMarketAddress);
  console.log("NFA:", nfaAddress);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
