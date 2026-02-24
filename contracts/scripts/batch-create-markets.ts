import { ethers } from "hardhat";

interface MarketDef {
  title: string;
  category: string;
  description: string;
  hoursFromNow: number;
  resolutionRule: string;
}

const MARKETS: MarketDef[] = [
  // === Flap (日均毕业 ~8 个) ===
  {
    title: "今日 Flap 毕业代币是否超过 8 个？",
    category: "flap",
    description: "Flap 平台上今日成功毕业的代币数量是否超过 8 个",
    hoursFromNow: 24,
    resolutionRule: "以 Flap 官方页面显示的当日毕业代币数量为准, UTC+8 时间 00:00-23:59 统计",
  },
  {
    title: "明日 Flap 毕业代币是否超过 10 个？",
    category: "flap",
    description: "明天 Flap 平台毕业代币数量能否突破 10 个",
    hoursFromNow: 48,
    resolutionRule: "以 Flap 官方页面显示的次日毕业代币数量为准, UTC+8 时间统计",
  },
  {
    title: "本周 Flap 毕业代币总数是否超过 60 个？",
    category: "flap",
    description: "本周 (周一至周日) Flap 平台毕业代币累计是否超过 60 个",
    hoursFromNow: 168,
    resolutionRule: "以 Flap 官方页面显示的本周毕业代币总数为准, 周日 UTC+8 23:59 截止",
  },
  {
    title: "本月 Flap 毕业代币是否突破 250 个？",
    category: "flap",
    description: "本月 Flap 平台毕业代币累计能否突破 250 个大关",
    hoursFromNow: 720,
    resolutionRule: "以 Flap 官方页面显示的当月毕业代币总数为准, 月末 UTC+8 23:59 截止",
  },

  // === Four.meme (日均毕业 ~5 个) ===
  {
    title: "今日 Four.meme 毕业代币是否超过 5 个？",
    category: "four-meme",
    description: "Four.meme 平台上今日成功毕业的代币数量是否超过 5 个",
    hoursFromNow: 24,
    resolutionRule: "以 Four.meme 官方页面显示的当日毕业代币数量为准, UTC+8 时间 00:00-23:59 统计",
  },
  {
    title: "明日 Four.meme 毕业代币是否超过 7 个？",
    category: "four-meme",
    description: "明天 Four.meme 平台毕业代币数量能否突破 7 个",
    hoursFromNow: 48,
    resolutionRule: "以 Four.meme 官方页面显示的次日毕业代币数量为准, UTC+8 时间统计",
  },
  {
    title: "本周 Four.meme 毕业代币总数是否超过 35 个？",
    category: "four-meme",
    description: "本周 (周一至周日) Four.meme 毕业代币累计是否超过 35 个",
    hoursFromNow: 168,
    resolutionRule: "以 Four.meme 官方页面显示的本周毕业代币总数为准, 周日 UTC+8 23:59 截止",
  },
  {
    title: "本月 Four.meme 毕业代币是否突破 150 个？",
    category: "four-meme",
    description: "本月 Four.meme 平台毕业代币累计能否突破 150 个",
    hoursFromNow: 720,
    resolutionRule: "以 Four.meme 官方页面显示的当月毕业代币总数为准, 月末 UTC+8 23:59 截止",
  },

  // === Versus (对决) ===
  {
    title: "本周毕业代币数: Flap vs Four.meme 谁更多？",
    category: "versus",
    description: "YES = Flap 毕业更多, NO = Four.meme 毕业更多。本周哪个平台毕业代币数量更高？",
    hoursFromNow: 168,
    resolutionRule: "YES = Flap 本周毕业数 > Four.meme 本周毕业数; NO = 反之。以各平台官方页面数据为准, 周日 UTC+8 23:59 截止。相等则为 NO。",
  },
  {
    title: "今日毕业率对决: Flap vs Four.meme 谁的毕业率更高？",
    category: "versus",
    description: "YES = Flap 毕业率更高, NO = Four.meme 毕业率更高。毕业率 = 毕业数/创建数",
    hoursFromNow: 24,
    resolutionRule: "YES = Flap 今日毕业率 > Four.meme 今日毕业率; NO = 反之。毕业率 = 当日毕业代币数/当日创建代币数。以各平台官方数据为准。相等则为 NO。",
  },

  // === Trending (实时热点) ===
  {
    title: "BNB 价格本周是否突破 $700？",
    category: "trending",
    description: "BNB 在本周内是否曾达到或超过 $700",
    hoursFromNow: 168,
    resolutionRule: "以 CoinMarketCap 上 BNB/USD 价格为准, 本周内任意时刻触及 $700 即为 YES",
  },
  {
    title: "BSC 链上日交易笔数本周是否突破 500 万？",
    category: "trending",
    description: "BSC 链上某一天的交易笔数是否超过 500 万",
    hoursFromNow: 168,
    resolutionRule: "以 BscScan 显示的 Daily Transactions 数据为准, 本周内任意一天超过 5,000,000 即为 YES",
  },

  // === AI ===
  {
    title: "OpenAI 是否在 3 月底前发布 GPT-5？",
    category: "ai",
    description: "OpenAI 是否在 2026 年 3 月 31 日前正式发布 GPT-5 模型",
    hoursFromNow: 720,
    resolutionRule: "以 OpenAI 官方博客或公告为准, 3月31日 UTC 23:59 前发布正式公告即为 YES, beta/preview 不算",
  },

  // === Sports (体育) ===
  {
    title: "本周 NBA 是否有球队达成 5 连胜？",
    category: "sports",
    description: "本周 (周一至周日) NBA 常规赛中是否有任何球队达成 5 场或以上连胜",
    hoursFromNow: 168,
    resolutionRule: "以 NBA 官方数据 (nba.com) 为准, 截止周日 UTC 23:59 任何球队连胜 >= 5 场即为 YES",
  },

  // === News (新闻) ===
  {
    title: "SEC 是否在 3 月底前批准新的加密 ETF？",
    category: "news",
    description: "美国 SEC 是否在 2026 年 3 月 31 日前批准任何新的加密货币 ETF",
    hoursFromNow: 720,
    resolutionRule: "以 SEC 官方公告为准, 3月31日 UTC 23:59 前批准任何新加密 ETF (不含已批准的 BTC/ETH 现货 ETF) 即为 YES",
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const PM_ADDRESS = "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25";
  const USDT_ADDRESS = "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";
  const INITIAL_LIQ = ethers.parseUnits("10", 18);
  const backendUrl = "https://flip-backend-production.up.railway.app";
  const headers: Record<string, string> = { "Origin": "https://flippredict.net" };

  const usdt = await ethers.getContractAt("MockUSDT", USDT_ADDRESS);
  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);

  // Pre-approve enough USDT for all markets
  const totalNeeded = INITIAL_LIQ * BigInt(MARKETS.length);
  console.log(`Approving ${ethers.formatUnits(totalNeeded, 18)} USDT for ${MARKETS.length} markets...`);
  await (await usdt.approve(PM_ADDRESS, totalNeeded)).wait();

  // Auth with backend
  console.log("Authenticating with backend...");
  const nonceRes = await fetch(`${backendUrl}/api/auth/nonce/${deployer.address}`, { headers });
  const nonceData = await nonceRes.json() as any;
  const signature = await deployer.signMessage(nonceData.message);
  const verifyRes = await fetch(`${backendUrl}/api/auth/verify`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ address: deployer.address, signature }),
  });
  const verifyData = await verifyRes.json() as any;
  if (!verifyData.token) {
    console.error("Auth failed:", JSON.stringify(verifyData));
    return;
  }
  const authToken = verifyData.token;
  console.log("Auth OK\n");

  const eventTopic = ethers.id("UserMarketCreated(uint256,address,string,uint256)");
  const iface = new ethers.Interface([
    "event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee)",
  ]);

  const results: { title: string; marketId: string; status: string }[] = [];

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    const endTimeUnix = BigInt(Math.floor(Date.now() / 1000) + m.hoursFromNow * 3600);
    const endTimeMs = Number(endTimeUnix) * 1000;

    console.log(`[${i + 1}/${MARKETS.length}] ${m.title}`);

    // Create on-chain
    try {
      const tx = await pm.createUserMarket(m.title, endTimeUnix, INITIAL_LIQ);
      const receipt = await tx.wait();

      let marketId: string | null = null;
      for (const log of receipt!.logs) {
        if (log.topics[0] === eventTopic) {
          const decoded = iface.decodeEventLog("UserMarketCreated", log.data, log.topics);
          marketId = decoded[0].toString();
          break;
        }
      }

      if (!marketId) {
        console.log("  ERROR: event not found");
        results.push({ title: m.title, marketId: "?", status: "event_missing" });
        continue;
      }
      console.log(`  on-chain #${marketId}, tx: ${receipt!.hash.slice(0, 16)}...`);

      // Sync to backend
      const createRes = await fetch(`${backendUrl}/api/markets/create`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: m.title,
          description: m.description,
          category: m.category,
          endTime: endTimeMs,
          onChainMarketId: marketId,
          createTxHash: receipt!.hash,
          onChainCreationFee: 0,
          marketType: "binary",
          resolutionType: "manual",
          resolutionRule: m.resolutionRule,
          resolutionTimeUtc: endTimeMs + 3600000,
        }),
      });

      const createData = await createRes.json() as any;
      if (createRes.ok) {
        console.log(`  backend OK, db: ${createData.market?.id}, liq: ${createData.market?.initial_liquidity}`);
        results.push({ title: m.title, marketId, status: "OK" });
      } else {
        console.log(`  backend FAIL: ${JSON.stringify(createData)}`);
        results.push({ title: m.title, marketId, status: `backend_${createRes.status}` });
      }
    } catch (err: any) {
      console.log(`  TX FAIL: ${err.message?.slice(0, 100)}`);
      results.push({ title: m.title, marketId: "?", status: "tx_failed" });
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`  [${r.status}] #${r.marketId} ${r.title}`);
  }
  console.log(`\nTotal: ${results.length}, OK: ${results.filter(r => r.status === "OK").length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
