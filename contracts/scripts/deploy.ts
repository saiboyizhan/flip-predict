import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const { chainId } = await ethers.provider.getNetwork();

  let oracleAddress: string | undefined;

  if (chainId === 56n) {
    console.log("Deploying on BSC Mainnet");
  } else if (chainId === 97n) {
    console.log("Deploying on BSC Testnet");
  } else {
    // Local or other network - deploy MockOracle for testing
    console.log("Local/test network detected. Deploying mock contracts...");

    // Deploy MockOracle (BTC price at $100,000 with 8 decimals)
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy(10000000000000n, 8);
    await mockOracle.waitForDeployment();
    oracleAddress = await mockOracle.getAddress();
    console.log("MockOracle deployed to:", oracleAddress);
  }

  // Deploy PredictionMarket (uses native BNB, no constructor arguments)
  console.log("\nDeploying PredictionMarket...");
  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const predictionMarket = await PredictionMarket.deploy();
  await predictionMarket.waitForDeployment();
  const predictionMarketAddress = await predictionMarket.getAddress();
  console.log("PredictionMarket deployed to:", predictionMarketAddress);
  const strictModeTx = await predictionMarket.setStrictArbitrationMode(true);
  await strictModeTx.wait();
  console.log("PredictionMarket.setStrictArbitrationMode -> true");

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

  // Deploy SwarmConsensus
  console.log("\nDeploying SwarmConsensus...");
  const SwarmConsensus = await ethers.getContractFactory("SwarmConsensus");
  const swarmConsensus = await SwarmConsensus.deploy(nfaAddress, predictionMarketAddress);
  await swarmConsensus.waitForDeployment();
  const swarmConsensusAddress = await swarmConsensus.getAddress();
  console.log("SwarmConsensus deployed to:", swarmConsensusAddress);

  // Summary
  console.log("\n========================================");
  console.log("Deployment Summary");
  console.log("========================================");
  console.log("Network Chain ID:", chainId.toString());
  console.log("Deployer:", deployer.address);
  if (oracleAddress) {
    console.log("MockOracle:", oracleAddress);
  }
  console.log("PredictionMarket:", predictionMarketAddress);
  console.log("NFA:", nfaAddress);
  console.log("SwarmConsensus:", swarmConsensusAddress);
  console.log("========================================");

  // Output .env format for frontend integration (Vite uses VITE_ prefix)
  console.log("\n# Copy the following to your frontend .env file:");
  console.log("# ─── Frontend .env ───────────────────────");
  console.log(`VITE_CHAIN_ID=${chainId.toString()}`);
  console.log(`VITE_PREDICTION_MARKET_ADDRESS=${predictionMarketAddress}`);
  console.log(`VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_ADDRESS=${nfaAddress}`);
  console.log(`VITE_SWARM_CONSENSUS_ADDRESS=${swarmConsensusAddress}`);
  if (oracleAddress) {
    console.log(`VITE_MOCK_ORACLE_ADDRESS=${oracleAddress}`);
  }
  console.log("# ─────────────────────────────────────────");

  // Write .env.contracts file
  const fs = await import("fs");
  const envContent = [
    `VITE_CHAIN_ID=${chainId.toString()}`,
    `VITE_PREDICTION_MARKET_ADDRESS=${predictionMarketAddress}`,
    `VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`,
    `VITE_NFA_ADDRESS=${nfaAddress}`,
    `VITE_SWARM_CONSENSUS_ADDRESS=${swarmConsensusAddress}`,
    oracleAddress ? `VITE_MOCK_ORACLE_ADDRESS=${oracleAddress}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  fs.writeFileSync(".env.contracts", envContent + "\n");
  console.log("\nAddresses written to .env.contracts");

  // Verification instructions
  if (chainId === 97n || chainId === 56n) {
    console.log("\n# ─── Contract Verification ────────────────");
    console.log("# Run the following commands to verify on BscScan:");
    console.log(`npx hardhat verify --network ${chainId === 97n ? 'bscTestnet' : 'bsc'} ${predictionMarketAddress}`);
    console.log(`npx hardhat verify --network ${chainId === 97n ? 'bscTestnet' : 'bsc'} ${nfaAddress}`);
    console.log(`npx hardhat verify --network ${chainId === 97n ? 'bscTestnet' : 'bsc'} ${swarmConsensusAddress} ${nfaAddress} ${predictionMarketAddress}`);
    console.log("# ──────────────────────────────────────────");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
