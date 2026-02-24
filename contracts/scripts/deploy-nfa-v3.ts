import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying NFA v3 (BNB mint fee) with:", deployer.address);

  const USDT_ADDRESS = "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";
  const FLIP_ADDRESS = "0x713eF4574954988df53a2A051C7aC10a6c1E8586";
  const MINT_PRICE = ethers.parseEther("0.01"); // 0.01 BNB
  const PM_ADDRESS = "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25"; // PredictionMarketV3

  // Deploy NFA
  const NFA = await ethers.getContractFactory("NFA");
  const nfa = await NFA.deploy(USDT_ADDRESS, FLIP_ADDRESS, MINT_PRICE);
  await nfa.waitForDeployment();
  const nfaAddress = await nfa.getAddress();
  console.log("NFA deployed to:", nfaAddress);

  // Link NFA to PredictionMarketV3
  const tx1 = await nfa.setPredictionMarket(PM_ADDRESS);
  await tx1.wait();
  console.log("NFA -> PM linked");

  // Link PM to new NFA
  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);
  const tx2 = await pm.setNFAContract(nfaAddress);
  await tx2.wait();
  console.log("PM -> NFA linked");

  const mintPrice = await nfa.mintPrice();
  const flipAddr = await nfa.flipToken();
  console.log("\nNFA Config:");
  console.log("  Mint Price:", ethers.formatEther(mintPrice), "BNB");
  console.log("  FLIP Token:", flipAddr);
  console.log("  PM Address:", PM_ADDRESS);

  console.log("\nVerify:");
  console.log(`npx hardhat verify --network bscTestnet ${nfaAddress} ${USDT_ADDRESS} ${FLIP_ADDRESS} ${MINT_PRICE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
