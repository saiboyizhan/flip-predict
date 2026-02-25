import { ethers } from "hardhat";

const PM_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";

// 旧市场 ID 范围: 0-19, 41-45
const OLD_MARKET_IDS = [
  ...Array.from({ length: 20 }, (_, i) => i),    // 0-19
  ...Array.from({ length: 5 }, (_, i) => 41 + i), // 41-45
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);

  // 1. Scan all old markets for LP positions
  console.log("\n=== Scanning LP positions ===");
  const withdrawable: { id: number; shares: bigint; value: string }[] = [];

  for (const id of OLD_MARKET_IDS) {
    try {
      const info = await pm.getLpInfo(id, deployer.address);
      const userShares = info.userLpShares as bigint;
      const userValue = info.userValue as bigint;

      if (userShares > 0n) {
        console.log(`  Market #${id}: ${ethers.formatUnits(userShares, 18)} LP shares = ~${ethers.formatUnits(userValue, 18)} USDT`);
        withdrawable.push({ id, shares: userShares, value: ethers.formatUnits(userValue, 18) });
      }
    } catch (e: any) {
      // Market doesn't exist on-chain, skip
    }
  }

  if (withdrawable.length === 0) {
    console.log("  No LP positions found in old markets");
    return;
  }

  console.log(`\nFound ${withdrawable.length} markets with LP positions`);
  const totalValue = withdrawable.reduce((sum, w) => sum + parseFloat(w.value), 0);
  console.log(`Total estimated value: ~${totalValue.toFixed(2)} USDT`);

  // 2. Withdraw from each market
  console.log("\n=== Withdrawing ===");
  let totalRecovered = 0n;

  for (const w of withdrawable) {
    try {
      // removeLiquidity has a minimum reserve check, try max shares first
      // if it fails with ReserveDepleted, try leaving some
      console.log(`  Market #${w.id}: removing ${ethers.formatUnits(w.shares, 18)} shares...`);
      const tx = await pm.removeLiquidity(w.id, w.shares);
      const receipt = await tx.wait();

      // Parse LiquidityRemoved event to get actual USDT out
      const eventTopic = ethers.id("LiquidityRemoved(uint256,address,uint256,uint256)");
      for (const log of receipt!.logs) {
        if (log.topics[0] === eventTopic) {
          const iface = new ethers.Interface([
            "event LiquidityRemoved(uint256 indexed marketId, address indexed provider, uint256 sharesBurned, uint256 usdtOut)",
          ]);
          const decoded = iface.decodeEventLog("LiquidityRemoved", log.data, log.topics);
          const usdtOut = decoded.usdtOut as bigint;
          totalRecovered += usdtOut;
          console.log(`    OK: got ${ethers.formatUnits(usdtOut, 18)} USDT`);
          break;
        }
      }
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.includes("ReserveDepleted") || msg.includes("0x")) {
        // Try removing half
        const halfShares = w.shares / 2n;
        if (halfShares > 0n) {
          console.log(`    Full remove failed, trying half (${ethers.formatUnits(halfShares, 18)} shares)...`);
          try {
            const tx = await pm.removeLiquidity(w.id, halfShares);
            const receipt = await tx.wait();
            const eventTopic = ethers.id("LiquidityRemoved(uint256,address,uint256,uint256)");
            for (const log of receipt!.logs) {
              if (log.topics[0] === eventTopic) {
                const iface = new ethers.Interface([
                  "event LiquidityRemoved(uint256 indexed marketId, address indexed provider, uint256 sharesBurned, uint256 usdtOut)",
                ]);
                const decoded = iface.decodeEventLog("LiquidityRemoved", log.data, log.topics);
                const usdtOut = decoded.usdtOut as bigint;
                totalRecovered += usdtOut;
                console.log(`    Partial OK: got ${ethers.formatUnits(usdtOut, 18)} USDT`);
                break;
              }
            }
          } catch (e2: any) {
            console.log(`    Partial also failed: ${e2.message?.slice(0, 80)}`);
          }
        }
      } else {
        console.log(`    Failed: ${msg.slice(0, 100)}`);
      }
    }
  }

  // 3. Also check for YES/NO token positions (from resolved markets)
  console.log("\n=== Checking YES/NO positions ===");
  for (const id of OLD_MARKET_IDS) {
    try {
      const pos = await pm.getPosition(id, deployer.address);
      const yesAmt = pos.yesAmount as bigint;
      const noAmt = pos.noAmount as bigint;
      if (yesAmt > 0n || noAmt > 0n) {
        console.log(`  Market #${id}: YES=${ethers.formatUnits(yesAmt, 18)} NO=${ethers.formatUnits(noAmt, 18)}`);
        // Try claimWinnings if market is resolved
        try {
          const tx = await pm.claimWinnings(id);
          const receipt = await tx.wait();
          const eventTopic = ethers.id("WinningsClaimed(uint256,address,uint256)");
          for (const log of receipt!.logs) {
            if (log.topics[0] === eventTopic) {
              const iface = new ethers.Interface([
                "event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 reward)",
              ]);
              const decoded = iface.decodeEventLog("WinningsClaimed", log.data, log.topics);
              const reward = decoded.reward as bigint;
              totalRecovered += reward;
              console.log(`    Claimed winnings: ${ethers.formatUnits(reward, 18)} USDT`);
              break;
            }
          }
        } catch {
          // Not resolved or already claimed, try mergePositions
          const minAmt = yesAmt < noAmt ? yesAmt : noAmt;
          if (minAmt > 0n) {
            try {
              const tx = await pm.mergePositions(id, minAmt);
              await tx.wait();
              totalRecovered += minAmt;
              console.log(`    Merged ${ethers.formatUnits(minAmt, 18)} pairs back to USDT`);
            } catch {
              console.log(`    Could not merge positions`);
            }
          }
        }
      }
    } catch {
      // Market doesn't exist
    }
  }

  console.log(`\n=== TOTAL RECOVERED: ${ethers.formatUnits(totalRecovered, 18)} USDT ===`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
