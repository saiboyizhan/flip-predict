import { ethers } from "hardhat";

const PM_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const BACKEND_URL = "https://flip-backend-production.up.railway.app";
const HEADERS: Record<string, string> = { Origin: "https://flippredict.net" };

const INITIAL_LIQ = ethers.parseUnits("30", 18);
// 2026-02-26 00:00 北京 = 2026-02-25 16:00 UTC
const END_TIME_UNIX = 1772035200n;
const END_TIME_MS = Number(END_TIME_UNIX) * 1000;

const CANCEL_IDS = [20, 21];

const MARKETS = [
  {
    title: "今日 Flap 毕业代币是否超过 10 个？",
    description: "预测今日 (2026-02-24 北京时间) Flap.sh 平台毕业代币数量是否超过 10 个。以 Flap 官方数据为准。",
    category: "flap",
    resolutionRule: "以 Flap.sh 官方页面显示的当日毕业代币数量为准，超过 10 个则 YES 胜出，否则 NO 胜出。",
  },
  {
    title: "今日 Four.meme 毕业代币是否超过 10 个？",
    description: "预测今日 (2026-02-24 北京时间) Four.meme 平台毕业代币数量是否超过 10 个。以 Four.meme 官方数据为准。",
    category: "four-meme",
    resolutionRule: "以 Four.meme 官方页面显示的当日毕业代币数量为准，超过 10 个则 YES 胜出，否则 NO 胜出。",
  },
];

const EVENT_TOPIC = ethers.id("UserMarketCreated(uint256,address,string,uint256)");
const EVENT_IFACE = new ethers.Interface([
  "event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee)",
]);

async function main() {
  const [deployer] = await ethers.getSigners();
  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);
  const usdt = new ethers.Contract(USDT_ADDRESS, [
    "function approve(address,uint256) returns (bool)",
  ], deployer);

  // 1. Cancel old markets and reclaim LP
  console.log("=== Cancel old #20, #21 ===");
  for (const id of CANCEL_IDS) {
    try {
      await (await pm.cancelMarket(id)).wait();
      console.log(`  #${id} cancelled`);
      await (await pm.lpRefundAfterCancel(id)).wait();
      console.log(`  #${id} LP reclaimed`);
    } catch (e: any) {
      console.log(`  #${id} error: ${(e.message || "").slice(0, 80)}`);
    }
  }

  // 2. Approve and create new markets
  const totalNeeded = INITIAL_LIQ * BigInt(MARKETS.length);
  await (await usdt.approve(PM_ADDRESS, totalNeeded)).wait();

  const created: { marketId: string; txHash: string; idx: number }[] = [];
  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    console.log(`\nCreating: ${m.title}`);
    console.log(`  EndTime: ${new Date(END_TIME_MS).toISOString()} (北京 2026-02-26 00:00)`);
    const tx = await pm.createUserMarket(m.title, END_TIME_UNIX, INITIAL_LIQ);
    const receipt = await tx.wait();
    let marketId: string | null = null;
    for (const log of receipt!.logs) {
      if (log.topics[0] === EVENT_TOPIC) {
        const decoded = EVENT_IFACE.decodeEventLog("UserMarketCreated", log.data, log.topics);
        marketId = decoded[0].toString();
        break;
      }
    }
    if (!marketId) { console.error("  Event not found!"); return; }
    console.log(`  On-chain #${marketId}`);
    created.push({ marketId, txHash: receipt!.hash, idx: i });
  }

  // 3. Backend auth + sync
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
  if (!verifyData.token) { console.error("Auth failed"); return; }
  const authHeaders = { ...HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${verifyData.token}` };

  for (const cm of created) {
    const m = MARKETS[cm.idx];
    const createRes = await fetch(`${BACKEND_URL}/api/markets/create`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: m.title, description: m.description, category: m.category,
        endTime: END_TIME_MS, onChainMarketId: cm.marketId, createTxHash: cm.txHash,
        onChainCreationFee: 0, marketType: "binary", resolutionType: "manual",
        resolutionRule: m.resolutionRule, resolutionTimeUtc: END_TIME_MS + 3600000,
      }),
    });
    const createData = (await createRes.json()) as any;
    if (!createRes.ok) { console.error(`  Sync failed:`, createData); continue; }
    const dbId = createData.market?.id;
    if (dbId) {
      await fetch(`${BACKEND_URL}/api/markets/${dbId}/approve`, { method: "POST", headers: authHeaders });
      console.log(`  #${cm.marketId} -> ${dbId} OK`);
    }
  }

  console.log("\n=== DONE ===");
}

main().catch(console.error);
