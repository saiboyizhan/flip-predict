import "dotenv/config";
import { ethers, upgrades } from "hardhat";

async function main() {
  const args = process.argv.slice(2);
  // Support: --contract pm|lob (default: both)
  const contractArg = args.find(a => a.startsWith("--contract="))?.split("=")[1] || "both";

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`Upgrading contracts on chainId=${Number(network.chainId)}`);
  console.log(`Deployer: ${deployer.address}`);

  // Upgrade PredictionMarketV3
  if (contractArg === "pm" || contractArg === "both") {
    const PM_PROXY = process.env.PREDICTION_MARKET_ADDRESS;
    if (!PM_PROXY) {
      console.warn("PREDICTION_MARKET_ADDRESS not set, skipping PM upgrade");
    } else {
      console.log(`\n--- Upgrading PredictionMarketV3 at ${PM_PROXY} ---`);
      const oldImpl = await upgrades.erc1967.getImplementationAddress(PM_PROXY);
      console.log(`Old implementation: ${oldImpl}`);

      const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
      const upgraded = await upgrades.upgradeProxy(PM_PROXY, PredictionMarketV3, { kind: "uups" });
      await upgraded.waitForDeployment();

      const newImpl = await upgrades.erc1967.getImplementationAddress(PM_PROXY);
      console.log(`New implementation: ${newImpl}`);
      if (oldImpl === newImpl) {
        console.log(`(No bytecode change detected)`);
      }
      console.log(`PM upgrade complete!`);
    }
  }

  // Upgrade LimitOrderBook
  if (contractArg === "lob" || contractArg === "both") {
    const LOB_PROXY = process.env.LIMIT_ORDER_BOOK_ADDRESS;
    if (!LOB_PROXY) {
      console.warn("LIMIT_ORDER_BOOK_ADDRESS not set, skipping LOB upgrade");
    } else {
      console.log(`\n--- Upgrading LimitOrderBook at ${LOB_PROXY} ---`);
      const oldImpl = await upgrades.erc1967.getImplementationAddress(LOB_PROXY);
      console.log(`Old implementation: ${oldImpl}`);

      const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
      const upgraded = await upgrades.upgradeProxy(LOB_PROXY, LimitOrderBook, { kind: "uups" });
      await upgraded.waitForDeployment();

      const newImpl = await upgrades.erc1967.getImplementationAddress(LOB_PROXY);
      console.log(`New implementation: ${newImpl}`);
      if (oldImpl === newImpl) {
        console.log(`(No bytecode change detected)`);
      }
      console.log(`LOB upgrade complete!`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
