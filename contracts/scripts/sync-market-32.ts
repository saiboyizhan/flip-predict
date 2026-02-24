import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const backendUrl = "https://flip-backend-production.up.railway.app";
  const headers: Record<string, string> = { "Origin": "https://flippredict.net" };

  // Get on-chain data for market #32
  const pm = await ethers.getContractAt("PredictionMarketV3", "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25");
  const market = await pm.getMarket(32);
  const endTimeUnix = Number(market[1]);
  const endTimeMs = endTimeUnix * 1000;
  console.log("Market #32 title:", market[0]);
  console.log("Market #32 endTime:", new Date(endTimeMs).toISOString());

  // Get tx hash by scanning recent blocks for UserMarketCreated(32)
  const provider = ethers.provider;
  const latestBlock = await provider.getBlockNumber();
  const eventTopic = ethers.id("UserMarketCreated(uint256,address,string,uint256)");
  const marketIdTopic = ethers.zeroPadValue(ethers.toBeHex(32), 32);

  let fullTxHash = "";
  // Search last 1000 blocks
  const fromBlock = Math.max(0, latestBlock - 1000);
  const logs = await provider.getLogs({
    address: "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25",
    topics: [eventTopic, marketIdTopic],
    fromBlock,
    toBlock: latestBlock,
  });
  if (logs.length > 0) {
    fullTxHash = logs[0].transactionHash;
  }
  if (!fullTxHash) {
    console.log("No event found for market #32");
    return;
  }
  console.log("TxHash:", fullTxHash);

  // Auth
  const nonceRes = await fetch(`${backendUrl}/api/auth/nonce/${deployer.address}`, { headers });
  const nonceData = await nonceRes.json() as any;
  const signature = await deployer.signMessage(nonceData.message);
  const verifyRes = await fetch(`${backendUrl}/api/auth/verify`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ address: deployer.address, signature }),
  });
  const verifyData = await verifyRes.json() as any;
  if (!verifyData.token) { console.log("Auth failed"); return; }

  // Sync
  const createRes = await fetch(`${backendUrl}/api/markets/create`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Authorization: `Bearer ${verifyData.token}` },
    body: JSON.stringify({
      title: "明日 Flap 毕业代币是否超过 10 个？",
      description: "明天 Flap 平台毕业代币数量能否突破 10 个",
      category: "flap",
      endTime: endTimeMs,
      onChainMarketId: "32",
      createTxHash: fullTxHash,
      onChainCreationFee: 0,
      marketType: "binary",
      resolutionType: "manual",
      resolutionRule: "以 Flap 官方页面显示的次日毕业代币数量为准, UTC+8 时间统计",
      resolutionTimeUtc: endTimeMs + 3600000,
    }),
  });
  const data = await createRes.json() as any;
  console.log("Status:", createRes.status);
  console.log("Result:", JSON.stringify(data, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
