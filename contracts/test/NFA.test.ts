import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { NFA, PredictionMarket } from "../typechain-types";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

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
    avatarId: 1,
  };

  async function mintAgent(user: SignerWithAddress) {
    await nfa.connect(user).mint(defaultMetadata);
  }

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const NFAFactory = await ethers.getContractFactory("NFA");
    nfa = await NFAFactory.deploy();
    await nfa.waitForDeployment();
  });

  describe("Minting", function () {
    it("mints for free and stores metadata", async function () {
      await mintAgent(user1);

      expect(await nfa.balanceOf(user1.address)).to.equal(1);
      expect(await nfa.getMintCount(user1.address)).to.equal(1);

      const metadata = await nfa.getAgentMetadata(0);
      expect(metadata.name).to.equal(defaultMetadata.name);
      expect(metadata.persona).to.equal(defaultMetadata.persona);
      expect(metadata.avatarId).to.equal(defaultMetadata.avatarId);
      expect(await nfa.getState(0)).to.equal(0); // ACTIVE
    });

    it("enforces MAX_AGENTS_PER_ADDRESS = 3", async function () {
      await mintAgent(user1);
      await mintAgent(user1);
      await mintAgent(user1);

      await expect(nfa.connect(user1).mint(defaultMetadata)).to.be.revertedWith("Max agents per address reached");
    });

    it("allows transfer and new owner can manage agent", async function () {
      await mintAgent(user1);
      await nfa.connect(user1).transferFrom(user1.address, user2.address, 0);

      expect(await nfa.ownerOf(0)).to.equal(user2.address);
      await expect(nfa.connect(user2).pauseAgent(0)).to.not.be.reverted;
      await expect(nfa.connect(user1).unpauseAgent(0)).to.be.revertedWith("Not token owner");
    });

    it("blocks mint when paused", async function () {
      await nfa.connect(owner).pause();
      await expect(nfa.connect(user1).mint(defaultMetadata)).to.be.revertedWithCustomError(nfa, "EnforcedPause");

      await nfa.connect(owner).unpause();
      await expect(nfa.connect(user1).mint(defaultMetadata)).to.not.be.reverted;
    });

    it("tracks supply and owner tokens via ERC721Enumerable", async function () {
      await mintAgent(user1);
      await mintAgent(user2);

      expect(await nfa.totalSupply()).to.equal(2);
      expect(await nfa.tokenOfOwnerByIndex(user1.address, 0)).to.equal(0);
      expect(await nfa.tokenOfOwnerByIndex(user2.address, 0)).to.equal(1);
    });
  });

  describe("Agent State", function () {
    beforeEach(async function () {
      await mintAgent(user1);
    });

    it("pauses and unpauses by token owner", async function () {
      await expect(nfa.connect(user1).pauseAgent(0)).to.emit(nfa, "AgentPaused").withArgs(0);
      expect(await nfa.getState(0)).to.equal(1); // PAUSED

      await expect(nfa.connect(user1).unpauseAgent(0)).to.emit(nfa, "AgentUnpaused").withArgs(0);
      expect(await nfa.getState(0)).to.equal(0); // ACTIVE
    });

    it("terminates agent irreversibly", async function () {
      await expect(nfa.connect(user1).terminateAgent(0)).to.emit(nfa, "AgentTerminated").withArgs(0);
      expect(await nfa.getState(0)).to.equal(2); // TERMINATED

      await expect(nfa.connect(user1).terminateAgent(0)).to.be.revertedWith("Already terminated");
    });

    it("rejects non-owner state changes", async function () {
      await expect(nfa.connect(user2).pauseAgent(0)).to.be.revertedWith("Not token owner");
      await expect(nfa.connect(user2).unpauseAgent(0)).to.be.revertedWith("Not token owner");
      await expect(nfa.connect(user2).terminateAgent(0)).to.be.revertedWith("Not token owner");
    });

    it("rejects invalid transitions", async function () {
      await expect(nfa.connect(user1).unpauseAgent(0)).to.be.revertedWith("Agent not paused");

      await nfa.connect(user1).pauseAgent(0);
      await expect(nfa.connect(user1).pauseAgent(0)).to.be.revertedWith("Agent not active");
    });
  });

  describe("Metadata and Profile", function () {
    beforeEach(async function () {
      await mintAgent(user1);
    });

    it("updates metadata by owner", async function () {
      const newMetadata = {
        name: "UpdatedAgent",
        persona: "Updated persona",
        voiceHash: ethers.keccak256(ethers.toUtf8Bytes("newvoice")),
        animationURI: "https://example.com/new.json",
        vaultURI: "ipfs://QmUpdated",
        vaultHash: ethers.keccak256(ethers.toUtf8Bytes("vault-updated")),
        avatarId: 7,
      };

      await expect(nfa.connect(user1).updateAgentMetadata(0, newMetadata))
        .to.emit(nfa, "MetadataUpdated")
        .withArgs(0);

      const stored = await nfa.getAgentMetadata(0);
      expect(stored.name).to.equal(newMetadata.name);
      expect(stored.avatarId).to.equal(newMetadata.avatarId);
    });

    it("rejects non-owner metadata update", async function () {
      await expect(nfa.connect(user2).updateAgentMetadata(0, defaultMetadata)).to.be.revertedWith("Not token owner");
    });

    it("updates and reads prediction profile", async function () {
      const styleRoot = ethers.keccak256(ethers.toUtf8Bytes("aggressive"));
      await expect(nfa.connect(user1).updateProfile(0, styleRoot, 100, 75))
        .to.emit(nfa, "ProfileUpdated")
        .withArgs(0);

      const profile = await nfa.getProfile(0);
      expect(profile.totalPredictions).to.equal(100);
      expect(profile.correctPredictions).to.equal(75);
      expect(profile.styleRoot).to.equal(styleRoot);
      expect(profile.reputationScore).to.equal(7500); // (75 * 10000) / 100
    });

    it("handles zero total predictions", async function () {
      const styleRoot = ethers.keccak256(ethers.toUtf8Bytes("none"));
      await nfa.connect(user1).updateProfile(0, styleRoot, 0, 0);

      const profile = await nfa.getProfile(0);
      expect(profile.reputationScore).to.equal(0);
    });

    it("rejects non-owner profile update", async function () {
      const styleRoot = ethers.keccak256(ethers.toUtf8Bytes("style"));
      await expect(nfa.connect(user2).updateProfile(0, styleRoot, 10, 5)).to.be.revertedWith("Not token owner");
    });
  });

  describe("Learning Module", function () {
    beforeEach(async function () {
      await mintAgent(user1);
    });

    it("updates learning root and records interactions", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("learning-root"));
      await expect(nfa.connect(user1).updateLearning(0, root, "0x"))
        .to.emit(nfa, "LearningUpdated")
        .withArgs(0, root);

      await expect(nfa.connect(user1).recordInteraction(0, true))
        .to.emit(nfa, "InteractionRecorded")
        .withArgs(0, 1);
      await nfa.connect(user1).recordInteraction(0, false);

      const metrics = await nfa.getLearningMetrics(0);
      expect(metrics.totalInteractions).to.equal(2);
      expect(metrics.successfulOutcomes).to.equal(1);
      expect(metrics.learningRoot).to.equal(root);
    });

    it("verifies valid learning claim and rejects invalid claim", async function () {
      const claim = ethers.keccak256(ethers.toUtf8Bytes("claim-1"));
      await nfa.connect(user1).updateLearning(0, claim, "0x");

      expect(await nfa.verifyLearning(0, claim, [])).to.equal(true);

      const fakeClaim = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      expect(await nfa.verifyLearning(0, fakeClaim, [])).to.equal(false);
    });

    it("returns false when root is unset", async function () {
      const claim = ethers.keccak256(ethers.toUtf8Bytes("anything"));
      expect(await nfa.verifyLearning(0, claim, [])).to.equal(false);
    });

    it("rejects non-owner learning updates", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("data"));
      await expect(nfa.connect(user2).updateLearning(0, root, "0x")).to.be.revertedWith("Not token owner");
      await expect(nfa.connect(user2).recordInteraction(0, true)).to.be.revertedWith("Not token owner");
    });
  });

  describe("Funding and Trading", function () {
    beforeEach(async function () {
      await mintAgent(user1);
    });

    it("funds and withdraws agent balance and totalAgentBalances", async function () {
      const amount = ethers.parseEther("3");
      await expect(nfa.connect(user2).fundAgent(0, { value: amount }))
        .to.emit(nfa, "AgentFunded")
        .withArgs(0, amount);

      expect(await nfa.getAgentBalance(0)).to.equal(amount);
      expect(await nfa.totalAgentBalances()).to.equal(amount);

      const withdrawAmount = ethers.parseEther("1");
      await expect(nfa.connect(user1).withdrawFromAgent(0, withdrawAmount))
        .to.emit(nfa, "AgentWithdrawn")
        .withArgs(0, withdrawAmount);

      expect(await nfa.getAgentBalance(0)).to.equal(amount - withdrawAmount);
      expect(await nfa.totalAgentBalances()).to.equal(amount - withdrawAmount);
    });

    it("enforces funding and withdrawal guards", async function () {
      await expect(nfa.connect(user1).fundAgent(0, { value: 0 })).to.be.revertedWith("Must send BNB");
      await expect(nfa.connect(user1).withdrawFromAgent(0, 0)).to.be.revertedWith("Amount must be > 0");
      await expect(nfa.connect(user2).withdrawFromAgent(0, 1)).to.be.revertedWith("Not token owner");

      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });
      await expect(nfa.connect(user1).withdrawFromAgent(0, ethers.parseEther("2"))).to.be.revertedWith("Insufficient agent balance");
    });

    it("allows withdraw from terminated agent", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });
      await nfa.connect(user1).terminateAgent(0);

      await expect(nfa.connect(user1).withdrawFromAgent(0, ethers.parseEther("1"))).to.not.be.reverted;
      await expect(nfa.connect(user1).fundAgent(0, { value: 1 })).to.be.revertedWith("Agent not active");
    });

    it("requires logic address for executeAction", async function () {
      await expect(nfa.connect(user1).executeAction(0, "0x1234")).to.be.revertedWith("No logic address set");

      await nfa.connect(user1).setLogicAddress(0, user2.address);
      await expect(nfa.connect(user1).executeAction(0, "0x"))
        .to.emit(nfa, "ActionExecuted")
        .withArgs(0, "0x");
    });

    it("blocks invalid executeAgentTrade targets", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("2") });

      await expect(
        nfa.connect(user1).executeAgentTrade(0, ethers.ZeroAddress, "0x", 1)
      ).to.be.revertedWith("Invalid target address");

      const nfaAddress = await nfa.getAddress();
      await expect(
        nfa.connect(user1).executeAgentTrade(0, nfaAddress, "0x", 1)
      ).to.be.revertedWith("Cannot call self");

      await nfa.connect(owner).setPredictionMarket(user2.address);
      await expect(
        nfa.connect(user1).executeAgentTrade(0, user2.address, "0x", 1)
      ).to.be.revertedWith("Cannot call prediction market directly");
    });

    it("allows owner trade and updates balances", async function () {
      const initial = ethers.parseEther("5");
      const tradeValue = ethers.parseEther("2");
      await nfa.connect(user1).fundAgent(0, { value: initial });

      await expect(
        nfa.connect(user1).executeAgentTrade(0, user2.address, "0x", tradeValue)
      ).to.emit(nfa, "AgentTradeExecuted").withArgs(0, user2.address, tradeValue);

      expect(await nfa.getAgentBalance(0)).to.equal(initial - tradeValue);
      expect(await nfa.totalAgentBalances()).to.equal(initial - tradeValue);
    });

    it("rejects unauthorized third-party trade", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });

      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("0.1"))
      ).to.be.revertedWith("Not authorized");
    });

    it("supports authorized auto-trade with per-trade/daily/expiry guards", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("5") });

      const maxPerTrade = ethers.parseEther("1");
      const maxDaily = ethers.parseEther("2");
      const duration = 7 * 86400;

      await expect(
        nfa.connect(user1).authorizeAutoTrade(0, user2.address, maxPerTrade, maxDaily, duration)
      ).to.emit(nfa, "AutoTradeAuthorized");

      const auth = await nfa.getAutoTradeAuth(0);
      expect(auth.authorized).to.equal(true);
      expect(auth.authorizedCaller).to.equal(user2.address);

      // valid trade
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"))
      ).to.emit(nfa, "AgentTradeExecuted");

      // exceeds per-trade limit
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1.1"))
      ).to.be.revertedWith("Exceeds per-trade limit");

      // reaches daily limit
      await nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("1"));
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("0.1"))
      ).to.be.revertedWith("Exceeds daily limit");

      // reset next day
      await time.increase(86401);
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("0.5"))
      ).to.not.be.reverted;

      // expire auth
      await time.increase(duration + 1);
      await expect(
        nfa.connect(user2).executeAgentTrade(0, user3.address, "0x", ethers.parseEther("0.1"))
      ).to.be.revertedWith("Authorization expired");
    });

    it("validates auto-trade params", async function () {
      await expect(
        nfa.connect(user1).authorizeAutoTrade(0, ethers.ZeroAddress, ethers.parseEther("1"), ethers.parseEther("2"), 86400)
      ).to.be.revertedWith("Invalid caller address");

      await expect(
        nfa.connect(user1).authorizeAutoTrade(0, user2.address, 0, ethers.parseEther("2"), 86400)
      ).to.be.revertedWith("Max per trade must be > 0");

      await expect(
        nfa.connect(user1).authorizeAutoTrade(0, user2.address, ethers.parseEther("2"), ethers.parseEther("1"), 86400)
      ).to.be.revertedWith("Max daily must be >= max per trade");

      await expect(
        nfa.connect(user1).authorizeAutoTrade(0, user2.address, ethers.parseEther("1"), ethers.parseEther("2"), 0)
      ).to.be.revertedWith("Duration must be > 0");
    });

    it("rejects executeAgentTrade on paused/terminated agent", async function () {
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });

      await nfa.connect(user1).pauseAgent(0);
      await expect(
        nfa.connect(user1).executeAgentTrade(0, user2.address, "0x", 1)
      ).to.be.revertedWith("Agent not active");

      await nfa.connect(user1).unpauseAgent(0);
      await nfa.connect(user1).terminateAgent(0);
      await expect(
        nfa.connect(user1).executeAgentTrade(0, user2.address, "0x", 1)
      ).to.be.revertedWith("Agent not active");
    });
  });

  describe("Vault and Modules", function () {
    beforeEach(async function () {
      await mintAgent(user1);
    });

    it("updates vault and emits event", async function () {
      const newURI = "ipfs://QmNewVault";
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("new-vault-content"));

      await expect(nfa.connect(user1).updateVault(0, newURI, newHash))
        .to.emit(nfa, "VaultUpdated")
        .withArgs(0, newURI, newHash);

      const metadata = await nfa.getAgentMetadata(0);
      expect(metadata.vaultURI).to.equal(newURI);
      expect(metadata.vaultHash).to.equal(newHash);
    });

    it("registers, verifies, and deactivates memory module", async function () {
      const moduleMetadata = "sentiment-analysis-v1";
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(moduleMetadata));

      await expect(
        nfa.connect(user1).registerModule(0, user2.address, moduleMetadata)
      ).to.emit(nfa, "ModuleRegistered").withArgs(0, user2.address);

      expect(await nfa.verifyModule(0, user2.address, expectedHash)).to.equal(true);
      expect(await nfa.verifyModule(0, user2.address, ethers.keccak256(ethers.toUtf8Bytes("wrong")))).to.equal(false);

      await expect(
        nfa.connect(user1).deactivateModule(0, user2.address)
      ).to.emit(nfa, "ModuleDeactivated").withArgs(0, user2.address);

      const mod = await nfa.getModule(0, user2.address);
      expect(mod.isActive).to.equal(false);
    });

    it("rejects non-owner module operations", async function () {
      await expect(nfa.connect(user2).registerModule(0, user3.address, "mod")).to.be.revertedWith("Not token owner");
      await expect(nfa.connect(user2).deactivateModule(0, user3.address)).to.be.revertedWith("Not token owner");
    });

    it("delegates/revokes vault access with level and expiry checks", async function () {
      const latest = await time.latest();
      const expiryTime = latest + 86400;

      await expect(
        nfa.connect(user1).delegateAccess(0, user2.address, 1, expiryTime)
      ).to.emit(nfa, "AccessDelegated").withArgs(0, user2.address, 1, expiryTime);

      expect(await nfa.verifyAccess(0, user2.address, 0)).to.equal(true); // WRITE >= READ
      expect(await nfa.verifyAccess(0, user2.address, 1)).to.equal(true);
      expect(await nfa.verifyAccess(0, user2.address, 2)).to.equal(false);

      await expect(nfa.connect(user1).revokeAccess(0, user2.address))
        .to.emit(nfa, "AccessRevoked")
        .withArgs(0, user2.address);
      expect(await nfa.verifyAccess(0, user2.address, 0)).to.equal(false);

      // expired permission
      await nfa.connect(user1).delegateAccess(0, user2.address, 3, (await time.latest()) + 10);
      await time.increase(20);
      expect(await nfa.verifyAccess(0, user2.address, 0)).to.equal(false);
    });

    it("rejects non-owner permission delegation", async function () {
      const expiry = (await time.latest()) + 100;
      await expect(nfa.connect(user2).delegateAccess(0, user3.address, 0, expiry)).to.be.revertedWith("Not token owner");
      await expect(nfa.connect(user2).revokeAccess(0, user3.address)).to.be.revertedWith("Not token owner");
    });
  });

  describe("Admin and Integration", function () {
    it("sets prediction market with owner-only + zero-address guard", async function () {
      await expect(nfa.connect(user1).setPredictionMarket(user2.address)).to.be.revertedWithCustomError(
        nfa,
        "OwnableUnauthorizedAccount",
      );
      await expect(nfa.connect(owner).setPredictionMarket(ethers.ZeroAddress)).to.be.revertedWith("Invalid address");

      await nfa.connect(owner).setPredictionMarket(user2.address);
      expect(await nfa.predictionMarket()).to.equal(user2.address);
    });

    it("withdrawSurplus enforces available surplus", async function () {
      const nfaAddress = await nfa.getAddress();

      // send pure surplus (not agent balance)
      await user1.sendTransaction({ to: nfaAddress, value: ethers.parseEther("1") });

      const before = await ethers.provider.getBalance(nfaAddress);
      await expect(nfa.connect(owner).withdrawSurplus(ethers.parseEther("0.4"))).to.not.be.reverted;
      const after = await ethers.provider.getBalance(nfaAddress);
      expect(after).to.equal(before - ethers.parseEther("0.4"));

      await expect(nfa.connect(owner).withdrawSurplus(0)).to.be.revertedWith("Amount must be > 0");
      await expect(nfa.connect(owner).withdrawSurplus(ethers.parseEther("1"))).to.be.revertedWith("Exceeds available surplus");
    });

    it("withdrawFromPredictionMarket flow works", async function () {
      // Mint and fund agent
      await mintAgent(user1);
      await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("1") });

      // Deploy prediction market
      const PMFactory = await ethers.getContractFactory("PredictionMarket");
      const pm = (await PMFactory.deploy()) as PredictionMarket;
      await pm.waitForDeployment();
      const pmAddress = await pm.getAddress();

      // Before setting predictionMarket on NFA, use executeAgentTrade to call pm.deposit()
      const depositData = pm.interface.encodeFunctionData("deposit");
      await nfa.connect(user1).executeAgentTrade(0, pmAddress, depositData, ethers.parseEther("1"));

      const nfaAddress = await nfa.getAddress();
      expect(await pm.balances(nfaAddress)).to.equal(ethers.parseEther("1"));

      // Set PM address and withdraw from PM back to NFA
      await nfa.connect(owner).setPredictionMarket(pmAddress);
      await expect(nfa.connect(owner).withdrawFromPredictionMarket(ethers.parseEther("1"))).to.not.be.reverted;
      expect(await pm.balances(nfaAddress)).to.equal(0);
    });

    it("withdrawFromPredictionMarket guards", async function () {
      await expect(nfa.connect(owner).withdrawFromPredictionMarket(1)).to.be.revertedWith("Prediction market not set");

      await nfa.connect(owner).setPredictionMarket(user2.address);
      await expect(nfa.connect(owner).withdrawFromPredictionMarket(0)).to.be.revertedWith("Amount must be > 0");
      await expect(nfa.connect(user1).withdrawFromPredictionMarket(1)).to.be.revertedWithCustomError(
        nfa,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("Views and tokenURI", function () {
    beforeEach(async function () {
      await mintAgent(user1);
    });

    it("builds tokenURI from base URI", async function () {
      expect(await nfa.tokenURI(0)).to.equal("0.json");

      await nfa.connect(owner).setBaseURI("https://api.example.com/metadata/");
      expect(await nfa.tokenURI(0)).to.equal("https://api.example.com/metadata/0.json");

      await nfa.connect(owner).setBaseURI("ipfs://QmBase/");
      expect(await nfa.tokenURI(0)).to.equal("ipfs://QmBase/0.json");
    });

    it("reverts views for non-existent token", async function () {
      await expect(nfa.tokenURI(999)).to.be.revertedWithCustomError(nfa, "ERC721NonexistentToken");
      await expect(nfa.getState(999)).to.be.revertedWithCustomError(nfa, "ERC721NonexistentToken");
      await expect(nfa.getAgentMetadata(999)).to.be.revertedWithCustomError(nfa, "ERC721NonexistentToken");
      await expect(nfa.getProfile(999)).to.be.revertedWithCustomError(nfa, "ERC721NonexistentToken");
      await expect(nfa.getAgentBalance(999)).to.be.revertedWithCustomError(nfa, "ERC721NonexistentToken");
    });

    it("receive() accepts direct BNB", async function () {
      const sendAmount = ethers.parseEther("0.2");
      await user1.sendTransaction({
        to: await nfa.getAddress(),
        value: sendAmount,
      });

      const contractBalance = await ethers.provider.getBalance(await nfa.getAddress());
      expect(contractBalance).to.be.gte(sendAmount);
    });
  });

  describe("Prediction Market Bridge", function () {
    let pm: PredictionMarket;
    let marketEndTime: number;
    const agentTokenId = 0;
    const marketId = 0;
    const yesTokenId = marketId * 2;     // 0
    const noTokenId = marketId * 2 + 1;  // 1
    const depositAmount = ethers.parseEther("5");
    const positionAmount = ethers.parseEther("1");

    async function setupBridge() {
      // Deploy PredictionMarket
      const PMFactory = await ethers.getContractFactory("PredictionMarket");
      pm = (await PMFactory.deploy()) as unknown as PredictionMarket;
      await pm.waitForDeployment();
      await pm.setStrictArbitrationMode(false);
      const pmAddress = await pm.getAddress();
      const nfaAddress = await nfa.getAddress();

      // Wire up both contracts
      await nfa.connect(owner).setPredictionMarket(pmAddress);
      await pm.setNFAContract(nfaAddress);

      // Mint an agent for user1
      await mintAgent(user1);

      // Fund the agent with 10 ETH
      await nfa.connect(user1).fundAgent(agentTokenId, { value: ethers.parseEther("10") });

      // Create a market on PredictionMarket with endTime = now + 3600
      const latest = await time.latest();
      marketEndTime = latest + 3600;
      await pm.createMarket("Will BTC hit 100k?", marketEndTime);

      return { pmAddress, nfaAddress };
    }

    describe("depositToPredictionMarket", function () {
      it("should deposit agent balance to PredictionMarket successfully", async function () {
        const { nfaAddress } = await setupBridge();

        const balanceBefore = await nfa.getAgentBalance(agentTokenId);
        const pmBalanceBefore = await pm.balances(nfaAddress);

        const tx = await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        const balanceAfter = await nfa.getAgentBalance(agentTokenId);
        const pmBalanceAfter = await pm.balances(nfaAddress);

        expect(balanceAfter).to.equal(balanceBefore - depositAmount);
        expect(pmBalanceAfter).to.equal(pmBalanceBefore + depositAmount);

        await expect(tx)
          .to.emit(nfa, "AgentDepositedToPM")
          .withArgs(agentTokenId, depositAmount);
      });

      it("should revert if prediction market not set", async function () {
        // Mint agent without setting prediction market
        await mintAgent(user1);
        await nfa.connect(user1).fundAgent(0, { value: ethers.parseEther("10") });

        await expect(
          nfa.connect(user1).depositToPredictionMarket(0, depositAmount)
        ).to.be.revertedWith("Prediction market not set");
      });

      it("should revert if amount is zero", async function () {
        await setupBridge();

        await expect(
          nfa.connect(user1).depositToPredictionMarket(agentTokenId, 0)
        ).to.be.revertedWith("Amount must be > 0");
      });

      it("should revert if insufficient agent balance", async function () {
        await setupBridge();

        const tooMuch = ethers.parseEther("999");
        await expect(
          nfa.connect(user1).depositToPredictionMarket(agentTokenId, tooMuch)
        ).to.be.revertedWith("Insufficient agent balance");
      });

      it("should revert if caller is not token owner", async function () {
        await setupBridge();

        await expect(
          nfa.connect(user2).depositToPredictionMarket(agentTokenId, depositAmount)
        ).to.be.revertedWith("Not token owner");
      });

      it("should revert if agent is not active", async function () {
        await setupBridge();

        // Pause the agent first
        await nfa.connect(user1).pauseAgent(agentTokenId);

        await expect(
          nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount)
        ).to.be.revertedWith("Agent not active");
      });
    });

    describe("withdrawFromPredictionMarketToAgent", function () {
      it("should withdraw agent PM balance back into agent local balance", async function () {
        const { nfaAddress } = await setupBridge();

        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);
        const agentBalAfterDeposit = await nfa.getAgentBalance(agentTokenId);
        const pmBalAfterDeposit = await pm.balances(nfaAddress);
        expect(await nfa.predictionMarketBalances(agentTokenId)).to.equal(depositAmount);

        const withdrawAmount = ethers.parseEther("2");
        const tx = await nfa.connect(user1).withdrawFromPredictionMarketToAgent(agentTokenId, withdrawAmount);

        expect(await nfa.getAgentBalance(agentTokenId)).to.equal(agentBalAfterDeposit + withdrawAmount);
        expect(await pm.balances(nfaAddress)).to.equal(pmBalAfterDeposit - withdrawAmount);
        expect(await nfa.predictionMarketBalances(agentTokenId)).to.equal(depositAmount - withdrawAmount);

        await expect(tx)
          .to.emit(nfa, "AgentWithdrewFromPM")
          .withArgs(agentTokenId, withdrawAmount);
      });

      it("should revert withdrawFromPredictionMarketToAgent if caller is not token owner", async function () {
        await setupBridge();
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        await expect(
          nfa.connect(user2).withdrawFromPredictionMarketToAgent(agentTokenId, ethers.parseEther("1"))
        ).to.be.revertedWith("Not token owner");
      });
    });

    describe("agentPredictionTakePosition", function () {
      it("should take a YES position via the bridge (full flow)", async function () {
        const { nfaAddress } = await setupBridge();

        // Step 1: deposit to PM
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        // Step 2: take YES position
        const tx = await nfa.connect(user1).agentPredictionTakePosition(
          agentTokenId, marketId, true, positionAmount
        );

        // Verify ERC1155 balance on nfaContract
        const yesBalance = await pm.balanceOf(nfaAddress, yesTokenId);
        expect(yesBalance).to.equal(positionAmount);

        // Verify agent sub-ledger
        const agentYesBal = await pm.agentYesBalance(marketId, agentTokenId);
        expect(agentYesBal).to.equal(positionAmount);

        // Verify event
        await expect(tx)
          .to.emit(nfa, "AgentPositionViaPM")
          .withArgs(agentTokenId, marketId, true, positionAmount);
      });

      it("should revert if caller is not token owner", async function () {
        await setupBridge();
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        await expect(
          nfa.connect(user2).agentPredictionTakePosition(
            agentTokenId, marketId, true, positionAmount
          )
        ).to.be.revertedWith("Not token owner");
      });
    });

    describe("agentPredictionSplitPosition", function () {
      it("should split position and mint both YES+NO tokens (full flow)", async function () {
        const { nfaAddress } = await setupBridge();

        // Step 1: deposit to PM
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        // Step 2: split position
        const tx = await nfa.connect(user1).agentPredictionSplitPosition(
          agentTokenId, marketId, positionAmount
        );

        // Verify BOTH YES and NO ERC1155 balances on nfaContract
        const yesBalance = await pm.balanceOf(nfaAddress, yesTokenId);
        const noBalance = await pm.balanceOf(nfaAddress, noTokenId);
        expect(yesBalance).to.equal(positionAmount);
        expect(noBalance).to.equal(positionAmount);

        // Verify agent sub-ledger for both sides
        const agentYesBal = await pm.agentYesBalance(marketId, agentTokenId);
        const agentNoBal = await pm.agentNoBalance(marketId, agentTokenId);
        expect(agentYesBal).to.equal(positionAmount);
        expect(agentNoBal).to.equal(positionAmount);

        // Verify event
        await expect(tx)
          .to.emit(nfa, "AgentSplitViaPM")
          .withArgs(agentTokenId, marketId, positionAmount);
      });

      it("should revert if caller is not token owner", async function () {
        await setupBridge();
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        await expect(
          nfa.connect(user2).agentPredictionSplitPosition(
            agentTokenId, marketId, positionAmount
          )
        ).to.be.revertedWith("Not token owner");
      });
    });

    describe("agentPredictionClaimWinnings", function () {
      it("should claim winnings after market resolves YES (full flow)", async function () {
        const { nfaAddress } = await setupBridge();

        // Step 1: deposit to PM
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        // Step 2: take YES position
        await nfa.connect(user1).agentPredictionTakePosition(
          agentTokenId, marketId, true, positionAmount
        );

        // Step 3: advance time past endTime and resolve market as YES
        await time.increaseTo(marketEndTime);
        await pm.resolveMarket(marketId, true);

        // Record PM balance before claim
        const pmBalanceBefore = await pm.balances(nfaAddress);

        // Step 4: claim winnings
        const tx = await nfa.connect(user1).agentPredictionClaimWinnings(agentTokenId, marketId);

        // Verify PM balance increased by reward
        const pmBalanceAfter = await pm.balances(nfaAddress);
        expect(pmBalanceAfter).to.be.gt(pmBalanceBefore);

        // Verify event
        await expect(tx).to.emit(nfa, "AgentClaimedViaPM");
      });

      it("should allow terminated agent to claim winnings (no onlyActiveAgent required)", async function () {
        await setupBridge();

        // deposit + take position
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);
        await nfa.connect(user1).agentPredictionTakePosition(
          agentTokenId, marketId, true, positionAmount
        );

        // Terminate the agent
        await nfa.connect(user1).terminateAgent(agentTokenId);

        // Resolve market
        await time.increaseTo(marketEndTime);
        await pm.resolveMarket(marketId, true);

        // Should still be able to claim even though agent is terminated
        await expect(
          nfa.connect(user1).agentPredictionClaimWinnings(agentTokenId, marketId)
        ).to.not.be.reverted;
      });
    });

    describe("agentPredictionClaimRefund", function () {
      it("should claim refund after market is cancelled (full flow)", async function () {
        const { nfaAddress } = await setupBridge();

        // Step 1: deposit to PM
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);

        // Step 2: take YES position
        await nfa.connect(user1).agentPredictionTakePosition(
          agentTokenId, marketId, true, positionAmount
        );

        // Record PM balance before refund
        const pmBalanceBefore = await pm.balances(nfaAddress);

        // Step 3: cancel the market
        await pm.cancelMarket(marketId);

        // Step 4: claim refund
        const tx = await nfa.connect(user1).agentPredictionClaimRefund(agentTokenId, marketId);

        // Verify PM balance increased (refund credited back)
        const pmBalanceAfter = await pm.balances(nfaAddress);
        expect(pmBalanceAfter).to.be.gt(pmBalanceBefore);

        // Verify event
        await expect(tx).to.emit(nfa, "AgentRefundViaPM");
      });

      it("should revert if caller is not token owner", async function () {
        await setupBridge();
        await nfa.connect(user1).depositToPredictionMarket(agentTokenId, depositAmount);
        await nfa.connect(user1).agentPredictionTakePosition(
          agentTokenId, marketId, true, positionAmount
        );
        await pm.cancelMarket(marketId);

        await expect(
          nfa.connect(user2).agentPredictionClaimRefund(agentTokenId, marketId)
        ).to.be.revertedWith("Not token owner");
      });
    });
  });
});
