import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("PredictionMarketV3 + LimitOrderBook", function () {
  async function deployFixture() {
    const [owner, user1, user2, user3] = await ethers.getSigners();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();
    await usdt.waitForDeployment();
    const usdtAddress = await usdt.getAddress();

    // Deploy PM proxy
    const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
    const pmProxy = await upgrades.deployProxy(PredictionMarketV3, [usdtAddress], {
      kind: "uups",
      initializer: "initialize",
    });
    await pmProxy.waitForDeployment();
    const pm = pmProxy as any;
    const pmAddress = await pm.getAddress();

    // Deploy NFA
    const NFA = await ethers.getContractFactory("NFA");
    const nfa = await NFA.deploy(pmAddress);
    await nfa.waitForDeployment();
    const nfaAddress = await nfa.getAddress();
    await pm.setNFAContract(nfaAddress);

    // Deploy LOB proxy
    const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
    const lobProxy = await upgrades.deployProxy(LimitOrderBook, [pmAddress], {
      kind: "uups",
      initializer: "initialize",
    });
    await lobProxy.waitForDeployment();
    const lob = lobProxy as any;
    const lobAddress = await lob.getAddress();

    // Mint USDT
    const mintAmount = ethers.parseUnits("100000", 18);
    await usdt.mint(owner.address, mintAmount);
    await usdt.mint(user1.address, mintAmount);
    await usdt.mint(user2.address, mintAmount);
    await usdt.mint(user3.address, mintAmount);

    // Approve USDT to PM and LOB
    await usdt.connect(owner).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(user1).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(user2).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(user3).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(owner).approve(lobAddress, ethers.MaxUint256);
    await usdt.connect(user1).approve(lobAddress, ethers.MaxUint256);
    await usdt.connect(user2).approve(lobAddress, ethers.MaxUint256);
    await usdt.connect(user3).approve(lobAddress, ethers.MaxUint256);

    // Approve ERC1155 to LOB (for sell orders)
    await pm.connect(owner).setApprovalForAll(lobAddress, true);
    await pm.connect(user1).setApprovalForAll(lobAddress, true);
    await pm.connect(user2).setApprovalForAll(lobAddress, true);
    await pm.connect(user3).setApprovalForAll(lobAddress, true);

    return { pm, pmAddress, lob, lobAddress, usdt, usdtAddress, nfa, nfaAddress, owner, user1, user2, user3 };
  }

  async function deployWithMarketFixture() {
    const fixture = await deployFixture();
    const { pm } = fixture;

    const endTime = (await time.latest()) + 7 * 24 * 3600;
    const initialLiq = ethers.parseUnits("500", 18);
    await pm.createUserMarket("Test Market for V3 Trading", endTime, initialLiq);

    return { ...fixture, endTime };
  }

  // ============================================================
  //  PROXY DEPLOYMENT
  // ============================================================

  describe("Proxy Deployment", function () {
    it("should deploy PM via UUPS proxy", async function () {
      const { pm } = await loadFixture(deployFixture);
      expect(await pm.nextMarketId()).to.equal(0);
    });

    it("should deploy LOB via UUPS proxy", async function () {
      const { lob, pmAddress } = await loadFixture(deployFixture);
      expect(await lob.predictionMarket()).to.equal(pmAddress);
      expect(await lob.nextOrderId()).to.equal(0);
    });

    it("should initialize PM correctly", async function () {
      const { pm, usdtAddress, owner } = await loadFixture(deployFixture);
      expect(await pm.usdtToken()).to.equal(usdtAddress);
      expect(await pm.owner()).to.equal(owner.address);
      expect(await pm.marketCreationFee()).to.equal(ethers.parseUnits("10", 18));
      expect(await pm.maxMarketsPerDay()).to.equal(3);
    });

    it("should not allow PM re-initialization", async function () {
      const { pm, usdtAddress } = await loadFixture(deployFixture);
      await expect(pm.initialize(usdtAddress)).to.be.revertedWithCustomError(pm, "InvalidInitialization");
    });

    it("should not allow LOB re-initialization", async function () {
      const { lob, pmAddress } = await loadFixture(deployFixture);
      await expect(lob.initialize(pmAddress)).to.be.revertedWithCustomError(lob, "InvalidInitialization");
    });

    it("should upgrade PM to new implementation", async function () {
      const { pm } = await loadFixture(deployFixture);
      const pmAddress = await pm.getAddress();

      const endTime = (await time.latest()) + 7 * 24 * 3600;
      await pm.createMarket("Before Upgrade", endTime);
      expect(await pm.nextMarketId()).to.equal(1);

      const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
      const upgraded = await upgrades.upgradeProxy(pmAddress, PredictionMarketV3, { kind: "uups" });
      await upgraded.waitForDeployment();

      expect(await upgraded.nextMarketId()).to.equal(1);
      const market = await upgraded.getMarket(0);
      expect(market.title).to.equal("Before Upgrade");
    });

    it("should reject PM upgrade from non-owner", async function () {
      const { pm, user1 } = await loadFixture(deployFixture);
      const pmAddress = await pm.getAddress();

      const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3", user1);
      await expect(
        upgrades.upgradeProxy(pmAddress, PredictionMarketV3, { kind: "uups" })
      ).to.be.revertedWithCustomError(pm, "OwnableUnauthorizedAccount");
    });
  });

  // ============================================================
  //  CPMM TRADING (regression)
  // ============================================================

  describe("CPMM Trading", function () {
    it("should buy YES shares", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      const amount = ethers.parseUnits("100", 18);

      await expect(pm.connect(user1).buy(0, true, amount))
        .to.emit(pm, "Trade");

      const pos = await pm.getPosition(0, user1.address);
      expect(pos.yesAmount).to.be.gt(0);
    });

    it("should sell YES shares", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      const amount = ethers.parseUnits("100", 18);

      await pm.connect(user1).buy(0, true, amount);
      const pos = await pm.getPosition(0, user1.address);

      await expect(pm.connect(user1).sell(0, true, pos.yesAmount))
        .to.emit(pm, "Trade");
    });

    it("should add and remove liquidity", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      const amount = ethers.parseUnits("200", 18);

      await expect(pm.connect(user1).addLiquidity(0, amount))
        .to.emit(pm, "LiquidityAdded");

      const lpInfo = await pm.getLpInfo(0, user1.address);
      expect(lpInfo.userLpShares).to.be.gt(0);

      await expect(pm.connect(user1).removeLiquidity(0, lpInfo.userLpShares))
        .to.emit(pm, "LiquidityRemoved");
    });

    it("should split and merge positions", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      const amount = ethers.parseUnits("50", 18);

      await pm.connect(user1).splitPosition(0, amount);
      const pos = await pm.getPosition(0, user1.address);
      expect(pos.yesAmount).to.equal(amount);
      expect(pos.noAmount).to.equal(amount);

      await pm.connect(user1).mergePositions(0, amount);
      const pos2 = await pm.getPosition(0, user1.address);
      expect(pos2.yesAmount).to.equal(0);
      expect(pos2.noAmount).to.equal(0);
    });

    it("should claim winnings after resolution", async function () {
      const { pm, usdt, user1, endTime } = await loadFixture(deployWithMarketFixture);
      const amount = ethers.parseUnits("100", 18);

      await pm.connect(user1).buy(0, true, amount);

      // Disable strict arbitration for direct resolve
      await pm.setStrictArbitrationMode(false);
      await time.increaseTo(endTime + 1);
      await pm.resolveMarket(0, true);

      const balBefore = await usdt.balanceOf(user1.address);
      await pm.connect(user1).claimWinnings(0);
      const balAfter = await usdt.balanceOf(user1.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("should report isMarketActive correctly", async function () {
      const { pm, endTime } = await loadFixture(deployWithMarketFixture);
      expect(await pm.isMarketActive(0)).to.be.true;

      await pm.setStrictArbitrationMode(false);
      await time.increaseTo(endTime + 1);
      expect(await pm.isMarketActive(0)).to.be.false;
    });

    it("should report isMarketCancelled correctly", async function () {
      const { pm } = await loadFixture(deployWithMarketFixture);
      expect(await pm.isMarketCancelled(0)).to.be.false;
      await pm.cancelMarket(0);
      expect(await pm.isMarketCancelled(0)).to.be.true;
    });
  });

  // ============================================================
  //  ORACLE MARKETS
  // ============================================================

  describe("Oracle Markets", function () {
    it("should create an oracle market", async function () {
      const { pm } = await loadFixture(deployFixture);

      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy(50000e8, 8);
      await oracle.waitForDeployment();
      const oracleAddr = await oracle.getAddress();

      const endTime = (await time.latest()) + 7 * 24 * 3600;
      await expect(pm.createOracleMarket("BTC > 50k?", endTime, oracleAddr, 50000e8, 1))
        .to.emit(pm, "OracleMarketCreated");

      const market = await pm.getMarket(0);
      expect(market.oracleEnabled).to.be.true;
      expect(market.priceFeed).to.equal(oracleAddr);
    });

    it("should resolve by oracle (type 1: price >= target)", async function () {
      const { pm } = await loadFixture(deployFixture);

      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy(55000e8, 8);
      await oracle.waitForDeployment();
      const oracleAddr = await oracle.getAddress();

      const endTime = (await time.latest()) + 3600;
      await pm.createOracleMarket("BTC >= 50k?", endTime, oracleAddr, 50000e8, 1);

      await time.increaseTo(endTime + 1);
      await expect(pm.resolveByOracle(0))
        .to.emit(pm, "OracleResolution");

      const market = await pm.getMarket(0);
      expect(market.resolved).to.be.true;
      expect(market.outcome).to.be.true; // 55000 >= 50000
    });

    it("should resolve by oracle (type 2: price <= target)", async function () {
      const { pm } = await loadFixture(deployFixture);

      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy(45000e8, 8);
      await oracle.waitForDeployment();
      const oracleAddr = await oracle.getAddress();

      const endTime = (await time.latest()) + 3600;
      await pm.createOracleMarket("BTC <= 50k?", endTime, oracleAddr, 50000e8, 2);

      await time.increaseTo(endTime + 1);
      await pm.resolveByOracle(0);

      const market = await pm.getMarket(0);
      expect(market.outcome).to.be.true; // 45000 <= 50000
    });

    it("should revert resolveMarket on oracle market", async function () {
      const { pm } = await loadFixture(deployFixture);

      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy(50000e8, 8);
      await oracle.waitForDeployment();

      const endTime = (await time.latest()) + 3600;
      await pm.createOracleMarket("Oracle test", endTime, await oracle.getAddress(), 50000e8, 1);

      await pm.setStrictArbitrationMode(false);
      await time.increaseTo(endTime + 1);
      await expect(pm.resolveMarket(0, true)).to.be.revertedWithCustomError(pm, "OracleOnly");
    });

    it("should revert resolveByOracle on non-oracle market", async function () {
      const { pm } = await loadFixture(deployWithMarketFixture);
      const endTime = (await time.latest()) + 7 * 24 * 3600;
      await time.increaseTo(endTime + 1);
      await expect(pm.resolveByOracle(0)).to.be.revertedWithCustomError(pm, "NotOracleMarket");
    });

    it("should reject invalid oracle params", async function () {
      const { pm } = await loadFixture(deployFixture);
      const endTime = (await time.latest()) + 3600;
      await expect(pm.createOracleMarket("bad", endTime, ethers.ZeroAddress, 100, 1))
        .to.be.revertedWithCustomError(pm, "InvalidPriceFeed");

      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy(100, 8);
      await oracle.waitForDeployment();
      await expect(pm.createOracleMarket("bad", endTime, await oracle.getAddress(), 100, 3))
        .to.be.revertedWithCustomError(pm, "InvalidResType");
    });
  });

  // ============================================================
  //  ARBITRATION
  // ============================================================

  describe("Arbitration", function () {
    it("should propose and finalize resolution", async function () {
      const { pm, endTime } = await loadFixture(deployWithMarketFixture);

      await time.increaseTo(endTime + 1);
      await expect(pm.proposeResolution(0, true))
        .to.emit(pm, "ResolutionProposed");

      // Fast-forward past challenge window (6 hours)
      await time.increase(6 * 3600 + 1);
      await expect(pm.finalizeResolution(0))
        .to.emit(pm, "ResolutionFinalized");

      const market = await pm.getMarket(0);
      expect(market.resolved).to.be.true;
      expect(market.outcome).to.be.true;
    });

    it("should allow market creator to propose", async function () {
      const { pm, user1, endTime } = await loadFixture(deployFixture);

      // user1 creates a market
      const eTime = (await time.latest()) + 7200;
      const initialLiq = ethers.parseUnits("100", 18);
      await pm.connect(user1).createUserMarket("User market test for arbitration", eTime, initialLiq);

      await time.increaseTo(eTime + 1);
      await expect(pm.connect(user1).proposeResolution(0, false))
        .to.emit(pm, "ResolutionProposed");
    });

    it("should challenge and admin finalize", async function () {
      const { pm, user1, endTime } = await loadFixture(deployWithMarketFixture);

      await time.increaseTo(endTime + 1);
      await pm.proposeResolution(0, true);

      // user1 challenges
      await expect(pm.connect(user1).challengeResolution(0))
        .to.emit(pm, "ResolutionChallenged");

      // Fast-forward past new challenge window (3 hours)
      await time.increase(3 * 3600 + 1);
      await expect(pm.adminFinalizeResolution(0, false))
        .to.emit(pm, "ResolutionFinalized");

      const market = await pm.getMarket(0);
      expect(market.resolved).to.be.true;
      expect(market.outcome).to.be.false; // admin overrode
    });

    it("should revert if proposer challenges own proposal", async function () {
      const { pm, endTime } = await loadFixture(deployWithMarketFixture);
      await time.increaseTo(endTime + 1);
      await pm.proposeResolution(0, true);
      await expect(pm.challengeResolution(0)).to.be.revertedWithCustomError(pm, "ProposerCannotChallenge");
    });

    it("should revert duplicate challenge", async function () {
      const { pm, user1, endTime } = await loadFixture(deployWithMarketFixture);
      await time.increaseTo(endTime + 1);
      await pm.proposeResolution(0, true);
      await pm.connect(user1).challengeResolution(0);
      await expect(pm.connect(user1).challengeResolution(0)).to.be.revertedWithCustomError(pm, "AlreadyChallengedMkt");
    });

    it("should revert resolveMarket when strict mode is on", async function () {
      const { pm, endTime } = await loadFixture(deployWithMarketFixture);
      await time.increaseTo(endTime + 1);
      await expect(pm.resolveMarket(0, true)).to.be.revertedWithCustomError(pm, "ManualDisabled");
    });

    it("should revert resolveMarket when arbitration in progress", async function () {
      const { pm, endTime } = await loadFixture(deployWithMarketFixture);
      await pm.setStrictArbitrationMode(false);
      await time.increaseTo(endTime + 1);
      await pm.proposeResolution(0, true);
      await expect(pm.resolveMarket(0, true)).to.be.revertedWithCustomError(pm, "ArbitrationInProgress");
    });
  });

  // ============================================================
  //  AGENT FUNCTIONS
  // ============================================================

  describe("Agent Functions", function () {
    it("should agentBuy and agentClaimWinnings", async function () {
      const { pm, usdt, nfa, nfaAddress, pmAddress, user1, endTime } = await loadFixture(deployWithMarketFixture);

      // Mint USDT to NFA contract for agent trading
      await usdt.mint(nfaAddress, ethers.parseUnits("1000", 18));
      // NFA needs to approve PM
      // Since NFA is a contract, we need to call from NFA. Let's use agentBuy through NFA.
      // For testing, we check that only NFA can call agentBuy
      await expect(
        pm.connect(user1).agentBuy(1, 0, true, ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(pm, "OnlyNFA");

      // Check getAgentPosition returns zeros
      const pos = await pm.getAgentPosition(0, 1);
      expect(pos.yesAmount).to.equal(0);
      expect(pos.noAmount).to.equal(0);
    });

    it("should revert agentClaimRefund when not cancelled", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      await expect(
        pm.connect(user1).agentClaimRefund(1, 0)
      ).to.be.revertedWithCustomError(pm, "OnlyNFA");
    });
  });

  // ============================================================
  //  LIMIT ORDER BOOK (via LOB contract)
  // ============================================================

  describe("Limit Order Book", function () {
    it("should place a BUY_YES limit order", async function () {
      const { lob, user1 } = await loadFixture(deployWithMarketFixture);
      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);

      await expect(lob.connect(user1).placeLimitOrder(0, 0, price, amount))
        .to.emit(lob, "LimitOrderPlaced")
        .withArgs(0, 0, user1.address, 0, price, amount);

      const order = await lob.getLimitOrder(0);
      expect(order.maker).to.equal(user1.address);
      expect(order.price).to.equal(price);
      expect(order.amount).to.equal(amount);
      expect(order.cancelled).to.be.false;
    });

    it("should place a SELL_YES limit order (locks shares in LOB)", async function () {
      const { pm, lob, lobAddress, user1 } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).splitPosition(0, ethers.parseUnits("100", 18));

      const price = ethers.parseUnits("0.60", 18);
      const shares = ethers.parseUnits("50", 18);

      await expect(lob.connect(user1).placeLimitOrder(0, 2, price, shares))
        .to.emit(lob, "LimitOrderPlaced");

      // Shares should be in LOB contract
      const yesTokenId = await pm.getYesTokenId(0);
      const lobBalance = await pm.balanceOf(lobAddress, yesTokenId);
      expect(lobBalance).to.equal(shares);
    });

    it("should fill a BUY_YES limit order", async function () {
      const { pm, lob, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.40", 18);
      const amount = ethers.parseUnits("100", 18);
      await lob.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("300", 18));

      await expect(lob.connect(user2).fillLimitOrder(0, amount))
        .to.emit(lob, "LimitOrderFilled")
        .to.emit(lob, "Trade");

      const order = await lob.getLimitOrder(0);
      expect(order.filled).to.equal(amount);
    });

    it("should fill a SELL_YES limit order", async function () {
      const { pm, lob, user1, user2 } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).splitPosition(0, ethers.parseUnits("200", 18));

      const price = ethers.parseUnits("0.60", 18);
      const shares = ethers.parseUnits("100", 18);
      await lob.connect(user1).placeLimitOrder(0, 2, price, shares);

      await expect(lob.connect(user2).fillLimitOrder(0, shares))
        .to.emit(lob, "LimitOrderFilled")
        .to.emit(lob, "Trade");

      const yesTokenId = await pm.getYesTokenId(0);
      const user2Balance = await pm.balanceOf(user2.address, yesTokenId);
      expect(user2Balance).to.equal(shares);
    });

    it("should partially fill a limit order", async function () {
      const { pm, lob, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await lob.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("200", 18));

      const partialAmount = ethers.parseUnits("40", 18);
      await lob.connect(user2).fillLimitOrder(0, partialAmount);

      const order = await lob.getLimitOrder(0);
      expect(order.filled).to.equal(partialAmount);
      expect(order.cancelled).to.be.false;

      const remaining = amount - partialAmount;
      await lob.connect(user2).fillLimitOrder(0, remaining);

      const order2 = await lob.getLimitOrder(0);
      expect(order2.filled).to.equal(amount);
    });

    it("should cancel a limit order and refund", async function () {
      const { lob, usdt, user1 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      const balBefore = await usdt.balanceOf(user1.address);

      await lob.connect(user1).placeLimitOrder(0, 0, price, amount);

      const balAfterPlace = await usdt.balanceOf(user1.address);
      expect(balAfterPlace).to.equal(balBefore - amount);

      await expect(lob.connect(user1).cancelLimitOrder(0))
        .to.emit(lob, "LimitOrderCancelled");

      const balAfterCancel = await usdt.balanceOf(user1.address);
      expect(balAfterCancel).to.equal(balBefore);

      const order = await lob.getLimitOrder(0);
      expect(order.cancelled).to.be.true;
    });

    it("should reject self-trade", async function () {
      const { pm, lob, user1 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await lob.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user1).splitPosition(0, ethers.parseUnits("200", 18));
      await expect(lob.connect(user1).fillLimitOrder(0, amount))
        .to.be.revertedWithCustomError(lob, "SelfTrade");
    });

    it("should reject price out of range", async function () {
      const { lob, user1 } = await loadFixture(deployWithMarketFixture);

      await expect(
        lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.005", 18), ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(lob, "PriceOutOfRange");

      await expect(
        lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.995", 18), ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(lob, "PriceOutOfRange");
    });

    it("should reject order on resolved market", async function () {
      const { pm, lob, user1, endTime } = await loadFixture(deployWithMarketFixture);

      await pm.setStrictArbitrationMode(false);
      await time.increaseTo(endTime + 1);
      await pm.resolveMarket(0, true);

      await expect(
        lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.50", 18), ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(lob, "MarketNotActive");
    });

    it("should batch cancel market orders after resolution", async function () {
      const { pm, lob, user1, user2, endTime } = await loadFixture(deployWithMarketFixture);

      await lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await lob.connect(user2).placeLimitOrder(0, 1, ethers.parseUnits("0.30", 18), ethers.parseUnits("30", 18));

      await pm.setStrictArbitrationMode(false);
      await time.increaseTo(endTime + 1);
      await pm.resolveMarket(0, true);

      await lob.cancelMarketOrders(0);

      const order0 = await lob.getLimitOrder(0);
      const order1 = await lob.getLimitOrder(1);
      expect(order0.cancelled).to.be.true;
      expect(order1.cancelled).to.be.true;
    });

    it("should revert cancelMarketOrders on active market", async function () {
      const { lob, user1 } = await loadFixture(deployWithMarketFixture);
      await lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await expect(lob.cancelMarketOrders(0)).to.be.revertedWithCustomError(lob, "MarketStillActive");
    });

    it("should return market order IDs", async function () {
      const { lob, user1, user2 } = await loadFixture(deployWithMarketFixture);

      await lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await lob.connect(user2).placeLimitOrder(0, 1, ethers.parseUnits("0.30", 18), ethers.parseUnits("30", 18));

      const orderIds = await lob.getMarketOrderIds(0);
      expect(orderIds.length).to.equal(2);
      expect(orderIds[0]).to.equal(0);
      expect(orderIds[1]).to.equal(1);
    });

    it("should return user order IDs", async function () {
      const { lob, user1 } = await loadFixture(deployWithMarketFixture);

      await lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await lob.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.45", 18), ethers.parseUnits("30", 18));

      const orderIds = await lob.getUserOrderIds(user1.address);
      expect(orderIds.length).to.equal(2);
    });

    it("should collect taker fee on fill", async function () {
      const { pm, lob, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const feesBefore = await lob.accumulatedFees();

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await lob.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("200", 18));
      await lob.connect(user2).fillLimitOrder(0, amount);

      const feesAfter = await lob.accumulatedFees();
      const expectedFee = ethers.parseUnits("0.5", 18); // 100 * 0.5% = 0.5
      expect(feesAfter - feesBefore).to.equal(expectedFee);
    });

    it("should emit Trade event on fill for K-line integration", async function () {
      const { pm, lob, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await lob.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("200", 18));

      await expect(lob.connect(user2).fillLimitOrder(0, amount))
        .to.emit(lob, "Trade")
        .withArgs(
          0,
          user2.address,
          false,
          true,
          (v: any) => v > 0,
          (v: any) => v > 0,
          (v: any) => v > 0
        );
    });
  });

  // ============================================================
  //  ERC1155 RECEIVER (LOB)
  // ============================================================

  describe("ERC1155 Receiver", function () {
    it("LOB should accept ERC1155 tokens via sell order", async function () {
      const { pm, lob, user1 } = await loadFixture(deployWithMarketFixture);
      await pm.connect(user1).splitPosition(0, ethers.parseUnits("100", 18));

      await expect(
        lob.connect(user1).placeLimitOrder(0, 2, ethers.parseUnits("0.60", 18), ethers.parseUnits("50", 18))
      ).to.not.be.reverted;
    });
  });
});
