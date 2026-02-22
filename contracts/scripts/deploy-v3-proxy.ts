import "dotenv/config";
import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying PredictionMarketV3 (UUPS Proxy) on chainId=${chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);

  // Determine USDT address
  let usdtAddress: string;
  if (chainId === 56) {
    // BSC Mainnet
    usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
  } else if (chainId === 97) {
    // BSC Testnet — use existing MockUSDT
    usdtAddress = process.env.USDT_ADDRESS || "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";
  } else {
    // Local — deploy MockUSDT
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const mockUsdt = await MockUSDT.deploy();
    await mockUsdt.waitForDeployment();
    usdtAddress = await mockUsdt.getAddress();
    console.log(`MockUSDT deployed: ${usdtAddress}`);
  }

  // Deploy UUPS Proxy
  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const proxy = await upgrades.deployProxy(PredictionMarketV3, [usdtAddress], {
    kind: "uups",
    initializer: "initialize",
  });
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log(`\nPredictionMarketV3 deployed!`);
  console.log(`  Proxy:          ${proxyAddress}`);
  console.log(`  Implementation: ${implAddress}`);
  console.log(`  USDT:           ${usdtAddress}`);

  // Deploy NFA and link
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(proxyAddress);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log(`  NFA:            ${nfaAddress}`);

  // Link contracts
  const pm = PredictionMarketV3.attach(proxyAddress) as any;
  const tx = await pm.setNFAContract(nfaAddress);
  await tx.wait();
  console.log(`  NFA linked to PM`);

  // Output .env config
  console.log(`\n--- .env config ---`);
  console.log(`PREDICTION_MARKET_ADDRESS=${proxyAddress}`);
  console.log(`VITE_PREDICTION_MARKET_ADDRESS=${proxyAddress}`);
  console.log(`NFA_ADDRESS=${nfaAddress}`);
  console.log(`USDT_ADDRESS=${usdtAddress}`);

  // Create test market with initial liquidity
  if (chainId === 97 || chainId === 31337) {
    console.log(`\n--- Create test market ---`);

    // Mint MockUSDT for deployer and approve
    const usdt = await ethers.getContractAt("MockUSDT", usdtAddress);
    const mintTx = await usdt.mint(deployer.address, ethers.parseUnits("10000", 18));
    await mintTx.wait();
    console.log(`  Minted 10000 MockUSDT to deployer`);

    const approveTx = await usdt.approve(proxyAddress, ethers.MaxUint256);
    await approveTx.wait();

    // createUserMarket sets initial reserves (fee=10 USDT + initialLiq=500 USDT)
    const endTime = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days
    const initialLiq = ethers.parseUnits("500", 18);
    const txCreate = await pm.createUserMarket("Test Market V3 - First Market", endTime, initialLiq);
    const receipt = await txCreate.wait();
    console.log(`  Test market created (marketId=0) with 500 USDT liquidity, tx: ${receipt?.hash}`);
  }

  // Verification commands
  if (chainId === 97 || chainId === 56) {
    console.log(`\n--- Verification ---`);
    console.log(`npx hardhat verify --network ${chainId === 97 ? 'bscTestnet' : 'bsc'} ${implAddress}`);
    console.log(`npx hardhat verify --network ${chainId === 97 ? 'bscTestnet' : 'bsc'} ${nfaAddress} ${proxyAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
