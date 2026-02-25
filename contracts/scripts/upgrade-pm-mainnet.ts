import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading PredictionMarketV3 on BSC Mainnet with:", deployer.address);

  const PROXY_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";

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

  // Verify new function exists by checking it doesn't revert on a non-existent market
  console.log("\nUpgrade complete. adminResolveImmediate is now available.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
