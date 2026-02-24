import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const PM_PROXY = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
  const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
  const INITIAL_LIQ = ethers.parseUnits("30", 18);

  const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
  const pm = PredictionMarketV3.attach(PM_PROXY) as any;
  const usdt = await ethers.getContractAt("IERC20", USDT_ADDRESS);

  // Step 1: Cancel old markets (0-9)
  console.log("=== Cancelling old markets ===");
  for (let i = 0; i <= 9; i++) {
    const tx = await pm.cancelMarket(i);
    await tx.wait();
    console.log(`  Cancelled market ${i}`);
  }

  // Step 2: Refund LP for each cancelled market
  console.log("\n=== Refunding LP ===");
  for (let i = 0; i <= 9; i++) {
    try {
      const tx = await pm.lpRefundAfterCancel(i);
      await tx.wait();
      console.log(`  Refunded market ${i}`);
    } catch (e: any) {
      console.log(`  Refund market ${i} skipped: ${e.message?.slice(0, 100)}`);
    }
  }

  const usdtBal = await usdt.balanceOf(deployer.address);
  console.log(`\nUSDT balance after refund: ${ethers.formatUnits(usdtBal, 18)}`);

  // Step 3: Create new markets with correct Beijing midnight end times
  // Beijing time = UTC+8
  // "今日" Feb 24 → ends Feb 25 00:00 BJT = Feb 24 16:00 UTC
  // "明日" Feb 25 → ends Feb 26 00:00 BJT = Feb 25 16:00 UTC
  // "本周" → ends Mar 3 00:00 BJT (Monday) = Mar 2 16:00 UTC
  // "本月" → ends Mar 1 00:00 BJT = Feb 28 16:00 UTC

  // Calculate timestamps (UTC)
  const feb25_00bj = Date.UTC(2026, 1, 24, 16, 0, 0) / 1000; // Feb 25 00:00 BJT
  const feb26_00bj = Date.UTC(2026, 1, 25, 16, 0, 0) / 1000; // Feb 26 00:00 BJT
  const mar03_00bj = Date.UTC(2026, 2, 2, 16, 0, 0) / 1000;  // Mar 3 00:00 BJT
  const mar01_00bj = Date.UTC(2026, 1, 28, 16, 0, 0) / 1000;  // Mar 1 00:00 BJT

  console.log(`\nTimestamps (verify):`)
  console.log(`  今日结束 (Feb 25 00:00 BJT): ${feb25_00bj} = ${new Date(feb25_00bj * 1000).toISOString()}`);
  console.log(`  明日结束 (Feb 26 00:00 BJT): ${feb26_00bj} = ${new Date(feb26_00bj * 1000).toISOString()}`);
  console.log(`  本周结束 (Mar 3 00:00 BJT):  ${mar03_00bj} = ${new Date(mar03_00bj * 1000).toISOString()}`);
  console.log(`  本月结束 (Mar 1 00:00 BJT):  ${mar01_00bj} = ${new Date(mar01_00bj * 1000).toISOString()}`);

  const newMarkets = [
    { title: "今日 Flap 毕业代币是否超过 8 个？", endTime: feb25_00bj, dbId: "ucm-4eqya9wnmm02b0q1" },
    { title: "明日 Flap 毕业代币是否超过 10 个？", endTime: feb26_00bj, dbId: "ucm-tsw6yan8mm02b4bq" },
    { title: "本周 Flap 毕业代币总数是否超过 60 个？", endTime: mar03_00bj, dbId: "ucm-852n8mrvmm02hpdc" },
    { title: "本月 Flap 毕业代币是否突破 250 个？", endTime: mar01_00bj, dbId: "ucm-g07eca6vmm02hrub" },
    { title: "今日 Four.meme 毕业代币是否超过 5 个？", endTime: feb25_00bj, dbId: "ucm-jdid9vgzmm02hu7d" },
    { title: "明日 Four.meme 毕业代币是否超过 7 个？", endTime: feb26_00bj, dbId: "ucm-g2qdm6fvmm02hwpo" },
    { title: "本周 Four.meme 毕业代币总数是否超过 35 个？", endTime: mar03_00bj, dbId: "ucm-ih2a0m03mm02hz3o" },
    { title: "本月 Four.meme 毕业代币是否突破 150 个？", endTime: mar01_00bj, dbId: "ucm-lvse0adkmm02i211" },
    { title: "本周毕业代币数: Flap vs Four.meme 谁更多？", endTime: mar03_00bj, dbId: "ucm-gv2azrnhmm02i4cu" },
    { title: "今日毕业率对决: Flap vs Four.meme 谁的毕业率更高？", endTime: feb25_00bj, dbId: "ucm-ls6k2dktmm02i6or" },
  ];

  // Approve USDT
  console.log("\n=== Creating new markets ===");
  await (await usdt.approve(PM_PROXY, 0)).wait();
  await (await usdt.approve(PM_PROXY, INITIAL_LIQ * BigInt(newMarkets.length))).wait();
  console.log("USDT approved\n");

  const sqlUpdates: string[] = [];
  const iface = PredictionMarketV3.interface;

  for (let i = 0; i < newMarkets.length; i++) {
    const m = newMarkets[i];
    try {
      const tx = await pm.createUserMarket(m.title, m.endTime, INITIAL_LIQ);
      const receipt = await tx.wait();
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
      sqlUpdates.push(`UPDATE markets SET on_chain_market_id = ${marketId}, initial_liquidity = 30, end_time = ${m.endTime * 1000} WHERE id = '${m.dbId}';`);
    } catch (err: any) {
      console.log(`[${i}] FAILED: ${m.title}`);
      console.log(`  Error: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`\n========== SQL UPDATES ==========`);
  for (const sql of sqlUpdates) {
    console.log(sql);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
