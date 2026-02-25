import { ethers } from "hardhat";

const PM_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
// Markets 0-9 are cancelled, 10 had overflow issue
const CANCELLED_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const OVERFLOW_ID = 10;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);
  let totalRecovered = 0n;

  // Cancelled markets: use lpRefundAfterCancel
  for (const id of CANCELLED_IDS) {
    const info = await pm.getLpInfo(id, deployer.address);
    const userShares = info.userLpShares as bigint;
    if (userShares === 0n) continue;

    console.log(`Market #${id}: ${ethers.formatUnits(userShares, 18)} LP, ~${ethers.formatUnits(info.userValue as bigint, 18)} USDT`);
    try {
      const tx = await pm.lpRefundAfterCancel(id);
      const receipt = await tx.wait();
      const topic = ethers.id("LpRefundedAfterCancel(uint256,address,uint256,uint256)");
      for (const log of receipt!.logs) {
        if (log.topics[0] === topic) {
          const iface = new ethers.Interface([
            "event LpRefundedAfterCancel(uint256 indexed marketId, address indexed provider, uint256 sharesBurned, uint256 refund)",
          ]);
          const decoded = iface.decodeEventLog("LpRefundedAfterCancel", log.data, log.topics);
          const refund = decoded.refund as bigint;
          totalRecovered += refund;
          console.log(`  Got ${ethers.formatUnits(refund, 18)} USDT`);
          break;
        }
      }
    } catch (e: any) {
      console.log(`  Failed: ${(e.message || "").slice(0, 120)}`);
    }
  }

  // Market #10: resolved but had arithmetic overflow
  // Check its state
  console.log(`\nMarket #${OVERFLOW_ID}:`);
  const info10 = await pm.getLpInfo(OVERFLOW_ID, deployer.address);
  console.log(`  LP shares: ${ethers.formatUnits(info10.userLpShares as bigint, 18)}`);
  console.log(`  Value: ~${ethers.formatUnits(info10.userValue as bigint, 18)} USDT`);
  const amm10 = await pm.getMarketAmm(OVERFLOW_ID);
  console.log(`  AMM: yes=${ethers.formatUnits(amm10[0], 18)} no=${ethers.formatUnits(amm10[1], 18)} totalLP=${ethers.formatUnits(amm10[2], 18)} collateral=${ethers.formatUnits(amm10[4], 18)}`);

  // Check market detail
  const detail10 = await pm.getMarketDetails(OVERFLOW_ID);
  console.log(`  resolved=${detail10.resolved} cancelled=${detail10.cancelled}`);

  // Try lpClaimAfterResolution or lpRefundAfterCancel based on state
  try {
    if (detail10.cancelled) {
      const tx = await pm.lpRefundAfterCancel(OVERFLOW_ID);
      const receipt = await tx.wait();
      console.log(`  lpRefundAfterCancel OK`);
    } else if (detail10.resolved) {
      const tx = await pm.lpClaimAfterResolution(OVERFLOW_ID);
      const receipt = await tx.wait();
      console.log(`  lpClaimAfterResolution OK`);
    }
  } catch (e: any) {
    console.log(`  Still failed: ${(e.message || "").slice(0, 150)}`);
  }

  console.log(`\n=== TOTAL RECOVERED: ${ethers.formatUnits(totalRecovered, 18)} USDT ===`);

  const usdt = new ethers.Contract("0x55d398326f99059fF775485246999027B3197955", [
    "function balanceOf(address) view returns (uint256)",
  ], deployer);
  const balance = await usdt.balanceOf(deployer.address);
  console.log(`Deployer USDT balance: ${ethers.formatUnits(balance, 18)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
