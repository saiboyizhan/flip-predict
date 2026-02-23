import "dotenv/config";
import { ethers } from "hardhat";

/**
 * Deploy new NFA contract (with auto-trade modifier support) and link to existing PM.
 *
 * Usage:
 *   PM_ADDRESS=0x... npx hardhat run scripts/deploy-nfa-v2.ts --network bscTestnet
 *
 * After deploy:
 *   1. Update NFA_CONTRACT_ADDRESS env var in Railway + Cloudflare
 *   2. Re-mint agents on new NFA (old NFA agents won't carry over)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying NFA v2 (auto-trade modifiers) on chainId=${chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);

  // Resolve addresses
  const usdtAddress = process.env.USDT_ADDRESS || "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";
  const pmAddress = process.env.PM_ADDRESS || process.env.PREDICTION_MARKET_ADDRESS || "";
  if (!pmAddress || !ethers.isAddress(pmAddress)) {
    throw new Error("PM_ADDRESS env var required (PredictionMarket proxy address)");
  }

  console.log(`\nUSDT: ${usdtAddress}`);
  console.log(`PM:   ${pmAddress}`);

  // 1. Deploy new NFA
  console.log("\nDeploying NFA v2...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(usdtAddress);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log(`NEW NFA: ${nfaAddress}`);

  // 2. Link NFA -> PM
  console.log("\nLinking NFA -> PM...");
  await (await nfa.setPredictionMarket(pmAddress)).wait();
  console.log("  NFA.setPredictionMarket done");

  // 3. Link PM -> NFA (PM is UUPS, call setNFAContract)
  console.log("Linking PM -> NFA...");
  const pm = await ethers.getContractAt("PredictionMarketV3", pmAddress);
  await (await pm.setNFAContract(nfaAddress)).wait();
  console.log("  PM.setNFAContract done");

  // Summary
  console.log("\n========================================");
  console.log(`NEW NFA:  ${nfaAddress}`);
  console.log(`PM:       ${pmAddress}`);
  console.log(`USDT:     ${usdtAddress}`);
  console.log("========================================");
  console.log("\n--- .env updates ---");
  console.log(`NFA_CONTRACT_ADDRESS=${nfaAddress}`);
  console.log(`VITE_NFA_CONTRACT_ADDRESS=${nfaAddress}`);

  // Verification command
  if (chainId === 97 || chainId === 56) {
    const networkName = chainId === 97 ? "bscTestnet" : "bsc";
    console.log(`\n--- Verification ---`);
    console.log(`npx hardhat verify --network ${networkName} ${nfaAddress} ${usdtAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
