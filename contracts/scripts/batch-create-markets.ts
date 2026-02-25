import { ethers } from "hardhat";

const PM_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const BACKEND_URL = "https://flip-backend-production.up.railway.app";
const HEADERS: Record<string, string> = { Origin: "https://flippredict.net" };

const INITIAL_LIQ = ethers.parseUnits("10", 18);

// 截止时间 (北京时间 → UTC)
const TOMORROW = 1772035200n;    // 2026-02-26 00:00 北京 = 2026-02-25 16:00 UTC
const THIS_WEEK = 1772294400n;   // 2026-03-01 00:00 北京 = 2026-02-28 16:00 UTC
const THIS_MONTH = 1772294400n;  // 2026-02-28 24:00 北京 = same
const MARCH_END = 1774972800n;   // 2026-03-31 24:00 北京 = 2026-03-31 16:00 UTC

interface MarketDef {
  title: string;
  description: string;
  category: string;
  resolutionRule: string;
  endTimeUnix: bigint;
}

const MARKETS: MarketDef[] = [
  // === Flap ===
  {
    title: "明日 Flap 毕业代币是否超过 10 个？",
    description: "预测明日 (2026-02-25 北京时间) Flap.sh 平台毕业代币数量是否超过 10 个",
    category: "flap",
    resolutionRule: "以 Flap.sh 官方页面显示的当日毕业代币数量为准, UTC+8 时间 00:00-23:59 统计, 超过 10 个则 YES 胜出",
    endTimeUnix: TOMORROW,
  },
  {
    title: "本周 Flap 毕业代币总数是否超过 60 个？",
    description: "本周 (周一至周日) Flap 平台毕业代币累计是否超过 60 个",
    category: "flap",
    resolutionRule: "以 Flap.sh 官方页面显示的本周毕业代币总数为准, 周日 UTC+8 23:59 截止, 超过 60 个则 YES 胜出",
    endTimeUnix: THIS_WEEK,
  },
  {
    title: "本月 Flap 毕业代币是否突破 250 个？",
    description: "本月 Flap 平台毕业代币累计能否突破 250 个大关",
    category: "flap",
    resolutionRule: "以 Flap.sh 官方页面显示的当月毕业代币总数为准, 月末 UTC+8 23:59 截止, 超过 250 个则 YES 胜出",
    endTimeUnix: THIS_MONTH,
  },

  // === Four.meme ===
  {
    title: "明日 Four.meme 毕业代币是否超过 7 个？",
    description: "预测明日 (2026-02-25 北京时间) Four.meme 平台毕业代币数量是否超过 7 个",
    category: "four-meme",
    resolutionRule: "以 Four.meme 官方页面显示的当日毕业代币数量为准, UTC+8 时间 00:00-23:59 统计, 超过 7 个则 YES 胜出",
    endTimeUnix: TOMORROW,
  },
  {
    title: "本周 Four.meme 毕业代币总数是否超过 35 个？",
    description: "本周 (周一至周日) Four.meme 毕业代币累计是否超过 35 个",
    category: "four-meme",
    resolutionRule: "以 Four.meme 官方页面显示的本周毕业代币总数为准, 周日 UTC+8 23:59 截止, 超过 35 个则 YES 胜出",
    endTimeUnix: THIS_WEEK,
  },
  {
    title: "本月 Four.meme 毕业代币是否突破 150 个？",
    description: "本月 Four.meme 平台毕业代币累计能否突破 150 个",
    category: "four-meme",
    resolutionRule: "以 Four.meme 官方页面显示的当月毕业代币总数为准, 月末 UTC+8 23:59 截止, 超过 150 个则 YES 胜出",
    endTimeUnix: THIS_MONTH,
  },

  // === Versus ===
  {
    title: "本周毕业代币数: Flap vs Four.meme 谁更多？",
    description: "YES = Flap 毕业更多, NO = Four.meme 毕业更多。本周哪个平台毕业代币数量更高？",
    category: "versus",
    resolutionRule: "YES = Flap 本周毕业数 > Four.meme 本周毕业数; NO = 反之。以各平台官方页面数据为准, 周日 UTC+8 23:59 截止。相等则为 NO。",
    endTimeUnix: THIS_WEEK,
  },
  {
    title: "今日毕业率对决: Flap vs Four.meme 谁的毕业率更高？",
    description: "YES = Flap 毕业率更高, NO = Four.meme 毕业率更高。毕业率 = 毕业数/创建数",
    category: "versus",
    resolutionRule: "YES = Flap 今日毕业率 > Four.meme 今日毕业率; NO = 反之。毕业率 = 当日毕业代币数/当日创建代币数。以各平台官方数据为准。相等则为 NO。",
    endTimeUnix: TOMORROW,
  },

  // === Trending ===
  {
    title: "BNB 价格本周是否突破 $700？",
    description: "BNB 在本周内是否曾达到或超过 $700",
    category: "trending",
    resolutionRule: "以 CoinMarketCap 上 BNB/USD 价格为准, 本周内任意时刻触及 $700 即为 YES",
    endTimeUnix: THIS_WEEK,
  },
  {
    title: "BSC 链上日交易笔数本周是否突破 500 万？",
    description: "BSC 链上某一天的交易笔数是否超过 500 万",
    category: "trending",
    resolutionRule: "以 BscScan 显示的 Daily Transactions 数据为准, 本周内任意一天超过 5,000,000 即为 YES",
    endTimeUnix: THIS_WEEK,
  },

  // === AI ===
  {
    title: "OpenAI 是否在 3 月底前发布 GPT-5？",
    description: "OpenAI 是否在 2026 年 3 月 31 日前正式发布 GPT-5 模型",
    category: "ai",
    resolutionRule: "以 OpenAI 官方博客或公告为准, 3月31日 UTC 23:59 前发布正式公告即为 YES, beta/preview 不算",
    endTimeUnix: MARCH_END,
  },

  // === Sports ===
  {
    title: "本周 NBA 是否有球队达成 5 连胜？",
    description: "本周 (周一至周日) NBA 常规赛中是否有任何球队达成 5 场或以上连胜",
    category: "sports",
    resolutionRule: "以 NBA 官方数据 (nba.com) 为准, 截止周日 UTC 23:59 任何球队连胜 >= 5 场即为 YES",
    endTimeUnix: THIS_WEEK,
  },

  // === News ===
  {
    title: "SEC 是否在 3 月底前批准新的加密 ETF？",
    description: "美国 SEC 是否在 2026 年 3 月 31 日前批准任何新的加密货币 ETF",
    category: "news",
    resolutionRule: "以 SEC 官方公告为准, 3月31日 UTC 23:59 前批准任何新加密 ETF (不含已批准的 BTC/ETH 现货 ETF) 即为 YES",
    endTimeUnix: MARCH_END,
  },
];

