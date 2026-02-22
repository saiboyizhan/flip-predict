import "dotenv/config";
import { ethers, upgrades } from "hardhat";

async function main() {
  const PROXY_ADDRESS = process.env.PREDICTION_MARKET_ADDRESS;
  if (!PROXY_ADDRESS) {
    throw new Error("PREDICTION_MARKET_ADDRESS not set in .env");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`Upgrading PredictionMarketV3 proxy at ${PROXY_ADDRESS}`);
  console.log(`Network: chainId=${Number(network.chainId)}`);
  console.log(`Deployer: ${deployer.address}`);

  const oldImpl = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log(`Old implementation: ${oldImpl}`);

  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, PredictionMarketV3, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();

  const newImpl = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log(`New implementation: ${newImpl}`);
  console.log(`Upgrade complete!`);

  if (oldImpl === newImpl) {
    console.log(`(Implementation address unchanged — no bytecode change detected)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
