import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying FlipToken with:", deployer.address);

  const FlipToken = await ethers.getContractFactory("FlipToken");
  const token = await FlipToken.deploy();
  await token.waitForDeployment();

  const address = await token.getAddress();
  const totalSupply = await token.totalSupply();

  console.log("FlipToken deployed to:", address);
  console.log("Total supply:", ethers.formatUnits(totalSupply, 18), "FLIP");
  console.log("\nVerify:");
  console.log(`npx hardhat verify --network bscTestnet ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
