import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const PM_PROXY = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const INITIAL_LIQ = ethers.parseUnits("30", 18);

  const usdt = await ethers.getContractAt("IERC20", USDT_ADDRESS);

  // Reset approve to 0 first (BSC USDT quirk)
  const tx0 = await usdt.approve(PM_PROXY, 0);
  await tx0.wait();
  const tx1 = await usdt.approve(PM_PROXY, INITIAL_LIQ);
  await tx1.wait();
  console.log("USDT approved");

  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;

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
        const marketId = Number(parsed.args[0]);
        console.log(`marketId=${marketId}`);
        console.log(`UPDATE markets SET on_chain_market_id = ${marketId}, initial_liquidity = 30 WHERE id = 'ucm-ls6k2dktmm02i6or';`);
      }
    } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
