import "dotenv/config";
import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 56) {
    throw new Error(`Expected BSC Mainnet (56), got chainId=${chainId}`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying to BSC Mainnet`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB`);

  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BSC mainnet USDT
  const FLIP_PLACEHOLDER = deployer.address; // placeholder until FLIP token is deployed
  const MINT_PRICE = ethers.parseEther("0.01"); // 0.01 BNB

  // 1. Deploy PredictionMarketV3 UUPS Proxy
  console.log("\n[1/3] Deploying PredictionMarketV3...");
  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pmProxy = await upgrades.deployProxy(PredictionMarketV3, [USDT_ADDRESS], {
    kind: "uups",
    initializer: "initialize",
  });
  await pmProxy.waitForDeployment();
  const pmProxyAddress = await pmProxy.getAddress();
  const pmImplAddress = await upgrades.erc1967.getImplementationAddress(pmProxyAddress);
  console.log(`  PM Proxy:          ${pmProxyAddress}`);
  console.log(`  PM Implementation: ${pmImplAddress}`);

  // 2. Deploy LimitOrderBook UUPS Proxy
  console.log("\n[2/3] Deploying LimitOrderBook...");
  const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
  const lobProxy = await upgrades.deployProxy(LimitOrderBook, [pmProxyAddress], {
    kind: "uups",
    initializer: "initialize",
  });
  await lobProxy.waitForDeployment();
  const lobProxyAddress = await lobProxy.getAddress();
  const lobImplAddress = await upgrades.erc1967.getImplementationAddress(lobProxyAddress);
  console.log(`  LOB Proxy:          ${lobProxyAddress}`);
  console.log(`  LOB Implementation: ${lobImplAddress}`);

  // 3. Deploy NFA and link to PM
  console.log("\n[3/3] Deploying NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(USDT_ADDRESS, FLIP_PLACEHOLDER, MINT_PRICE);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log(`  NFA:               ${nfaAddress}`);

  // Link NFA <-> PM
  const pm = PredictionMarketV3.attach(pmProxyAddress) as any;
  const tx1 = await pm.setNFAContract(nfaAddress);
  await tx1.wait();
  console.log(`  PM -> NFA linked`);

  const nfaContract = NFA.attach(nfaAddress) as any;
  const tx2 = await nfaContract.setPredictionMarket(pmProxyAddress);
  await tx2.wait();
  console.log(`  NFA -> PM linked`);

  // Set maxMarketsPerDay to 100
  const tx3 = await pm.setMaxMarketsPerDay(100);
  await tx3.wait();
  console.log(`  maxMarketsPerDay set to 100`);

  // Output
  console.log(`\n========== BSC MAINNET ADDRESSES ==========`);
  console.log(`PREDICTION_MARKET_ADDRESS=${pmProxyAddress}`);
  console.log(`VITE_PREDICTION_MARKET_ADDRESS=${pmProxyAddress}`);
  console.log(`LIMIT_ORDER_BOOK_ADDRESS=${lobProxyAddress}`);
  console.log(`VITE_LIMIT_ORDER_BOOK_ADDRESS=${lobProxyAddress}`);
  console.log(`NFA_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`);
  console.log(`USDT_ADDRESS=${USDT_ADDRESS}`);

  // Remaining balance
  const remaining = await ethers.provider.getBalance(deployer.address);
  console.log(`\nRemaining BNB: ${ethers.formatEther(remaining)}`);

  // Verification commands
  console.log(`\n========== VERIFICATION ==========`);
  console.log(`npx hardhat verify --network bsc ${pmImplAddress}`);
  console.log(`npx hardhat verify --network bsc ${lobImplAddress}`);
  console.log(`npx hardhat verify --network bsc ${nfaAddress} ${USDT_ADDRESS} ${FLIP_PLACEHOLDER} ${MINT_PRICE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
