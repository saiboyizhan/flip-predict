import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying NFA with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "tBNB");

  const usdtAddress = "0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F";
  const pmAddress = "0xf250530B3938329F40FA24996e0975Ccdd7381d7";

  console.log("\nDeploying NFA...");
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(usdtAddress);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("NEW NFA:", nfaAddress);

  console.log("\nLinking NFA -> PM...");
  await (await nfa.setPredictionMarket(pmAddress)).wait();
  console.log("Linking PM -> NFA...");
  const pm = await ethers.getContractAt("PredictionMarket", pmAddress);
  await (await pm.setNFAContract(nfaAddress)).wait();

  console.log("\n========================================");
  console.log("NEW NFA:", nfaAddress);
  console.log("========================================");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
