import { ethers } from "hardhat";

const PM_ADDRESS = "0xd1d9E6cB7f488AA7D9db68F89734aa94f0e6ef4B";
const USDT_ADDRESS = "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";

const INITIAL_LIQ = ethers.parseEther("500");   // 500 USDT
const CREATION_FEE = ethers.parseEther("10");    // 10 USDT per market
const PER_MARKET = INITIAL_LIQ + CREATION_FEE;   // 510 USDT

interface MarketDef {
  title: string;
  category: string;
  daysFromNow: number; // end time offset in days
}

const MARKETS: MarketDef[] = [
  // Four.meme (category: four-meme)
  { title: "本周 Four.meme 毕业代币总数是否超过 500 个？", category: "four-meme", daysFromNow: 7 },
  { title: "Four.meme 日均创建代币数是否超过 5000 个？", category: "four-meme", daysFromNow: 7 },
  { title: "本周 Four.meme 毕业率是否超过 2%？", category: "four-meme", daysFromNow: 7 },
  { title: "下周 Four.meme 毕业代币总数是否超过 700 个？", category: "four-meme", daysFromNow: 14 },
  { title: "Four.meme TVL 是否在本月突破 $10M？", category: "four-meme", daysFromNow: 10 },

  // Flap (category: flap)
  { title: "Flap 本周毕业代币总数是否超过 50 个？", category: "flap", daysFromNow: 7 },
  { title: "Flap 日均创建代币数是否超过 200 个？", category: "flap", daysFromNow: 7 },
  { title: "Flap 本周毕业率是否超过 5%？", category: "flap", daysFromNow: 7 },
  { title: "下周 Flap 毕业代币总数是否超过 80 个？", category: "flap", daysFromNow: 14 },
  { title: "Flap 是否在本月达到 1000 个总毕业代币？", category: "flap", daysFromNow: 10 },

  // NFA Agent (category: nfa)
  { title: "本周 NFA Agent Top1 准确率是否超过 70%？", category: "nfa", daysFromNow: 7 },
  { title: "本周新铸造 NFA Agent 是否超过 50 个？", category: "nfa", daysFromNow: 7 },
  { title: "NFA Agent 日均交易量是否超过 500 笔？", category: "nfa", daysFromNow: 7 },
  { title: "本周是否有 NFA Agent 达成 5 连胜？", category: "nfa", daysFromNow: 7 },
  { title: "NFA Agent 跟单关注者是否突破 100 人？", category: "nfa", daysFromNow: 10 },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const usdt = await ethers.getContractAt("MockUSDT", USDT_ADDRESS);
  const pm = await ethers.getContractAt("PredictionMarket", PM_ADDRESS);

  // 1. Raise daily market limit (deployer is owner)
  const currentLimit = await pm.maxMarketsPerDay();
  console.log("Current maxMarketsPerDay:", currentLimit.toString());
  if (currentLimit < 20n) {
    const tx = await pm.setMaxMarketsPerDay(20);
    await tx.wait();
    console.log("maxMarketsPerDay set to 20");
  }

  // 2. Mint USDT
  const totalNeeded = PER_MARKET * BigInt(MARKETS.length); // 510 * 15 = 7650 USDT
  console.log(`\nMinting ${ethers.formatEther(totalNeeded)} USDT...`);
  const mintTx = await usdt.mint(deployer.address, totalNeeded);
  await mintTx.wait();

  // 3. Approve PredictionMarket
  console.log("Approving USDT...");
  const approveTx = await usdt.approve(PM_ADDRESS, totalNeeded);
  await approveTx.wait();

  // 4. Create markets
  const results: { index: number; onChainId: bigint; title: string; category: string; endTime: number }[] = [];

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    const endTime = Math.floor(Date.now() / 1000) + m.daysFromNow * 86400;

    console.log(`\n[${i}] Creating: "${m.title}"`);
    const tx = await pm.createUserMarket(m.title, endTime, INITIAL_LIQ);
    const receipt = await tx.wait();

    // Parse MarketCreated event to get onChainMarketId
    const event = receipt!.logs.find((log: any) => {
      try {
        const parsed = pm.interface.parseLog({ topics: log.topics as string[], data: log.data });
        return parsed?.name === "MarketCreated";
      } catch { return false; }
    });

    let onChainId: bigint;
    if (event) {
      const parsed = pm.interface.parseLog({ topics: event.topics as string[], data: event.data });
      onChainId = parsed!.args[0];
    } else {
      // Fallback: read nextMarketId - 1
      onChainId = (await pm.nextMarketId()) - 1n;
    }

    console.log(`  → onChainMarketId = ${onChainId}, tx = ${tx.hash}`);
    results.push({ index: i, onChainId, title: m.title, category: m.category, endTime });
  }

  // 5. Output SQL INSERT statements
  console.log("\n\n========================================");
  console.log("SQL INSERT STATEMENTS");
  console.log("========================================\n");

  const nowMs = Date.now();
  const sqlLines: string[] = [];

  for (const r of results) {
    const id = `v2-${String(r.index + 1).padStart(3, "0")}`;
    const endTimeMs = r.endTime * 1000;
    const desc = r.title; // use title as description too

    const sql = `INSERT INTO markets (id, on_chain_market_id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at, market_type, total_lp_shares, initial_liquidity, virtual_lp_shares) VALUES ('${id}', ${r.onChainId}, '${r.title.replace(/'/g, "''")}', '${desc.replace(/'/g, "''")}', '${r.category}', ${endTimeMs}, 'active', 0.5, 0.5, 0, 500, 500, 500, ${nowMs}, 'binary', 500, 500, 500);`;
    sqlLines.push(sql);
    console.log(sql);
  }

  console.log("\n-- Full SQL block:");
  console.log("BEGIN;");
  sqlLines.forEach(s => console.log(s));
  console.log("COMMIT;");

  console.log("\n========================================");
  console.log(`Done! Created ${results.length} markets on-chain.`);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