const EVENT_TOPIC = ethers.id("UserMarketCreated(uint256,address,string,uint256)");
const EVENT_IFACE = new ethers.Interface([
  "event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee)",
]);

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Markets to create:", MARKETS.length);

  const usdt = new ethers.Contract(USDT_ADDRESS, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ], deployer);

  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);

  // 1. Check balance
  const balance = await usdt.balanceOf(deployer.address);
  const totalNeeded = INITIAL_LIQ * BigInt(MARKETS.length);
  console.log("USDT balance:", ethers.formatUnits(balance, 18));
  console.log("Total needed:", ethers.formatUnits(totalNeeded, 18));
  if (balance < totalNeeded) {
    console.error("ERROR: Insufficient USDT balance");
    return;
  }

  // 2. Approve
  console.log("\nApproving USDT...");
  await (await usdt.approve(PM_ADDRESS, totalNeeded)).wait();
  console.log("Approved");

  // 3. Create markets on-chain
  const created: { marketId: string; txHash: string; idx: number }[] = [];

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    const endMs = Number(m.endTimeUnix) * 1000;
    console.log(`\n[${i + 1}/${MARKETS.length}] ${m.title}`);
    console.log("  EndTime:", new Date(endMs).toISOString());

    const tx = await pm.createUserMarket(m.title, m.endTimeUnix, INITIAL_LIQ);
    const receipt = await tx.wait();

    let marketId: string | null = null;
    for (const log of receipt!.logs) {
      if (log.topics[0] === EVENT_TOPIC) {
        const decoded = EVENT_IFACE.decodeEventLog("UserMarketCreated", log.data, log.topics);
        marketId = decoded[0].toString();
        break;
      }
    }
    if (!marketId) {
      console.error("  ERROR: event not found, stopping");
      return;
    }
    console.log(`  On-chain #${marketId}, tx: ${receipt!.hash.slice(0, 18)}...`);
    created.push({ marketId, txHash: receipt!.hash, idx: i });
  }

  // 4. Backend auth
  console.log("\n=== Backend Sync ===");
  const nonceRes = await fetch(`${BACKEND_URL}/api/auth/nonce/${deployer.address}`, { headers: HEADERS });
  const nonceData = (await nonceRes.json()) as any;
  const signature = await deployer.signMessage(nonceData.message);
  const verifyRes = await fetch(`${BACKEND_URL}/api/auth/verify`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ address: deployer.address, signature }),
  });
  const verifyData = (await verifyRes.json()) as any;
  if (!verifyData.token) {
    console.error("Auth failed:", JSON.stringify(verifyData));
    return;
  }
  const authHeaders = {
    ...HEADERS,
    "Content-Type": "application/json",
    Authorization: `Bearer ${verifyData.token}`,
  };
  console.log("Auth OK");

  // 5. Sync + auto-approve
  for (const cm of created) {
    const m = MARKETS[cm.idx];
    const endMs = Number(m.endTimeUnix) * 1000;

    const createRes = await fetch(`${BACKEND_URL}/api/markets/create`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: m.title,
        description: m.description,
        category: m.category,
        endTime: endMs,
        onChainMarketId: cm.marketId,
        createTxHash: cm.txHash,
        onChainCreationFee: 0,
        marketType: "binary",
        resolutionType: "manual",
        resolutionRule: m.resolutionRule,
        resolutionTimeUtc: endMs + 3600000,
      }),
    });

    const createData = (await createRes.json()) as any;
    if (!createRes.ok) {
      console.error(`  #${cm.marketId} sync FAIL:`, createRes.status, JSON.stringify(createData));
      continue;
    }

    const dbId = createData.market?.id;
    if (dbId) {
      const approveRes = await fetch(`${BACKEND_URL}/api/markets/${dbId}/approve`, {
        method: "POST",
        headers: authHeaders,
      });
      if (approveRes.ok) {
        console.log(`  #${cm.marketId} ${m.category} OK -> ${dbId}`);
      } else {
        console.error(`  #${cm.marketId} approve FAIL:`, approveRes.status);
      }
    }
  }

  console.log("\n=== DONE ===");
  console.log(`Created ${created.length} markets (ocid ${created[0]?.marketId} - ${created[created.length-1]?.marketId})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
