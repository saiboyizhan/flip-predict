import { ethers } from "hardhat";

const USDT_ADDRESS = "0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F";
const PM_ADDRESS = "0xf250530B3938329F40FA24996e0975Ccdd7381d7";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "tBNB");

  // 1. Deploy new NFA
  console.log("\n1. Deploying new NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(USDT_ADDRESS);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("New NFA:", nfaAddress);

  // 2. Link new NFA -> PredictionMarket
  console.log("\n2. Linking NFA -> PredictionMarket...");
  await (await nfa.setPredictionMarket(PM_ADDRESS)).wait();
  console.log("Done: nfa.setPredictionMarket()");

  // 3. Update PredictionMarket -> new NFA
  console.log("\n3. Linking PredictionMarket -> new NFA...");
  const pm = await ethers.getContractAt("PredictionMarket", PM_ADDRESS);
  await (await pm.setNFAContract(nfaAddress)).wait();
  console.log("Done: pm.setNFAContract()");

  console.log("\n========================================");
  console.log("New NFA Address:", nfaAddress);
  console.log("USDT (unchanged):", USDT_ADDRESS);
  console.log("PredictionMarket (unchanged):", PM_ADDRESS);
  console.log("========================================");
  console.log("\nUpdate this address in:");
  console.log("  - src/app/config/nfaContracts.ts (DEFAULT_NFA_ADDRESS)");
  console.log("  - server .env (NFA_CONTRACT_ADDRESS)");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
