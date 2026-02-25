import { ethers } from "hardhat";

const PM_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
const CANCEL_IDS = [30, 31, 32, 33, 34];

async function main() {
  const [deployer] = await ethers.getSigners();
  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);
  let total = 0n;

  for (const id of CANCEL_IDS) {
    console.log(`Market #${id}:`);
    try {
      await (await pm.cancelMarket(id)).wait();
      console.log("  Cancelled");
    } catch (e: any) {
      console.log("  Cancel:", (e.message || "").slice(0, 80));
    }

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
          total += refund;
          console.log(`  Reclaimed ${ethers.formatUnits(refund, 18)} USDT`);
          break;
        }
      }
    } catch (e: any) {
      console.log("  LP refund:", (e.message || "").slice(0, 80));
    }
  }

  console.log(`\nTotal reclaimed: ${ethers.formatUnits(total, 18)} USDT`);
}

main().catch(console.error);
