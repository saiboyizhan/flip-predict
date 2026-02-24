import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 56) {
    throw new Error(`Expected BSC Mainnet (56), got chainId=${chainId}`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Redeploying NFA on BSC Mainnet`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB`);

  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const FLIP_TOKEN = "0x1ad1d35a9b443ed4501a6da16a688e86b5b07777";
  const MINT_PRICE = ethers.parseEther("0.01"); // 0.01 BNB
  const PM_PROXY = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
  const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap V2 Router

  // Deploy NFA with real FLIP token + buyback
  console.log("\nDeploying NFA with buyback & burn...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(USDT_ADDRESS, FLIP_TOKEN, MINT_PRICE);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log(`  NFA: ${nfaAddress}`);

  const nfaContract = NFA.attach(nfaAddress) as any;

  // Link NFA -> PM
  const tx1 = await nfaContract.setPredictionMarket(PM_PROXY);
  await tx1.wait();
  console.log(`  NFA -> PM linked`);

  // Link PM -> NFA
  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;
  const tx2 = await pm.setNFAContract(nfaAddress);
  await tx2.wait();
  console.log(`  PM -> NFA linked`);

  // Set PancakeSwap router
  const tx3 = await nfaContract.setPancakeRouter(PANCAKE_ROUTER);
  await tx3.wait();
  console.log(`  PancakeSwap router set`);

  // Enable auto buyback & burn
  const tx4 = await nfaContract.setAutoBuyback(true);
  await tx4.wait();
  console.log(`  Auto buyback enabled`);

  console.log(`\n========== NEW NFA ADDRESS ==========`);
  console.log(`NFA_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`);

  const remaining = await ethers.provider.getBalance(deployer.address);
  console.log(`\nRemaining BNB: ${ethers.formatEther(remaining)}`);

  console.log(`\n========== VERIFICATION ==========`);
  console.log(`npx hardhat verify --network bsc ${nfaAddress} ${USDT_ADDRESS} ${FLIP_TOKEN} ${MINT_PRICE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
