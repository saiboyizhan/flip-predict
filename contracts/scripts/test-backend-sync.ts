import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Testing backend sync with:", deployer.address);

  const backendUrl = "https://flip-backend-production.up.railway.app";
  const headers = { "Origin": "https://flippredict.net" };

  // Use market #29 that was already created on-chain
  const marketId = "29";
  const txHash = "0xaf4b4f3451d6d5a8f2bf6c4f9108e4361efeeba28b92ec20690e0341651705f0";
  const title = "Test Market: Will BNB hit $700 by March 2026?";
  const endTimeUnix = 1741058449; // from the tx
  const endTimeMs = endTimeUnix * 1000;

  // 1. Auth
  console.log("Step 1: Getting nonce...");
  const nonceRes = await fetch(`${backendUrl}/api/auth/nonce/${deployer.address}`, { headers });
  const nonceData = await nonceRes.json() as any;
  console.log("  Nonce:", nonceData.nonce);

  console.log("Step 2: Signing...");
  const signature = await deployer.signMessage(nonceData.message);

  console.log("Step 3: Verifying...");
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
  console.log("  Token obtained");

  // 2. Sync market to backend
  console.log("Step 4: Syncing market to backend...");
  const createRes = await fetch(`${backendUrl}/api/markets/create`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${verifyData.token}`,
    },
    body: JSON.stringify({
      title,
      description: "Test market created via script",
      category: "four-meme",
      endTime: endTimeMs,
      onChainMarketId: marketId,
      createTxHash: txHash,
      onChainCreationFee: 0,
      marketType: "binary",
      resolutionType: "manual",
      resolutionRule: "Based on official BNB price at market end time on CoinMarketCap.",
      resolutionTimeUtc: endTimeMs + 3600000,
    }),
  });

  const createData = await createRes.json() as any;
  console.log("  Status:", createRes.status);
  if (createRes.ok) {
    console.log("  === Backend sync SUCCESS ===");
    console.log("  DB market id:", createData.market?.id);
    console.log("  Market status:", createData.market?.status);
    console.log("  Initial liquidity:", createData.market?.initial_liquidity);
    console.log("  Fee:", createData.fee);
  } else {
    console.log("  === Backend sync FAILED ===");
    console.log("  Error:", JSON.stringify(createData));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
