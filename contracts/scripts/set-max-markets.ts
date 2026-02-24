import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const pm = await ethers.getContractAt("PredictionMarketV3", "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25");
  console.log("Current maxMarketsPerDay:", (await pm.maxMarketsPerDay()).toString());
  const tx = await pm.setMaxMarketsPerDay(100);
  await tx.wait();
  console.log("New maxMarketsPerDay:", (await pm.maxMarketsPerDay()).toString());
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
