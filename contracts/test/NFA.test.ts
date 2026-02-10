import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { NFA } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("NFA", function () {
  let nfa: NFA;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const defaultMetadata = {
    name: "TestAgent",
    persona: "A test prediction agent",
    voiceHash: ethers.keccak256(ethers.toUtf8Bytes("voice")),
    animationURI: "https://example.com/anim.json",
    vaultURI: "ipfs://QmDefault",
    vaultHash: ethers.keccak256(ethers.toUtf8Bytes("vault-default")),
  };

  const MINT_PRICE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const NFAFactory = await ethers.getContractFactory("NFA");
    nfa = await NFAFactory.deploy();
    await nfa.waitForDeployment();
  });

  // ─── Minting ────────────────────────────────────────────────
  describe("Minting", function () {
    it("should mint with payment", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      expect(await nfa.balanceOf(user1.address)).to.equal(1);
    });

    it("should reject mint without payment", async function () {
      await expect(
        nfa.connect(user1).mint(defaultMetadata)
      ).to.be.revertedWith("Insufficient mint fee");
    });

    it("should reject mint with insufficient payment", async function () {
      await expect(
        nfa.connect(user1).mint(defaultMetadata, { value: ethers.parseEther("0.005") })
      ).to.be.revertedWith("Insufficient mint fee");
    });

    it("should allow transfer of minted tokens", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      const tokenId = 0;

      await nfa.connect(user1).transferFrom(user1.address, user2.address, tokenId);
      expect(await nfa.ownerOf(tokenId)).to.equal(user2.address);
    });

    it("should mint multiple tokens", async function () {
      for (let i = 0; i < 5; i++) {
        await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      }
      expect(await nfa.balanceOf(user1.address)).to.equal(5);
    });

    it("should store agent metadata on mint", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      const metadata = await nfa.getAgentMetadata(0);

      expect(metadata.name).to.equal(defaultMetadata.name);
      expect(metadata.persona).to.equal(defaultMetadata.persona);
      expect(metadata.voiceHash).to.equal(defaultMetadata.voiceHash);
      expect(metadata.animationURI).to.equal(defaultMetadata.animationURI);
    });

    it("should set agent state to ACTIVE on mint", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      expect(await nfa.getState(0)).to.equal(0); // ACTIVE = 0
    });
  });

  // ─── Agent State Management ─────────────────────────────────
  describe("Agent State", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should pause an active agent", async function () {
      await expect(nfa.connect(user1).pauseAgent(0))
        .to.emit(nfa, "AgentPaused")
        .withArgs(0);
      expect(await nfa.getState(0)).to.equal(1); // PAUSED = 1
    });

    it("should unpause a paused agent", async function () {
      await nfa.connect(user1).pauseAgent(0);
      await expect(nfa.connect(user1).unpauseAgent(0))
        .to.emit(nfa, "AgentUnpaused")
        .withArgs(0);
      expect(await nfa.getState(0)).to.equal(0); // ACTIVE = 0
    });

    it("should terminate an agent", async function () {
      await expect(nfa.connect(user1).terminateAgent(0))
        .to.emit(nfa, "AgentTerminated")
        .withArgs(0);
      expect(await nfa.getState(0)).to.equal(2); // TERMINATED = 2
    });

    it("should revert if non-owner tries to pause", async function () {
      await expect(
        nfa.connect(user2).pauseAgent(0)
      ).to.be.revertedWith("Not token owner");
    });

    it("should revert pause on non-active agent", async function () {
      await nfa.connect(user1).pauseAgent(0);
      await expect(
        nfa.connect(user1).pauseAgent(0)
      ).to.be.revertedWith("Agent not active");
    });

    it("should revert unpause on non-paused agent", async function () {
      await expect(
        nfa.connect(user1).unpauseAgent(0)
      ).to.be.revertedWith("Agent not paused");
    });

    it("should revert terminate on already terminated agent", async function () {
      await nfa.connect(user1).terminateAgent(0);
      await expect(
        nfa.connect(user1).terminateAgent(0)
      ).to.be.revertedWith("Already terminated");
    });
  });

  // ─── Metadata ───────────────────────────────────────────────
  describe("Metadata", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should update agent metadata", async function () {
      const newMetadata = {
        name: "UpdatedAgent",
        persona: "Updated persona",
        voiceHash: ethers.keccak256(ethers.toUtf8Bytes("newvoice")),
        animationURI: "https://example.com/new.json",
        vaultURI: "ipfs://QmUpdated",
        vaultHash: ethers.keccak256(ethers.toUtf8Bytes("vault-updated")),
      };

      await expect(nfa.connect(user1).updateAgentMetadata(0, newMetadata))
        .to.emit(nfa, "MetadataUpdated")
        .withArgs(0);

      const stored = await nfa.getAgentMetadata(0);
      expect(stored.name).to.equal(newMetadata.name);
      expect(stored.persona).to.equal(newMetadata.persona);
    });

    it("should revert if non-owner updates metadata", async function () {
      await expect(
        nfa.connect(user2).updateAgentMetadata(0, defaultMetadata)
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Prediction Profile ─────────────────────────────────────
  describe("Prediction Profile", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should update and get profile", async function () {
      const styleRoot = ethers.keccak256(ethers.toUtf8Bytes("aggressive"));

      await expect(nfa.connect(user1).updateProfile(0, styleRoot, 100, 75))
        .to.emit(nfa, "ProfileUpdated")
        .withArgs(0);

      const profile = await nfa.getProfile(0);
      expect(profile.totalPredictions).to.equal(100);
      expect(profile.correctPredictions).to.equal(75);
      expect(profile.styleRoot).to.equal(styleRoot);
      // reputationScore = (75 * 10000) / 100 = 7500
      expect(profile.reputationScore).to.equal(7500);
    });

    it("should handle zero total predictions", async function () {
      const styleRoot = ethers.keccak256(ethers.toUtf8Bytes("none"));
      await nfa.connect(user1).updateProfile(0, styleRoot, 0, 0);

      const profile = await nfa.getProfile(0);
      expect(profile.reputationScore).to.equal(0);
    });

    it("should revert if non-owner updates profile", async function () {
      const styleRoot = ethers.keccak256(ethers.toUtf8Bytes("style"));
      await expect(
        nfa.connect(user2).updateProfile(0, styleRoot, 10, 5)
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Auto Trade Authorization ───────────────────────────────
  describe("Auto Trade Authorization", function () {
    const maxPerTrade = ethers.parseEther("1");
    const maxDaily = ethers.parseEther("5");
    const duration = 86400; // 1 day

    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      // Fund the agent
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("10") });
    });

    it("should authorize auto trade", async function () {
      await expect(
        nfa.connect(user1).authorizeAutoTrade(0, maxPerTrade, maxDaily, duration)
      ).to.emit(nfa, "AutoTradeAuthorized");

      const auth = await nfa.getAutoTradeAuth(0);
      expect(auth.authorized).to.equal(true);
      expect(auth.maxAmountPerTrade).to.equal(maxPerTrade);
      expect(auth.maxDailyAmount).to.equal(maxDaily);
    });

    it("should revoke auto trade", async function () {
      await nfa.connect(user1).authorizeAutoTrade(0, maxPerTrade, maxDaily, duration);

      await expect(nfa.connect(user1).revokeAutoTrade(0))
        .to.emit(nfa, "AutoTradeRevoked")
        .withArgs(0);

      const auth = await nfa.getAutoTradeAuth(0);
      expect(auth.authorized).to.equal(false);
    });

    it("should allow owner to execute trade without authorization", async function () {
      // Owner can execute trade even without auto-trade authorization
      // We'll send to user2 with empty data
      const tradeValue = ethers.parseEther("0.5");

      await expect(
        nfa.connect(user1).executeAgentTrade(0, user2.address, "0x", tradeValue)
      ).to.emit(nfa, "AgentTradeExecuted").withArgs(0, user2.address, tradeValue);
    });

    it("should reject unauthorized third-party trade", async function () {
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user2.address, "0x", ethers.parseEther("0.1"))
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject trade exceeding per-trade limit", async function () {
      await nfa.connect(user1).authorizeAutoTrade(0, maxPerTrade, maxDaily, duration);

      // user2 tries trade above maxPerTrade
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user2.address, "0x", ethers.parseEther("2"))
      ).to.be.revertedWith("Exceeds per-trade limit");
    });

    it("should reject trade exceeding daily limit", async function () {
      const smallPerTrade = ethers.parseEther("3");
      const smallDaily = ethers.parseEther("2");
      await nfa.connect(user1).authorizeAutoTrade(0, smallPerTrade, smallDaily, duration);

      // First trade uses up daily limit
      await nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1.5"));

      // Second trade exceeds daily limit
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"))
      ).to.be.revertedWith("Exceeds daily limit");
    });

    it("should reject trade after authorization expires", async function () {
      await nfa.connect(user1).authorizeAutoTrade(0, maxPerTrade, maxDaily, duration);

      // Fast forward past expiration
      await time.increase(duration + 1);

      await expect(
        nfa.connect(user2).executeAgentTrade(0, user2.address, "0x", ethers.parseEther("0.1"))
      ).to.be.revertedWith("Authorization expired");
    });

    it("should revert if non-owner authorizes", async function () {
      await expect(
        nfa.connect(user2).authorizeAutoTrade(0, maxPerTrade, maxDaily, duration)
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Learning Module ────────────────────────────────────────
  describe("Learning Module", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should update learning root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("learning-data-v1"));

      await expect(nfa.connect(user1).updateLearning(0, newRoot, "0x"))
        .to.emit(nfa, "LearningUpdated")
        .withArgs(0, newRoot);

      const metrics = await nfa.getLearningMetrics(0);
      expect(metrics.learningRoot).to.equal(newRoot);
    });

    it("should record interactions", async function () {
      await nfa.connect(user1).recordInteraction(0, true);
      await nfa.connect(user1).recordInteraction(0, true);
      await nfa.connect(user1).recordInteraction(0, false);

      const metrics = await nfa.getLearningMetrics(0);
      expect(metrics.totalInteractions).to.equal(3);
      expect(metrics.successfulOutcomes).to.equal(2);
    });

    it("should emit InteractionRecorded event", async function () {
      await expect(nfa.connect(user1).recordInteraction(0, true))
        .to.emit(nfa, "InteractionRecorded")
        .withArgs(0, 1);
    });

    it("should verify learning with Merkle proof", async function () {
      // Build a simple Merkle tree: leaf = claim, root = keccak(claim)
      // For a single-element tree, the root IS the leaf hash, and proof is empty
      const claim = ethers.keccak256(ethers.toUtf8Bytes("learned-pattern-1"));

      // Set the learning root to the claim itself (single-leaf tree)
      await nfa.connect(user1).updateLearning(0, claim, "0x");

      // Verify with empty proof: MerkleProof.verify([], root, leaf) returns root == leaf
      const verified = await nfa.verifyLearning(0, claim, []);
      expect(verified).to.equal(true);
    });

    it("should return false for invalid proof", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await nfa.connect(user1).updateLearning(0, root, "0x");

      const fakeClaim = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const verified = await nfa.verifyLearning(0, fakeClaim, []);
      expect(verified).to.equal(false);
    });

    it("should return false when no learning root set", async function () {
      const claim = ethers.keccak256(ethers.toUtf8Bytes("anything"));
      const verified = await nfa.verifyLearning(0, claim, []);
      expect(verified).to.equal(false);
    });

    it("should revert if non-owner updates learning", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("data"));
      await expect(
        nfa.connect(user2).updateLearning(0, root, "0x")
      ).to.be.revertedWith("Not token owner");
    });

    it("should revert if non-owner records interaction", async function () {
      await expect(
        nfa.connect(user2).recordInteraction(0, true)
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Fund / Withdraw ────────────────────────────────────────
  describe("Agent Funding", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should fund an agent", async function () {
      const fundAmount = ethers.parseEther("1");

      await expect(nfa.connect(user2).fundAgent(0, { value: fundAmount }))
        .to.emit(nfa, "AgentFunded")
        .withArgs(0, fundAmount);

      expect(await nfa.getAgentBalance(0)).to.equal(fundAmount);
    });

    it("should revert funding with zero value", async function () {
      await expect(
        nfa.connect(user1).fundAgent(0, { value: 0 })
      ).to.be.revertedWith("Must send BNB");
    });

    it("should withdraw from agent", async function () {
      const fundAmount = ethers.parseEther("2");
      const withdrawAmount = ethers.parseEther("1");

      await nfa.connect(user1).fundAgent(0, { value: fundAmount });

      await expect(nfa.connect(user1).withdrawFromAgent(0, withdrawAmount))
        .to.emit(nfa, "AgentWithdrawn")
        .withArgs(0, withdrawAmount);

      expect(await nfa.getAgentBalance(0)).to.equal(fundAmount - withdrawAmount);
    });

    it("should revert withdraw exceeding balance", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });

      await expect(
        nfa.connect(user1).withdrawFromAgent(0, ethers.parseEther("2"))
      ).to.be.revertedWith("Insufficient agent balance");
    });

    it("should revert if non-owner withdraws", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });

      await expect(
        nfa.connect(user2).withdrawFromAgent(0, ethers.parseEther("0.5"))
      ).to.be.revertedWith("Not token owner");
    });

    it("should revert funding a non-active agent", async function () {
      await nfa.connect(user1).terminateAgent(0);

      await expect(
        nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Agent not active");
    });
  });

  // ─── Admin ──────────────────────────────────────────────────
  describe("Admin", function () {
    it("should set prediction market address", async function () {
      await nfa.connect(owner).setPredictionMarket(user1.address);
      expect(await nfa.predictionMarket()).to.equal(user1.address);
    });

    it("should revert if non-owner sets prediction market", async function () {
      await expect(
        nfa.connect(user1).setPredictionMarket(user1.address)
      ).to.be.revertedWithCustomError(nfa, "OwnableUnauthorizedAccount");
    });

    it("should pause and unpause contract", async function () {
      await nfa.connect(owner).pause();

      await expect(
        nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE })
      ).to.be.revertedWithCustomError(nfa, "EnforcedPause");

      await nfa.connect(owner).unpause();
      await expect(nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE })).to.not.be.reverted;
    });
  });

  // ─── Logic Address ──────────────────────────────────────────
  describe("Logic Address", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should set logic address", async function () {
      await expect(nfa.connect(user1).setLogicAddress(0, user2.address))
        .to.emit(nfa, "LogicAddressUpdated")
        .withArgs(0, user2.address);
    });

    it("should revert if non-owner sets logic address", async function () {
      await expect(
        nfa.connect(user2).setLogicAddress(0, user2.address)
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Vault ─────────────────────────────────────────────────
  describe("Vault", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should update vault URI and hash", async function () {
      const newURI = "ipfs://QmNewVault";
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("new-vault-content"));

      await nfa.connect(user1).updateVault(0, newURI, newHash);

      const metadata = await nfa.getAgentMetadata(0);
      expect(metadata.vaultURI).to.equal(newURI);
      expect(metadata.vaultHash).to.equal(newHash);
    });

    it("should emit VaultUpdated event", async function () {
      const newURI = "ipfs://QmNewVault";
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("new-vault-content"));

      await expect(nfa.connect(user1).updateVault(0, newURI, newHash))
        .to.emit(nfa, "VaultUpdated")
        .withArgs(0, newURI, newHash);
    });

    it("should revert if non-owner updates vault", async function () {
      const newURI = "ipfs://QmNewVault";
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("new-vault-content"));

      await expect(
        nfa.connect(user2).updateVault(0, newURI, newHash)
      ).to.be.revertedWith("Not token owner");
    });

    it("should store vault data in metadata on mint", async function () {
      const metadata = await nfa.getAgentMetadata(0);
      expect(metadata.vaultURI).to.equal(defaultMetadata.vaultURI);
      expect(metadata.vaultHash).to.equal(defaultMetadata.vaultHash);
    });
  });

  // ─── Memory Module ────────────────────────────────────────
  describe("Memory Module", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should register a memory module", async function () {
      const moduleMetadata = "sentiment-analysis-v1";

      await expect(
        nfa.connect(user1).registerModule(0, user2.address, moduleMetadata)
      ).to.emit(nfa, "ModuleRegistered").withArgs(0, user2.address);

      const mod = await nfa.getModule(0, user2.address);
      expect(mod.moduleAddress).to.equal(user2.address);
      expect(mod.metadata).to.equal(moduleMetadata);
      expect(mod.isActive).to.equal(true);
    });

    it("should verify module with correct hash", async function () {
      const moduleMetadata = "sentiment-analysis-v1";
      await nfa.connect(user1).registerModule(0, user2.address, moduleMetadata);

      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(moduleMetadata));
      expect(await nfa.verifyModule(0, user2.address, expectedHash)).to.equal(true);
    });

    it("should return false for incorrect hash", async function () {
      const moduleMetadata = "sentiment-analysis-v1";
      await nfa.connect(user1).registerModule(0, user2.address, moduleMetadata);

      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong-metadata"));
      expect(await nfa.verifyModule(0, user2.address, wrongHash)).to.equal(false);
    });

    it("should deactivate a module", async function () {
      await nfa.connect(user1).registerModule(0, user2.address, "mod");

      await expect(
        nfa.connect(user1).deactivateModule(0, user2.address)
      ).to.emit(nfa, "ModuleDeactivated").withArgs(0, user2.address);

      const mod = await nfa.getModule(0, user2.address);
      expect(mod.isActive).to.equal(false);
    });

    it("should revert if non-owner registers module", async function () {
      await expect(
        nfa.connect(user2).registerModule(0, user3.address, "mod")
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Token URI ──────────────────────────────────────────────
  describe("Token URI", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should return default tokenURI with empty base URI", async function () {
      const uri = await nfa.tokenURI(0);
      expect(uri).to.equal("0.json");
    });

    it("should return correct tokenURI after setBaseURI", async function () {
      await nfa.connect(owner).setBaseURI("https://api.example.com/metadata/");
      const uri = await nfa.tokenURI(0);
      expect(uri).to.equal("https://api.example.com/metadata/0.json");
    });

    it("should return correct tokenURI for different token IDs", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await nfa.connect(owner).setBaseURI("ipfs://QmBase/");

      expect(await nfa.tokenURI(0)).to.equal("ipfs://QmBase/0.json");
      expect(await nfa.tokenURI(1)).to.equal("ipfs://QmBase/1.json");
    });

    it("should revert for non-existent token", async function () {
      await expect(nfa.tokenURI(999)).to.be.revertedWithCustomError(
        nfa,
        "ERC721NonexistentToken"
      );
    });

    it("should only allow owner to set base URI", async function () {
      await expect(
        nfa.connect(user1).setBaseURI("https://example.com/")
      ).to.be.revertedWithCustomError(nfa, "OwnableUnauthorizedAccount");
    });

    it("should allow updating base URI multiple times", async function () {
      await nfa.connect(owner).setBaseURI("https://v1.example.com/");
      expect(await nfa.tokenURI(0)).to.equal("https://v1.example.com/0.json");

      await nfa.connect(owner).setBaseURI("https://v2.example.com/");
      expect(await nfa.tokenURI(0)).to.equal("https://v2.example.com/0.json");
    });
  });

  // ─── Vault Permission ─────────────────────────────────────
  describe("Vault Permission", function () {
    beforeEach(async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
    });

    it("should delegate read access", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 86400;

      await expect(
        nfa.connect(user1).delegateAccess(0, user2.address, 0, expiryTime) // 0 = READ_ONLY
      ).to.emit(nfa, "AccessDelegated").withArgs(0, user2.address, 0, expiryTime);

      const perm = await nfa.getPermission(0, user2.address);
      expect(perm.delegate).to.equal(user2.address);
      expect(perm.level).to.equal(0);
      expect(perm.isActive).to.equal(true);
    });

    it("should verify access level", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 86400;

      // Delegate WRITE access (level 1)
      await nfa.connect(user1).delegateAccess(0, user2.address, 1, expiryTime);

      // Verify READ_ONLY (0) should pass since WRITE >= READ_ONLY
      expect(await nfa.verifyAccess(0, user2.address, 0)).to.equal(true);
      // Verify WRITE (1) should pass
      expect(await nfa.verifyAccess(0, user2.address, 1)).to.equal(true);
    });

    it("should reject insufficient access level", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 86400;

      // Delegate READ_ONLY access (level 0)
      await nfa.connect(user1).delegateAccess(0, user2.address, 0, expiryTime);

      // Verify WRITE (1) should fail since READ_ONLY < WRITE
      expect(await nfa.verifyAccess(0, user2.address, 1)).to.equal(false);
    });

    it("should revoke access", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 86400;
      await nfa.connect(user1).delegateAccess(0, user2.address, 1, expiryTime);

      await expect(
        nfa.connect(user1).revokeAccess(0, user2.address)
      ).to.emit(nfa, "AccessRevoked").withArgs(0, user2.address);

      expect(await nfa.verifyAccess(0, user2.address, 0)).to.equal(false);
    });

    it("should reject expired access", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 10; // short expiry
      await nfa.connect(user1).delegateAccess(0, user2.address, 3, expiryTime); // FULL_CONTROL

      // Fast forward past expiration
      await time.increase(20);

      expect(await nfa.verifyAccess(0, user2.address, 0)).to.equal(false);
    });

    it("should revert if non-owner delegates", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 86400;
      await expect(
        nfa.connect(user2).delegateAccess(0, user3.address, 0, expiryTime)
      ).to.be.revertedWith("Not token owner");
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────
  describe("Edge Cases", function () {
    it("should handle mint price exactly at MINT_PRICE", async function () {
      await expect(
        nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE })
      ).to.not.be.reverted;
    });

    it("should accept overpayment for mint", async function () {
      const overpay = ethers.parseEther("1");
      await expect(
        nfa.connect(user1).mint(defaultMetadata, { value: overpay })
      ).to.not.be.reverted;
      expect(await nfa.balanceOf(user1.address)).to.equal(1);
    });

    it("should not allow executeAction without logic address set", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await expect(
        nfa.connect(user1).executeAction(0, "0x1234")
      ).to.be.revertedWith("No logic address set");
    });

    it("should not allow operations on terminated agent that require active state", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await nfa.connect(user1).terminateAgent(0);

      // Fund should fail (requires active)
      await expect(
        nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Agent not active");
    });

    it("should allow withdraw from terminated agent", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });
      await nfa.connect(user1).terminateAgent(0);

      // Withdraw should still work (no active check on withdraw)
      await expect(
        nfa.connect(user1).withdrawFromAgent(0, ethers.parseEther("1"))
      ).to.not.be.reverted;
    });

    it("should track token ownership correctly via ERC721Enumerable", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await nfa.connect(user2).mint(defaultMetadata, { value: MINT_PRICE });

      expect(await nfa.totalSupply()).to.equal(2);
      expect(await nfa.tokenOfOwnerByIndex(user1.address, 0)).to.equal(0);
      expect(await nfa.tokenOfOwnerByIndex(user2.address, 0)).to.equal(1);
    });

    it("should receive BNB via receive()", async function () {
      const sendAmount = ethers.parseEther("1");
      await user1.sendTransaction({
        to: await nfa.getAddress(),
        value: sendAmount,
      });
      const contractBalance = await ethers.provider.getBalance(await nfa.getAddress());
      // Contract balance includes mint fees and this transfer
      expect(contractBalance).to.be.gte(sendAmount);
    });

    it("should revert getState for non-existent token", async function () {
      await expect(nfa.getState(999)).to.be.revertedWithCustomError(
        nfa,
        "ERC721NonexistentToken"
      );
    });

    it("should revert getAgentMetadata for non-existent token", async function () {
      await expect(nfa.getAgentMetadata(999)).to.be.revertedWithCustomError(
        nfa,
        "ERC721NonexistentToken"
      );
    });

    it("should revert getProfile for non-existent token", async function () {
      await expect(nfa.getProfile(999)).to.be.revertedWithCustomError(
        nfa,
        "ERC721NonexistentToken"
      );
    });

    it("should revert getAgentBalance for non-existent token", async function () {
      await expect(nfa.getAgentBalance(999)).to.be.revertedWithCustomError(
        nfa,
        "ERC721NonexistentToken"
      );
    });

    it("should allow new owner to manage agent after transfer", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await nfa.connect(user1).transferFrom(user1.address, user2.address, 0);

      // New owner (user2) should be able to pause
      await expect(nfa.connect(user2).pauseAgent(0)).to.not.be.reverted;

      // Old owner (user1) should fail
      await expect(
        nfa.connect(user1).unpauseAgent(0)
      ).to.be.revertedWith("Not token owner");
    });

    it("should reset daily auto trade counter on new day", async function () {
      await nfa.connect(user1).mint(defaultMetadata, { value: MINT_PRICE });
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("10") });

      const maxPerTrade = ethers.parseEther("1");
      const maxDaily = ethers.parseEther("2");
      const duration = 7 * 86400; // 7 days
      await nfa.connect(user1).authorizeAutoTrade(0, maxPerTrade, maxDaily, duration);

      // Use up daily limit
      await nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"));
      await nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"));

      // Should fail - daily limit reached
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"))
      ).to.be.revertedWith("Exceeds daily limit");

      // Advance to next day
      await time.increase(86400);

      // Should succeed - new day
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"))
      ).to.not.be.reverted;
    });
  });

});
