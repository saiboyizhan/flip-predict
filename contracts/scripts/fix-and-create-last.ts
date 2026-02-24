import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const PM_PROXY = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const INITIAL_LIQ = ethers.parseUnits("30", 18);

  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;

  // Set creation fee to 0
  const tx0 = await pm.setMarketCreationFee(0);
  await tx0.wait();
  console.log("marketCreationFee set to 0");

  // Approve USDT (reset to 0 first)
  const usdt = await ethers.getContractAt("IERC20", USDT_ADDRESS);
  await (await usdt.approve(PM_PROXY, 0)).wait();
  await (await usdt.approve(PM_PROXY, INITIAL_LIQ)).wait();
  console.log("USDT approved");

  // Create last market
  const tx = await pm.createUserMarket(
    "今日毕业率对决: Flap vs Four.meme 谁的毕业率更高？",
    1771991424,
    INITIAL_LIQ
  );
  const receipt = await tx.wait();
  const iface = PredictionMarketV3.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === "MarketCreated") {
        console.log(`marketId=${Number(parsed.args[0])}`);
        console.log(`UPDATE markets SET on_chain_market_id = ${Number(parsed.args[0])}, initial_liquidity = 30 WHERE id = 'ucm-ls6k2dktmm02i6or';`);
      }
    } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
