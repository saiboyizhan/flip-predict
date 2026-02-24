import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Testing with:", deployer.address);

  const FLIP_ADDRESS = "0x713eF4574954988df53a2A051C7aC10a6c1E8586";
  const NFA_ADDRESS = "0x0728fB29bF3cA2272d91280476f778230e202AbB";
  const MINT_PRICE = ethers.parseUnits("100000", 18);

  const flip = await ethers.getContractAt("FlipToken", FLIP_ADDRESS);
  const nfa = await ethers.getContractAt("NFA", NFA_ADDRESS);

  // 1. Check initial state
  const totalSupplyBefore = await flip.totalSupply();
  const balanceBefore = await flip.balanceOf(deployer.address);
  console.log("\n--- Before Mint ---");
  console.log("FLIP Total Supply:", ethers.formatUnits(totalSupplyBefore, 18));
  console.log("Deployer FLIP Balance:", ethers.formatUnits(balanceBefore, 18));

  // 2. Approve FLIP
  console.log("\nApproving FLIP...");
  const approveTx = await flip.approve(NFA_ADDRESS, MINT_PRICE);
  await approveTx.wait();
  console.log("Approved 100,000 FLIP to NFA");

  // 3. Mint NFA
  console.log("\nMinting NFA...");
  const metadata = {
    name: "Test Burn Agent",
    persona: "A test agent for verifying FLIP burn",
    voiceHash: ethers.ZeroHash,
    animationURI: "",
    vaultURI: "",
    vaultHash: ethers.ZeroHash,
    avatarId: 0,
  };
  const mintTx = await nfa.mint(metadata);
  const receipt = await mintTx.wait();
  console.log("Mint tx:", receipt!.hash);

  // 4. Check after state
  const totalSupplyAfter = await flip.totalSupply();
  const balanceAfter = await flip.balanceOf(deployer.address);
  const nfaFlipBalance = await flip.balanceOf(NFA_ADDRESS);
  const agentOwner = await nfa.ownerOf(0);

  console.log("\n--- After Mint ---");
  console.log("FLIP Total Supply:", ethers.formatUnits(totalSupplyAfter, 18));
  console.log("Deployer FLIP Balance:", ethers.formatUnits(balanceAfter, 18));
  console.log("NFA Contract FLIP Balance:", ethers.formatUnits(nfaFlipBalance, 18));
  console.log("Agent #0 Owner:", agentOwner);

  // 5. Verify burn
  const burned = totalSupplyBefore - totalSupplyAfter;
  console.log("\n--- Verification ---");
  console.log("FLIP Burned:", ethers.formatUnits(burned, 18));
  console.log("Burn correct:", burned === MINT_PRICE ? "YES" : "NO");
  console.log("NFA holds 0 FLIP:", nfaFlipBalance === 0n ? "YES" : "NO");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
