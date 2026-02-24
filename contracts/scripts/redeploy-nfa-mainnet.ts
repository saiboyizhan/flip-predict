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

  // Deploy NFA with real FLIP token
  console.log("\nDeploying NFA with real FLIP token...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(USDT_ADDRESS, FLIP_TOKEN, MINT_PRICE);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log(`  NFA: ${nfaAddress}`);

  // Link NFA -> PM
  const nfaContract = NFA.attach(nfaAddress) as any;
  const tx1 = await nfaContract.setPredictionMarket(PM_PROXY);
  await tx1.wait();
  console.log(`  NFA -> PM linked`);

  // Link PM -> NFA (update PM to point to new NFA)
  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;
  const tx2 = await pm.setNFAContract(nfaAddress);
  await tx2.wait();
  console.log(`  PM -> NFA linked`);

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
