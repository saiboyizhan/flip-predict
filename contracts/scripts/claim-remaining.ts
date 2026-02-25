import { ethers } from "hardhat";

const PM_ADDRESS = "0x82340f104eeabf5bD072081E28EB335fe90FdBAa";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

async function main() {
  const [deployer] = await ethers.getSigners();
  const pm = await ethers.getContractAt("PredictionMarketV3", PM_ADDRESS);
  const usdt = new ethers.Contract(USDT_ADDRESS, [
    "function balanceOf(address) view returns (uint256)",
  ], deployer);

  const contractBal = await usdt.balanceOf(PM_ADDRESS);
  console.log("Contract USDT:", ethers.formatUnits(contractBal, 18));

  // Sum tracked collateral
  let tracked = 0n;
  for (let i = 0; i < 22; i++) {
    try {
      const amm = await pm.getMarketAmm(i);
      tracked += amm[4]; // totalCollateral
    } catch {}
  }
  console.log("Tracked collateral:", ethers.formatUnits(tracked, 18));
  const orphaned = contractBal - tracked;
  console.log("Orphaned:", ethers.formatUnits(orphaned, 18));

  if (orphaned <= 0n) {
    console.log("No orphaned funds");
    return;
  }

  // Withdraw orphaned via withdrawFees
  console.log("\nWithdrawing", ethers.formatUnits(orphaned, 18), "USDT...");
  const tx = await pm.withdrawFees(orphaned);
  await tx.wait();
  console.log("Done!");

  const newBal = await usdt.balanceOf(deployer.address);
  const newContractBal = await usdt.balanceOf(PM_ADDRESS);
  console.log("\nDeployer USDT:", ethers.formatUnits(newBal, 18));
  console.log("Contract USDT:", ethers.formatUnits(newContractBal, 18));
}

main().catch(console.error);
