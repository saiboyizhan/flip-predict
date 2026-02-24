import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Testing with:", deployer.address);

  const PM_ADDRESS = "0xB80a8fE565663fF0b06a2b859eBd29C8492aDc25";
  const USDT_ADDRESS = "0xf1669057F6eaF2216525eea54a32fC1abF967fb5";
  const INITIAL_LIQ = ethers.parseUnits("10", 18);
  const backendUrl = "https://flip-backend-production.up.railway.app";
  const headers: Record<string, string> = { "Origin": "https://flippredict.net" };

  const usdt = await ethers.getContractAt("MockUSDT", USDT_ADDRESS);
  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);

  // 1. Check balance & approve
  const balance = await usdt.balanceOf(deployer.address);
  console.log("USDT balance:", ethers.formatUnits(balance, 18));
  if (balance < INITIAL_LIQ) {
    console.log("Minting 1000 USDT...");
    await (await usdt.mint(deployer.address, ethers.parseUnits("1000", 18))).wait();
  }
  console.log("Approving USDT...");
  await (await usdt.approve(PM_ADDRESS, INITIAL_LIQ)).wait();

  // 2. Create market on-chain
  const title = "E2E Test: Will BSC daily txns exceed 5M by April 2026?";
  const endTimeUnix = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
  const endTimeMs = Number(endTimeUnix) * 1000;

  console.log("\nCreating market on-chain...");
  console.log("  title:", title);
  console.log("  endTime:", new Date(endTimeMs).toISOString());
  console.log("  initialLiq: 10 USDT");

  const tx = await pm.createUserMarket(title, endTimeUnix, INITIAL_LIQ);
  const receipt = await tx.wait();
  console.log("  txHash:", receipt!.hash);

  // 3. Parse event
  const eventTopic = ethers.id("UserMarketCreated(uint256,address,string,uint256)");
  const iface = new ethers.Interface([
    "event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee)",
  ]);
  let marketId: string | null = null;
  for (const log of receipt!.logs) {
    if (log.topics[0] === eventTopic) {
      const decoded = iface.decodeEventLog("UserMarketCreated", log.data, log.topics);
      marketId = decoded[0].toString();
      console.log("  marketId:", marketId);
      break;
    }
  }
  if (!marketId) {
    console.error("ERROR: event not found");
    return;
  }

  // 4. Verify AMM
  const amm = await pm.getMarketAmm(BigInt(marketId));
  console.log("\n  AMM: yes=" + ethers.formatUnits(amm[0], 18) + " no=" + ethers.formatUnits(amm[1], 18) + " liq=" + ethers.formatUnits(amm[3], 18));

  // 5. Backend auth
  console.log("\n--- Backend Sync ---");
  console.log("Step 1: Auth...");
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
    console.log("  Auth failed:", JSON.stringify(verifyData));
    return;
  }
  console.log("  Auth OK");

  // 6. Sync to backend
  console.log("Step 2: Create market record...");
  const createRes = await fetch(`${backendUrl}/api/markets/create`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${verifyData.token}`,
    },
    body: JSON.stringify({
      title,
      description: "E2E test for market creation flow",
      category: "four-meme",
      endTime: endTimeMs,
      onChainMarketId: marketId,
      createTxHash: receipt!.hash,
      onChainCreationFee: 0,
      marketType: "binary",
      resolutionType: "manual",
      resolutionRule: "Based on BSCScan daily transaction count on the last day of the market period.",
      resolutionTimeUtc: endTimeMs + 3600000,
    }),
  });

  const createData = await createRes.json() as any;
  console.log("  HTTP:", createRes.status);
  if (createRes.ok) {
    console.log("\n=== E2E SUCCESS ===");
    console.log("  On-chain market #" + marketId);
    console.log("  DB id:", createData.market?.id);
    console.log("  Status:", createData.market?.status);
    console.log("  Initial liquidity:", createData.market?.initial_liquidity);
    console.log("  Fee:", createData.fee);
  } else {
    console.log("\n=== BACKEND SYNC FAILED ===");
    console.log("  Error:", JSON.stringify(createData));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
