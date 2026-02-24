import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 56) throw new Error("Not BSC Mainnet");

  const PM_PROXY = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const INITIAL_LIQ = ethers.parseUnits("30", 18); // 30 USDT per market

  const markets = [
    { title: "今日 Flap 毕业代币是否超过 8 个？", endTime: 1771991087, dbId: "ucm-4eqya9wnmm02b0q1" },
    { title: "明日 Flap 毕业代币是否超过 10 个？", endTime: 1772077493, dbId: "ucm-tsw6yan8mm02b4bq" },
    { title: "本周 Flap 毕业代币总数是否超过 60 个？", endTime: 1772509797, dbId: "ucm-852n8mrvmm02hpdc" },
    { title: "本月 Flap 毕业代币是否突破 250 个？", endTime: 1774497004, dbId: "ucm-g07eca6vmm02hrub" },
    { title: "今日 Four.meme 毕业代币是否超过 5 个？", endTime: 1771991408, dbId: "ucm-jdid9vgzmm02hu7d" },
    { title: "明日 Four.meme 毕业代币是否超过 7 个？", endTime: 1772077811, dbId: "ucm-g2qdm6fvmm02hwpo" },
    { title: "本周 Four.meme 毕业代币总数是否超过 35 个？", endTime: 1772509814, dbId: "ucm-ih2a0m03mm02hz3o" },
    { title: "本月 Four.meme 毕业代币是否突破 150 个？", endTime: 1774497017, dbId: "ucm-lvse0adkmm02i211" },
    { title: "本周毕业代币数: Flap vs Four.meme 谁更多？", endTime: 1772509821, dbId: "ucm-gv2azrnhmm02i4cu" },
    { title: "今日毕业率对决: Flap vs Four.meme 谁的毕业率更高？", endTime: 1771991424, dbId: "ucm-ls6k2dktmm02i6or" },
  ];

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Creating ${markets.length} markets with ${ethers.formatUnits(INITIAL_LIQ, 18)} USDT each`);
  console.log(`Total USDT needed: ${ethers.formatUnits(INITIAL_LIQ * BigInt(markets.length), 18)}\n`);

  // Approve USDT
  const usdt = await ethers.getContractAt("IERC20", USDT_ADDRESS);
  const totalNeeded = INITIAL_LIQ * BigInt(markets.length);
  const tx0 = await usdt.approve(PM_PROXY, totalNeeded);
  await tx0.wait();
  console.log("USDT approved\n");

  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;

  const sqlUpdates: string[] = [];

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const now = Math.floor(Date.now() / 1000);
    if (m.endTime <= now + 3600) {
      console.log(`[${i}] SKIPPED (expires too soon): ${m.title}`);
      continue;
    }
    try {
      const tx = await pm.createUserMarket(m.title, m.endTime, INITIAL_LIQ);
      const receipt = await tx.wait();
      // Parse MarketCreated event to get marketId
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
      console.log(`[${i}] marketId=${marketId} | ${m.title}`);
      sqlUpdates.push(`UPDATE markets SET on_chain_market_id = ${marketId}, initial_liquidity = 30 WHERE id = '${m.dbId}';`);
    } catch (err: any) {
      console.log(`[${i}] FAILED: ${m.title}`);
      console.log(`  Error: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`\n========== SQL UPDATES ==========`);
  for (const sql of sqlUpdates) {
    console.log(sql);
  }

  const remaining = await ethers.provider.getBalance(deployer.address);
  console.log(`\nRemaining BNB: ${ethers.formatEther(remaining)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
