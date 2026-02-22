import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("PredictionMarketV3", function () {
  async function deployFixture() {
    const [owner, user1, user2, user3] = await ethers.getSigners();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();
    await usdt.waitForDeployment();
    const usdtAddress = await usdt.getAddress();

    const PredictionMarketV3 = await ethers.getContractFactory("PredictionMarketV3");
    const proxy = await upgrades.deployProxy(PredictionMarketV3, [usdtAddress], {
      kind: "uups",
      initializer: "initialize",
    });
    await proxy.waitForDeployment();
    const pm = proxy as any;
    const pmAddress = await pm.getAddress();

    const NFA = await ethers.getContractFactory("NFA");
    const nfa = await NFA.deploy(pmAddress);
    await nfa.waitForDeployment();
    const nfaAddress = await nfa.getAddress();
    await pm.setNFAContract(nfaAddress);

    const mintAmount = ethers.parseUnits("100000", 18);
    await usdt.mint(owner.address, mintAmount);
    await usdt.mint(user1.address, mintAmount);
    await usdt.mint(user2.address, mintAmount);
    await usdt.mint(user3.address, mintAmount);

    await usdt.connect(owner).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(user1).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(user2).approve(pmAddress, ethers.MaxUint256);
    await usdt.connect(user3).approve(pmAddress, ethers.MaxUint256);

    return { pm, pmAddress, usdt, usdtAddress, nfa, nfaAddress, owner, user1, user2, user3 };
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
    it("should deploy via UUPS proxy", async function () {
      const { pm } = await loadFixture(deployFixture);
      expect(await pm.nextMarketId()).to.equal(0);
    });

    it("should initialize correctly", async function () {
      const { pm, usdtAddress, owner } = await loadFixture(deployFixture);
      expect(await pm.usdtToken()).to.equal(usdtAddress);
      expect(await pm.owner()).to.equal(owner.address);
      expect(await pm.marketCreationFee()).to.equal(ethers.parseUnits("10", 18));
      expect(await pm.maxMarketsPerDay()).to.equal(3);
    });

    it("should not allow re-initialization", async function () {
      const { pm, usdtAddress } = await loadFixture(deployFixture);
      await expect(pm.initialize(usdtAddress)).to.be.revertedWithCustomError(pm, "InvalidInitialization");
    });

    it("should upgrade to new implementation", async function () {
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

    it("should reject upgrade from non-owner", async function () {
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

      await time.increaseTo(endTime + 1);
      await pm.resolveMarket(0, true);

      const balBefore = await usdt.balanceOf(user1.address);
      await pm.connect(user1).claimWinnings(0);
      const balAfter = await usdt.balanceOf(user1.address);
      expect(balAfter).to.be.gt(balBefore);
    });
  });

  // ============================================================
  //  LIMIT ORDER BOOK
  // ============================================================

  describe("Limit Order Book", function () {
    it("should place a BUY_YES limit order", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);

      await expect(pm.connect(user1).placeLimitOrder(0, 0, price, amount))
        .to.emit(pm, "LimitOrderPlaced")
        .withArgs(0, 0, user1.address, 0, price, amount);

      const order = await pm.getLimitOrder(0);
      expect(order.maker).to.equal(user1.address);
      expect(order.price).to.equal(price);
      expect(order.amount).to.equal(amount);
      expect(order.cancelled).to.be.false;
    });

    it("should place a SELL_YES limit order (locks shares)", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).splitPosition(0, ethers.parseUnits("100", 18));

      const pmAddress = await pm.getAddress();
      await pm.connect(user1).setApprovalForAll(pmAddress, true);

      const price = ethers.parseUnits("0.60", 18);
      const shares = ethers.parseUnits("50", 18);

      await expect(pm.connect(user1).placeLimitOrder(0, 2, price, shares))
        .to.emit(pm, "LimitOrderPlaced");

      const yesTokenId = await pm.getYesTokenId(0);
      const contractBalance = await pm.balanceOf(pmAddress, yesTokenId);
      expect(contractBalance).to.equal(shares);
    });

    it("should fill a BUY_YES limit order", async function () {
      const { pm, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.40", 18);
      const amount = ethers.parseUnits("100", 18);
      await pm.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("300", 18));

      await expect(pm.connect(user2).fillLimitOrder(0, amount))
        .to.emit(pm, "LimitOrderFilled")
        .to.emit(pm, "Trade");

      const order = await pm.getLimitOrder(0);
      expect(order.filled).to.equal(amount);
    });

    it("should fill a SELL_YES limit order", async function () {
      const { pm, user1, user2 } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).splitPosition(0, ethers.parseUnits("200", 18));
      const pmAddress = await pm.getAddress();
      await pm.connect(user1).setApprovalForAll(pmAddress, true);

      const price = ethers.parseUnits("0.60", 18);
      const shares = ethers.parseUnits("100", 18);
      await pm.connect(user1).placeLimitOrder(0, 2, price, shares);

      await expect(pm.connect(user2).fillLimitOrder(0, shares))
        .to.emit(pm, "LimitOrderFilled")
        .to.emit(pm, "Trade");

      const yesTokenId = await pm.getYesTokenId(0);
      const user2Balance = await pm.balanceOf(user2.address, yesTokenId);
      expect(user2Balance).to.equal(shares);
    });

    it("should partially fill a limit order", async function () {
      const { pm, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await pm.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("200", 18));

      const partialAmount = ethers.parseUnits("40", 18);
      await pm.connect(user2).fillLimitOrder(0, partialAmount);

      const order = await pm.getLimitOrder(0);
      expect(order.filled).to.equal(partialAmount);
      expect(order.cancelled).to.be.false;

      const remaining = amount - partialAmount;
      await pm.connect(user2).fillLimitOrder(0, remaining);

      const order2 = await pm.getLimitOrder(0);
      expect(order2.filled).to.equal(amount);
    });

    it("should cancel a limit order and refund", async function () {
      const { pm, usdt, user1 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      const balBefore = await usdt.balanceOf(user1.address);

      await pm.connect(user1).placeLimitOrder(0, 0, price, amount);

      const balAfterPlace = await usdt.balanceOf(user1.address);
      expect(balAfterPlace).to.equal(balBefore - amount);

      await expect(pm.connect(user1).cancelLimitOrder(0))
        .to.emit(pm, "LimitOrderCancelled");

      const balAfterCancel = await usdt.balanceOf(user1.address);
      expect(balAfterCancel).to.equal(balBefore);

      const order = await pm.getLimitOrder(0);
      expect(order.cancelled).to.be.true;
    });

    it("should reject self-trade", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await pm.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user1).splitPosition(0, ethers.parseUnits("200", 18));
      await expect(pm.connect(user1).fillLimitOrder(0, amount))
        .to.be.revertedWithCustomError(pm, "SelfTrade");
    });

    it("should reject price out of range", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);

      await expect(
        pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.005", 18), ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(pm, "PriceOutOfRange");

      await expect(
        pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.995", 18), ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(pm, "PriceOutOfRange");
    });

    it("should reject order on resolved market", async function () {
      const { pm, user1, endTime } = await loadFixture(deployWithMarketFixture);

      await time.increaseTo(endTime + 1);
      await pm.resolveMarket(0, true);

      await expect(
        pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.50", 18), ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(pm, "MktResolved");
    });

    it("should batch cancel market orders after resolution", async function () {
      const { pm, user1, user2, endTime } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await pm.connect(user2).placeLimitOrder(0, 1, ethers.parseUnits("0.30", 18), ethers.parseUnits("30", 18));

      await time.increaseTo(endTime + 1);
      await pm.resolveMarket(0, true);

      await pm.cancelMarketOrders(0);

      const order0 = await pm.getLimitOrder(0);
      const order1 = await pm.getLimitOrder(1);
      expect(order0.cancelled).to.be.true;
      expect(order1.cancelled).to.be.true;
    });

    it("should return market order IDs", async function () {
      const { pm, user1, user2 } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await pm.connect(user2).placeLimitOrder(0, 1, ethers.parseUnits("0.30", 18), ethers.parseUnits("30", 18));

      const orderIds = await pm.getMarketOrderIds(0);
      expect(orderIds.length).to.equal(2);
      expect(orderIds[0]).to.equal(0);
      expect(orderIds[1]).to.equal(1);
    });

    it("should return user order IDs", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);

      await pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.40", 18), ethers.parseUnits("50", 18));
      await pm.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("0.45", 18), ethers.parseUnits("30", 18));

      const orderIds = await pm.getUserOrderIds(user1.address);
      expect(orderIds.length).to.equal(2);
    });

    it("should collect taker fee on fill", async function () {
      const { pm, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const feesBefore = await pm.accumulatedFees();

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await pm.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("200", 18));
      await pm.connect(user2).fillLimitOrder(0, amount);

      const feesAfter = await pm.accumulatedFees();
      const expectedFee = ethers.parseUnits("0.5", 18);
      expect(feesAfter - feesBefore).to.equal(expectedFee);
    });

    it("should emit Trade event on fill for K-line integration", async function () {
      const { pm, user1, user2 } = await loadFixture(deployWithMarketFixture);

      const price = ethers.parseUnits("0.50", 18);
      const amount = ethers.parseUnits("100", 18);
      await pm.connect(user1).placeLimitOrder(0, 0, price, amount);

      await pm.connect(user2).splitPosition(0, ethers.parseUnits("200", 18));

      await expect(pm.connect(user2).fillLimitOrder(0, amount))
        .to.emit(pm, "Trade")
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
  //  ERC1155 RECEIVER
  // ============================================================

  describe("ERC1155 Receiver", function () {
    it("should accept ERC1155 tokens", async function () {
      const { pm, user1 } = await loadFixture(deployWithMarketFixture);
      await pm.connect(user1).splitPosition(0, ethers.parseUnits("100", 18));

      const pmAddress = await pm.getAddress();
      await pm.connect(user1).setApprovalForAll(pmAddress, true);

      await expect(
        pm.connect(user1).placeLimitOrder(0, 2, ethers.parseUnits("0.60", 18), ethers.parseUnits("50", 18))
      ).to.not.be.reverted;
    });
  });
});
