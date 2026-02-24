import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading PredictionMarketV3 with:", deployer.address);

  const PROXY_ADDRESS = "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25";

  // Deploy new implementation
  const PMV3 = await ethers.getContractFactory("PredictionMarketV3");
  const newImpl = await PMV3.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New implementation deployed to:", newImplAddress);

  // Upgrade proxy
  const proxy = await ethers.getContractAt("PredictionMarketV3", PROXY_ADDRESS);
  const tx = await proxy.upgradeToAndCall(newImplAddress, "0x");
  await tx.wait();
  console.log("Proxy upgraded to new implementation");

  // Set marketCreationFee to 0
  const tx2 = await proxy.setMarketCreationFee(0);
  await tx2.wait();
  console.log("Market creation fee set to 0");

  // Verify
  const minLiq = await proxy.MIN_INITIAL_LIQUIDITY();
  const fee = await proxy.marketCreationFee();
  console.log("\nVerification:");
  console.log("  MIN_INITIAL_LIQUIDITY:", ethers.formatUnits(minLiq, 18), "USDT");
  console.log("  marketCreationFee:", ethers.formatUnits(fee, 18), "USDT");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
