import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const PM_PROXY = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const INITIAL_LIQ = ethers.parseUnits("30", 18);

  const markets = [
    { title: "本月 Four.meme 毕业代币是否突破 150 个？", endTime: 1774497017, dbId: "ucm-lvse0adkmm02i211" },
    { title: "本周毕业代币数: Flap vs Four.meme 谁更多？", endTime: 1772509821, dbId: "ucm-gv2azrnhmm02i4cu" },
    { title: "今日毕业率对决: Flap vs Four.meme 谁的毕业率更高？", endTime: 1771991424, dbId: "ucm-ls6k2dktmm02i6or" },
  ];

  // Check USDT balance
  const usdt = await ethers.getContractAt("IERC20", USDT_ADDRESS);
  const balance = await usdt.balanceOf(deployer.address);
  console.log(`USDT balance: ${ethers.formatUnits(balance, 18)}`);

  // Re-approve
  const tx0 = await usdt.approve(PM_PROXY, INITIAL_LIQ * BigInt(markets.length));
  await tx0.wait();
  console.log("USDT approved\n");

  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const now = Math.floor(Date.now() / 1000);
    if (m.endTime <= now + 3600) {
      console.log(`SKIPPED (expires too soon): ${m.title}`);
      continue;
    }
    try {
      const tx = await pm.createUserMarket(m.title, m.endTime, INITIAL_LIQ);
      const receipt = await tx.wait();
      const iface = PredictionMarketV3.interface;
      let marketId = -1;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === "MarketCreated") {
            marketId = Number(parsed.args[0]);
            break;
          }
        } catch {}
      }
      console.log(`marketId=${marketId} | ${m.title}`);
      console.log(`UPDATE markets SET on_chain_market_id = ${marketId}, initial_liquidity = 30 WHERE id = '${m.dbId}';`);
    } catch (err: any) {
      console.log(`FAILED: ${m.title}`);
      console.log(`  Error: ${err.message?.slice(0, 300)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
