import "dotenv/config";
import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying PredictionMarketV3 + LimitOrderBook (UUPS Proxies) on chainId=${chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);

  // Determine USDT address
  let usdtAddress: string;
  if (chainId === 56) {
    usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
  } else if (chainId === 97) {
    usdtAddress = process.env.USDT_ADDRESS || "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";
  } else {
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const mockUsdt = await MockUSDT.deploy();
    await mockUsdt.waitForDeployment();
    usdtAddress = await mockUsdt.getAddress();
    console.log(`MockUSDT deployed: ${usdtAddress}`);
  }

  // 1. Deploy PredictionMarketV3 UUPS Proxy
  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pmProxy = await upgrades.deployProxy(PredictionMarketV3, [usdtAddress], {
    kind: "uups",
    initializer: "initialize",
  });
  await pmProxy.waitForDeployment();

  const pmProxyAddress = await pmProxy.getAddress();
  const pmImplAddress = await upgrades.erc1967.getImplementationAddress(pmProxyAddress);

  console.log(`\nPredictionMarketV3 deployed!`);
  console.log(`  PM Proxy:          ${pmProxyAddress}`);
  console.log(`  PM Implementation: ${pmImplAddress}`);
  console.log(`  USDT:              ${usdtAddress}`);

  // 2. Deploy NFA and link
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(pmProxyAddress);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log(`  NFA:               ${nfaAddress}`);

  const pm = PredictionMarketV3.attach(pmProxyAddress) as any;
  const linkTx = await pm.setNFAContract(nfaAddress);
  await linkTx.wait();
  console.log(`  NFA linked to PM`);

  // 3. Deploy LimitOrderBook UUPS Proxy
  const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
  const lobProxy = await upgrades.deployProxy(LimitOrderBook, [pmProxyAddress], {
    kind: "uups",
    initializer: "initialize",
  });
  await lobProxy.waitForDeployment();

  const lobProxyAddress = await lobProxy.getAddress();
  const lobImplAddress = await upgrades.erc1967.getImplementationAddress(lobProxyAddress);

  console.log(`\nLimitOrderBook deployed!`);
  console.log(`  LOB Proxy:          ${lobProxyAddress}`);
  console.log(`  LOB Implementation: ${lobImplAddress}`);

  // Output .env config
  console.log(`\n--- .env config ---`);
  console.log(`PREDICTION_MARKET_ADDRESS=${pmProxyAddress}`);
  console.log(`VITE_PREDICTION_MARKET_ADDRESS=${pmProxyAddress}`);
  console.log(`LIMIT_ORDER_BOOK_ADDRESS=${lobProxyAddress}`);
  console.log(`VITE_LIMIT_ORDER_BOOK_ADDRESS=${lobProxyAddress}`);
  console.log(`NFA_ADDRESS=${nfaAddress}`);
  console.log(`USDT_ADDRESS=${usdtAddress}`);

  // Create test market with initial liquidity
  if (chainId === 97 || chainId === 31337) {
    console.log(`\n--- Create test market ---`);

    const usdt = await ethers.getContractAt("MockUSDT", usdtAddress);
    const mintTx = await usdt.mint(deployer.address, ethers.parseUnits("10000", 18));
    await mintTx.wait();
    console.log(`  Minted 10000 MockUSDT to deployer`);

    const approveTx = await usdt.approve(pmProxyAddress, ethers.MaxUint256);
    await approveTx.wait();

    const endTime = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const initialLiq = ethers.parseUnits("500", 18);
    const txCreate = await pm.createUserMarket("Test Market V3 - First Market", endTime, initialLiq);
    const receipt = await txCreate.wait();
    console.log(`  Test market created (marketId=0) with 500 USDT liquidity, tx: ${receipt?.hash}`);
  }

  // Verification commands
  if (chainId === 97 || chainId === 56) {
    const networkName = chainId === 97 ? 'bscTestnet' : 'bsc';
    console.log(`\n--- Verification ---`);
    console.log(`npx hardhat verify --network ${networkName} ${pmImplAddress}`);
    console.log(`npx hardhat verify --network ${networkName} ${lobImplAddress}`);
    console.log(`npx hardhat verify --network ${networkName} ${nfaAddress} ${pmProxyAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
