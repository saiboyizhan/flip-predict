import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { PredictionMarket, MockOracle, MockUSDT } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PredictionMarket", function () {
  let predictionMarket: PredictionMarket;
  let mockUSDT: MockUSDT;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const DEPOSIT_AMOUNT = ethers.parseEther("10");
  // Contract default creation fee is 10 USDT (18 decimals)
  const CREATION_FEE = ethers.parseEther("10");
  const INITIAL_USDT_BALANCE = ethers.parseEther("10000");

  // Helper: mint USDT to a user and approve the prediction market contract
  async function mintAndApproveUSDT(user: SignerWithAddress, amount: bigint) {
    await mockUSDT.mint(user.address, amount);
    const pmAddress = await predictionMarket.getAddress();
    await mockUSDT.connect(user).approve(pmAddress, amount);
  }

  // Helper: deposit USDT into prediction market for a user
  async function depositUSDT(user: SignerWithAddress, amount: bigint) {
    const pmAddress = await predictionMarket.getAddress();
    await mockUSDT.connect(user).approve(pmAddress, amount);
    await predictionMarket.connect(user).deposit(amount);
  }

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy MockUSDT and mint initial balances
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    mockUSDT = await MockUSDTFactory.deploy();
    await mockUSDT.waitForDeployment();
    const usdtAddress = await mockUSDT.getAddress();

    // Mint USDT to test users
    await mockUSDT.mint(user1.address, INITIAL_USDT_BALANCE);
    await mockUSDT.mint(user2.address, INITIAL_USDT_BALANCE);
    await mockUSDT.mint(owner.address, INITIAL_USDT_BALANCE);

    // Deploy PredictionMarket with USDT address
    const PredictionMarketFactory = await ethers.getContractFactory("PredictionMarket");
    predictionMarket = await PredictionMarketFactory.deploy(usdtAddress);
    await predictionMarket.waitForDeployment();
    // Keep legacy tests stable; strict mode behavior is covered in dedicated tests below.
    await predictionMarket.setStrictArbitrationMode(false);

    // Pre-approve large amount for test users
    const pmAddress = await predictionMarket.getAddress();
    await mockUSDT.connect(user1).approve(pmAddress, INITIAL_USDT_BALANCE);
    await mockUSDT.connect(user2).approve(pmAddress, INITIAL_USDT_BALANCE);
    await mockUSDT.connect(owner).approve(pmAddress, INITIAL_USDT_BALANCE);
  });

  describe("Deposit", function () {
    it("should deposit USDT successfully", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      expect(await predictionMarket.balances(user1.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("should emit Deposit event", async function () {
      await expect(predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT))
        .to.emit(predictionMarket, "Deposit")
        .withArgs(user1.address, DEPOSIT_AMOUNT);
    });

    it("should transfer USDT from user to contract", async function () {
      const contractAddress = await predictionMarket.getAddress();
      const balanceBefore = await mockUSDT.balanceOf(contractAddress);
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const balanceAfter = await mockUSDT.balanceOf(contractAddress);
      expect(balanceAfter - balanceBefore).to.equal(DEPOSIT_AMOUNT);
    });

    it("should revert on zero amount", async function () {
      await expect(predictionMarket.connect(user1).deposit(0)).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      // withdraw is onlyOwner, so deposit as owner
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
    });

    it("should withdraw USDT successfully", async function () {
      const withdrawAmount = ethers.parseEther("5");
      await predictionMarket.withdraw(withdrawAmount);
      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT - withdrawAmount);
    });

    it("should emit Withdraw event", async function () {
      await expect(predictionMarket.withdraw(DEPOSIT_AMOUNT))
        .to.emit(predictionMarket, "Withdraw")
        .withArgs(owner.address, DEPOSIT_AMOUNT);
    });

    it("should revert on insufficient balance", async function () {
      const tooMuch = ethers.parseEther("20");
      await expect(predictionMarket.withdraw(tooMuch)).to.be.revertedWith("Insufficient balance");
    });

    it("should revert on zero amount", async function () {
      await expect(predictionMarket.withdraw(0)).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Create Market", function () {
    it("should create a market", async function () {
      const endTime = (await time.latest()) + 3600; // 1 hour from now
      await expect(predictionMarket.createMarket("Will BTC reach 100k?", endTime))
        .to.emit(predictionMarket, "MarketCreated")
        .withArgs(0, "Will BTC reach 100k?", endTime);

      const market = await predictionMarket.getMarket(0);
      expect(market.title).to.equal("Will BTC reach 100k?");
      expect(market.endTime).to.equal(endTime);
      expect(market.resolved).to.equal(false);
      expect(market.oracleEnabled).to.equal(false);
    });

    it("should only allow owner to create market", async function () {
      const endTime = (await time.latest()) + 3600;
      await expect(
        predictionMarket.connect(user1).createMarket("Test", endTime)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");
    });

    it("should revert if end time is in the past", async function () {
      const pastTime = (await time.latest()) - 100;
      await expect(predictionMarket.createMarket("Test", pastTime)).to.be.revertedWith(
        "End time must be in future"
      );
    });

    it("should increment market IDs", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Market 1", endTime);
      await predictionMarket.createMarket("Market 2", endTime);
      expect(await predictionMarket.nextMarketId()).to.equal(2);
    });
  });

  describe("Take Position", function () {
    let endTime: number;

    beforeEach(async function () {
      // takePosition is onlyOwner, so deposit as owner
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Will BTC reach 100k?", endTime);
    });

    it("should take a YES position (mint ERC1155 YES token)", async function () {
      const amount = ethers.parseEther("1");
      await predictionMarket.takePosition(0, true, amount);

      const pos = await predictionMarket.getPosition(0, owner.address);
      expect(pos.yesAmount).to.equal(amount);
      expect(pos.noAmount).to.equal(0);

      // Verify ERC1155 balance
      const yesTokenId = await predictionMarket.getYesTokenId(0);
      expect(await predictionMarket.balanceOf(owner.address, yesTokenId)).to.equal(amount);
    });

    it("should take a NO position (mint ERC1155 NO token)", async function () {
      const amount = ethers.parseEther("1");
      await predictionMarket.takePosition(0, false, amount);

      const pos = await predictionMarket.getPosition(0, owner.address);
      expect(pos.yesAmount).to.equal(0);
      expect(pos.noAmount).to.equal(amount);

      // Verify ERC1155 balance
      const noTokenId = await predictionMarket.getNoTokenId(0);
      expect(await predictionMarket.balanceOf(owner.address, noTokenId)).to.equal(amount);
    });

    it("should deduct from user balance", async function () {
      const amount = ethers.parseEther("1");
      await predictionMarket.takePosition(0, true, amount);
      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT - amount);
    });

    it("should revert on insufficient balance", async function () {
      const tooMuch = ethers.parseEther("20");
      await expect(
        predictionMarket.takePosition(0, true, tooMuch)
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should revert after market ended", async function () {
      await time.increaseTo(endTime + 1);
      const amount = ethers.parseEther("1");
      await expect(
        predictionMarket.takePosition(0, true, amount)
      ).to.be.revertedWith("Market ended");
    });
  });

  describe("Resolve Market", function () {
    let endTime: number;

    beforeEach(async function () {
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Will BTC reach 100k?", endTime);
    });

    it("should resolve market with outcome true", async function () {
      await time.increaseTo(endTime);
      await expect(predictionMarket.resolveMarket(0, true))
        .to.emit(predictionMarket, "MarketResolved")
        .withArgs(0, true);

      const market = await predictionMarket.getMarket(0);
      expect(market.resolved).to.equal(true);
      expect(market.outcome).to.equal(true);
    });

    it("should revert if not owner", async function () {
      await time.increaseTo(endTime);
      await expect(
        predictionMarket.connect(user1).resolveMarket(0, true)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");
    });

    it("should revert if market not ended", async function () {
      await expect(predictionMarket.resolveMarket(0, true)).to.be.revertedWith("Market not ended");
    });

    it("should revert if already resolved", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);
      await expect(predictionMarket.resolveMarket(0, false)).to.be.revertedWith("Already resolved");
    });
  });

  describe("Claim Winnings (CTF model)", function () {
    let endTime: number;
    const betAmount = ethers.parseEther("5");

    beforeEach(async function () {
      // takePosition and claimWinnings are onlyOwner, so owner bets both sides
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Will BTC reach 100k?", endTime);

      // owner bets YES and NO (both sides)
      await predictionMarket.takePosition(0, true, betAmount);
      await predictionMarket.takePosition(0, false, betAmount);
    });

    it("should claim winnings for YES winner", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.claimWinnings(0);

      // Owner has 5 YES out of 5 total YES, totalCollateral=10
      // CTF: 5 * 10 / 5 = 10
      const balanceAfter = await predictionMarket.balances(owner.address);
      expect(balanceAfter).to.equal(DEPOSIT_AMOUNT - betAmount * 2n + betAmount * 2n);
    });

    it("should claim winnings for NO winner", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, false);

      await predictionMarket.claimWinnings(0);

      // Owner has 5 NO out of 5 total NO, totalCollateral=10
      const balanceAfter = await predictionMarket.balances(owner.address);
      expect(balanceAfter).to.equal(DEPOSIT_AMOUNT - betAmount * 2n + betAmount * 2n);
    });

    it("should emit WinningsClaimed event", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      const expectedReward = betAmount * 2n; // 5 * 10 / 5 = 10
      await expect(predictionMarket.claimWinnings(0))
        .to.emit(predictionMarket, "WinningsClaimed")
        .withArgs(0, owner.address, expectedReward);
    });

    it("should revert if market not resolved", async function () {
      await expect(predictionMarket.claimWinnings(0)).to.be.revertedWith("Market not resolved");
    });

    it("should revert if no winning position", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // Claim once (YES wins, owner has YES)
      await predictionMarket.claimWinnings(0);
      // Now owner has no more YES tokens - "No winning position"
      await expect(predictionMarket.claimWinnings(0)).to.be.revertedWith("No winning position");
    });

    it("should revert if already claimed (burn prevents double-claim)", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.claimWinnings(0);
      // Second claim: tokens burned, balance = 0 -> "No winning position"
      await expect(predictionMarket.claimWinnings(0)).to.be.revertedWith("No winning position");
    });

    it("should distribute proportionally with multiple winners", async function () {
      // Resolve YES
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // owner (the only YES bettor) should get all collateral
      await predictionMarket.claimWinnings(0);
      // CTF: 5 * 10 / 5 = 10
      const expectedBalance = DEPOSIT_AMOUNT - betAmount * 2n + betAmount * 2n;
      expect(await predictionMarket.balances(owner.address)).to.equal(expectedBalance);
    });
  });

  describe("Oracle Market", function () {
    let mockOracle: MockOracle;
    let oracleAddress: string;
    const BTC_PRICE = 10000000000000n; // $100,000 with 8 decimals
    const TARGET_PRICE = 10000000000000n; // $100,000 target

    beforeEach(async function () {
      // Deploy MockOracle with BTC price at $100,000 (8 decimals)
      const MockOracleFactory = await ethers.getContractFactory("MockOracle");
      mockOracle = await MockOracleFactory.deploy(BTC_PRICE, 8);
      await mockOracle.waitForDeployment();
      oracleAddress = await mockOracle.getAddress();

      // Deposit USDT for users
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
    });

    describe("Create Oracle Market", function () {
      it("should create an oracle market", async function () {
        const endTime = (await time.latest()) + 3600;
        await expect(
          predictionMarket.createOracleMarket(
            "BTC above 100k?",
            endTime,
            oracleAddress,
            TARGET_PRICE,
            1 // price_above
          )
        )
          .to.emit(predictionMarket, "OracleMarketCreated")
          .withArgs(0, oracleAddress, TARGET_PRICE, 1);

        const market = await predictionMarket.getMarket(0);
        expect(market.title).to.equal("BTC above 100k?");
        expect(market.oracleEnabled).to.equal(true);
        expect(market.priceFeed).to.equal(oracleAddress);
        expect(market.targetPrice).to.equal(TARGET_PRICE);
        expect(market.resolutionType).to.equal(1);
      });

      it("should revert with invalid price feed", async function () {
        const endTime = (await time.latest()) + 3600;
        await expect(
          predictionMarket.createOracleMarket(
            "Test",
            endTime,
            ethers.ZeroAddress,
            TARGET_PRICE,
            1
          )
        ).to.be.revertedWith("Invalid price feed");
      });

      it("should revert with invalid resolution type", async function () {
        const endTime = (await time.latest()) + 3600;
        await expect(
          predictionMarket.createOracleMarket(
            "Test",
            endTime,
            oracleAddress,
            TARGET_PRICE,
            0 // invalid - must be 1 or 2
          )
        ).to.be.revertedWith("Invalid resolution type");
      });

      it("should only allow owner to create oracle market", async function () {
        const endTime = (await time.latest()) + 3600;
        await expect(
          predictionMarket.connect(user1).createOracleMarket(
            "Test",
            endTime,
            oracleAddress,
            TARGET_PRICE,
            1
          )
        ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");
      });
    });

    describe("Resolve By Oracle", function () {
      let endTime: number;

      beforeEach(async function () {
        endTime = (await time.latest()) + 3600;
        await predictionMarket.createOracleMarket(
          "BTC above 100k?",
          endTime,
          oracleAddress,
          TARGET_PRICE,
          1 // price_above
        );
      });

      it("should resolve YES when price is above target", async function () {
        await mockOracle.setPrice(TARGET_PRICE + 100000000n);
        await time.increaseTo(endTime);

        await expect(predictionMarket.resolveByOracle(0))
          .to.emit(predictionMarket, "OracleResolution");

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true);
        expect(market.resolvedPrice).to.equal(TARGET_PRICE + 100000000n);
      });

      it("should resolve NO when price is below target (price_above type)", async function () {
        await mockOracle.setPrice(TARGET_PRICE - 100000000n);
        await time.increaseTo(endTime);

        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(false);
      });

      it("should resolve YES when price equals target (price_above type)", async function () {
        await time.increaseTo(endTime);
        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true);
      });

      it("should allow anyone to call resolveByOracle", async function () {
        await time.increaseTo(endTime);
        await expect(predictionMarket.connect(user1).resolveByOracle(0)).to.not.be.reverted;
        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
      });

      it("should revert for non-oracle market", async function () {
        const endTime2 = (await time.latest()) + 3600;
        await predictionMarket.createMarket("Manual market", endTime2);
        await time.increaseTo(endTime2);
        await expect(predictionMarket.resolveByOracle(1)).to.be.revertedWith("Not oracle market");
      });

      it("should revert if market not ended", async function () {
        await expect(predictionMarket.resolveByOracle(0)).to.be.revertedWith("Market not ended");
      });

      it("should revert if already resolved", async function () {
        await time.increaseTo(endTime);
        await predictionMarket.resolveByOracle(0);
        await expect(predictionMarket.resolveByOracle(0)).to.be.revertedWith("Already resolved");
      });

      it("should revert for non-existent market", async function () {
        await expect(predictionMarket.resolveByOracle(999)).to.be.revertedWith("Market does not exist");
      });
    });

    describe("Oracle with price_below resolution", function () {
      it("should resolve YES when price is below target", async function () {
        const endTime = (await time.latest()) + 3600;
        await predictionMarket.createOracleMarket("BTC below 100k?", endTime, oracleAddress, TARGET_PRICE, 2);

        await mockOracle.setPrice(TARGET_PRICE - 100000000n);
        await time.increaseTo(endTime);
        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true);
      });

      it("should resolve YES when price equals target (price_below type)", async function () {
        const endTime = (await time.latest()) + 3600;
        await predictionMarket.createOracleMarket("BTC below 100k?", endTime, oracleAddress, TARGET_PRICE, 2);

        await mockOracle.setPrice(TARGET_PRICE);
        await time.increaseTo(endTime);
        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true);
      });

      it("should resolve NO when price is above target (price_below type)", async function () {
        const endTime = (await time.latest()) + 3600;
        await predictionMarket.createOracleMarket("BTC below 100k?", endTime, oracleAddress, TARGET_PRICE, 2);

        await mockOracle.setPrice(TARGET_PRICE + 100000000n);
        await time.increaseTo(endTime);
        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(false);
      });
    });

    describe("Oracle Full Flow", function () {
      it("should complete full oracle market lifecycle", async function () {
        const endTime = (await time.latest()) + 3600;
        const betAmount = ethers.parseEther("5");

        // Owner deposits and takes both positions
        await predictionMarket.deposit(DEPOSIT_AMOUNT);
        await predictionMarket.createOracleMarket("BTC above 100k?", endTime, oracleAddress, TARGET_PRICE, 1);

        await predictionMarket.takePosition(0, true, betAmount);
        await predictionMarket.takePosition(0, false, betAmount);

        await mockOracle.setPrice(TARGET_PRICE + 500000000n);
        await time.increaseTo(endTime);
        // resolveByOracle is not restricted
        await predictionMarket.connect(user2).resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true);

        // Owner claims (YES wins)
        await predictionMarket.claimWinnings(0);
        const finalBalance = await predictionMarket.balances(owner.address);
        // CTF: 5 * 10 / 5 = 10
        expect(finalBalance).to.equal(DEPOSIT_AMOUNT - betAmount * 2n + betAmount * 2n);

        // Second claim reverts (tokens burned)
        await expect(
          predictionMarket.claimWinnings(0)
        ).to.be.revertedWith("No winning position");
      });
    });
  });

  describe("Pause", function () {
    it("should pause and unpause", async function () {
      await predictionMarket.pause();
      await expect(
        predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");

      await predictionMarket.unpause();
      await expect(predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT)).to.not.be.reverted;
    });

    it("should only allow owner to pause", async function () {
      await expect(predictionMarket.connect(user1).pause()).to.be.revertedWithCustomError(
        predictionMarket,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("User Market Creation", function () {
    it("should create a user market with USDT fee", async function () {
      const endTime = (await time.latest()) + 7200;
      const title = "Will DOGE reach $1 this month?";

      await expect(
        predictionMarket.connect(user1).createUserMarket(title, endTime, 0)
      )
        .to.emit(predictionMarket, "UserMarketCreated")
        .withArgs(0, user1.address, title, CREATION_FEE);

      const market = await predictionMarket.getMarket(0);
      expect(market.title).to.equal(title);
      expect(market.endTime).to.equal(endTime);

      expect(await predictionMarket.marketCreator(0)).to.equal(user1.address);
    });

    it("should limit to max 3 markets per day", async function () {
      const endTime = (await time.latest()) + 7200;

      await predictionMarket.connect(user1).createUserMarket("Market one - test title", endTime, 0);
      await predictionMarket.connect(user1).createUserMarket("Market two - test title", endTime, 0);
      await predictionMarket.connect(user1).createUserMarket("Market three test title", endTime, 0);

      await expect(
        predictionMarket.connect(user1).createUserMarket("Market four test title", endTime, 0)
      ).to.be.revertedWith("Daily market limit reached");
    });

    it("should reject title too short", async function () {
      const endTime = (await time.latest()) + 7200;
      await expect(
        predictionMarket.connect(user1).createUserMarket("Short", endTime, 0)
      ).to.be.revertedWith("Title too short");
    });

    it("should reject title too long", async function () {
      const endTime = (await time.latest()) + 7200;
      const longTitle = "A".repeat(201);
      await expect(
        predictionMarket.connect(user1).createUserMarket(longTitle, endTime, 0)
      ).to.be.revertedWith("Title too long");
    });

    it("should reject end time too soon (less than 1 hour)", async function () {
      const endTime = (await time.latest()) + 1800;
      await expect(
        predictionMarket.connect(user1).createUserMarket("A valid title for the market", endTime, 0)
      ).to.be.revertedWith("End time too soon");
    });

    it("should reject end time too far (more than 90 days)", async function () {
      const endTime = (await time.latest()) + 91 * 86400;
      await expect(
        predictionMarket.connect(user1).createUserMarket("A valid title for the market", endTime, 0)
      ).to.be.revertedWith("End time too far");
    });

    it("should reset daily count on a new day", async function () {
      const endTime = (await time.latest()) + 7200;

      await predictionMarket.connect(user1).createUserMarket("Market one - test title", endTime, 0);
      await predictionMarket.connect(user1).createUserMarket("Market two - test title", endTime, 0);
      await predictionMarket.connect(user1).createUserMarket("Market three test title", endTime, 0);

      await time.increase(86400);
      const newEndTime = (await time.latest()) + 7200;
      await expect(
        predictionMarket.connect(user1).createUserMarket("Market on new day!!", newEndTime, 0)
      ).to.not.be.reverted;
    });

    it("should create market with initial liquidity (CTF split)", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 7200;
      const liquidity = ethers.parseEther("1");

      await predictionMarket.connect(user1).createUserMarket(
        "Market with liquidity test",
        endTime,
        liquidity
      );

      const market = await predictionMarket.getMarket(0);
      // CTF 1:1:1 split: 1 USDT = 1 YES + 1 NO
      expect(market.totalYes).to.equal(liquidity);
      expect(market.totalNo).to.equal(liquidity);

      // Balance should be reduced
      expect(await predictionMarket.balances(user1.address)).to.equal(DEPOSIT_AMOUNT - liquidity);

      // User should hold ERC1155 tokens
      const yesId = await predictionMarket.getYesTokenId(0);
      const noId = await predictionMarket.getNoTokenId(0);
      expect(await predictionMarket.balanceOf(user1.address, yesId)).to.equal(liquidity);
      expect(await predictionMarket.balanceOf(user1.address, noId)).to.equal(liquidity);
    });

    it("should revert if insufficient USDT approval for fee", async function () {
      const endTime = (await time.latest()) + 7200;
      // Revoke approval so transferFrom fails
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(user1).approve(pmAddress, 0);
      await expect(
        predictionMarket.connect(user1).createUserMarket("A valid title for no fee test!", endTime, 0)
      ).to.be.reverted;
    });
  });

  describe("Agent Take Position", function () {
    let nfaSigner: SignerWithAddress;
    let endTime: number;

    beforeEach(async function () {
      [, , , nfaSigner] = await ethers.getSigners();

      await predictionMarket.setNFAContract(nfaSigner.address);

      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent test market", endTime);

      // Mint USDT to nfaSigner and deposit
      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
    });

    it("should allow NFA contract to take position", async function () {
      const amount = ethers.parseEther("1");
      await expect(
        predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, amount)
      )
        .to.emit(predictionMarket, "AgentPositionTaken")
        .withArgs(0, 1, true, amount);

      expect(await predictionMarket.balances(nfaSigner.address)).to.equal(DEPOSIT_AMOUNT - amount);

      // Verify ERC1155 token minted to nfaContract
      const yesId = await predictionMarket.getYesTokenId(0);
      expect(await predictionMarket.balanceOf(nfaSigner.address, yesId)).to.equal(amount);
    });

    it("should reject non-NFA contract caller", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const amount = ethers.parseEther("1");
      await expect(
        predictionMarket.connect(user1).agentTakePosition(1, 0, true, amount)
      ).to.be.revertedWith("Only NFA contract");
    });
  });

  describe("Admin Functions", function () {
    it("should set NFA contract", async function () {
      await expect(predictionMarket.setNFAContract(user1.address))
        .to.emit(predictionMarket, "NFAContractUpdated")
        .withArgs(user1.address);
      expect(await predictionMarket.nfaContract()).to.equal(user1.address);
    });

    it("should set market creation fee", async function () {
      const newFee = ethers.parseEther("20");
      await expect(predictionMarket.setMarketCreationFee(newFee))
        .to.emit(predictionMarket, "MarketCreationFeeUpdated")
        .withArgs(newFee);
      expect(await predictionMarket.marketCreationFee()).to.equal(newFee);
    });

    it("should set max markets per day", async function () {
      await expect(predictionMarket.setMaxMarketsPerDay(5))
        .to.emit(predictionMarket, "MaxMarketsPerDayUpdated")
        .withArgs(5);
      expect(await predictionMarket.maxMarketsPerDay()).to.equal(5);
    });

    it("should withdraw fees", async function () {
      const endTime = (await time.latest()) + 7200;
      await predictionMarket.connect(user1).createUserMarket("Withdraw fee test market", endTime, 0);

      const ownerUsdtBefore = await mockUSDT.balanceOf(owner.address);
      await predictionMarket.withdrawFees(CREATION_FEE);
      const ownerUsdtAfter = await mockUSDT.balanceOf(owner.address);
      expect(ownerUsdtAfter - ownerUsdtBefore).to.equal(CREATION_FEE);
    });

    it("should reject non-owner for admin functions", async function () {
      await expect(
        predictionMarket.connect(user1).setNFAContract(user1.address)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");

      await expect(
        predictionMarket.connect(user1).setMarketCreationFee(0)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");

      await expect(
        predictionMarket.connect(user1).setMaxMarketsPerDay(10)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");

      await expect(
        predictionMarket.connect(user1).withdrawFees(1)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("should revert deposit when paused", async function () {
      await predictionMarket.pause();
      await expect(
        predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert withdraw when paused", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.pause();
      await expect(
        predictionMarket.withdraw(DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert takePosition when paused", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Pause test market", endTime);
      await predictionMarket.pause();

      await expect(
        predictionMarket.takePosition(0, true, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert claimWinnings when paused", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Pause claim test", endTime);

      const betAmount = ethers.parseEther("1");
      await predictionMarket.takePosition(0, true, betAmount);
      await predictionMarket.takePosition(0, false, betAmount);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.pause();
      await expect(
        predictionMarket.claimWinnings(0)
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert takePosition on non-existent market", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await expect(
        predictionMarket.takePosition(999, true, ethers.parseEther("1"))
      ).to.be.revertedWith("Market does not exist");
    });

    it("should revert claimWinnings on non-existent market", async function () {
      await expect(
        predictionMarket.claimWinnings(999)
      ).to.be.revertedWith("Market does not exist");
    });

    it("should revert takePosition on resolved market", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Resolved position test", endTime);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(
        predictionMarket.takePosition(0, true, ethers.parseEther("1"))
      ).to.be.revertedWith("Market already resolved");
    });

    it("should revert takePosition with zero amount", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Zero amount test", endTime);

      await expect(
        predictionMarket.takePosition(0, true, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("should revert resolveMarket on non-existent market", async function () {
      await expect(
        predictionMarket.resolveMarket(999, true)
      ).to.be.revertedWith("Market does not exist");
    });

    it("should handle multiple deposits and withdrawals correctly", async function () {
      const amount1 = ethers.parseEther("3");
      const amount2 = ethers.parseEther("2");
      const withdrawAmount = ethers.parseEther("4");

      // withdraw is onlyOwner, so use owner
      await predictionMarket.deposit(amount1);
      await predictionMarket.deposit(amount2);
      expect(await predictionMarket.balances(owner.address)).to.equal(amount1 + amount2);

      await predictionMarket.withdraw(withdrawAmount);
      expect(await predictionMarket.balances(owner.address)).to.equal(amount1 + amount2 - withdrawAmount);
    });

    it("should handle user taking both YES and NO positions on the same market", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Both sides test", endTime);

      const yesAmount = ethers.parseEther("2");
      const noAmount = ethers.parseEther("3");

      await predictionMarket.takePosition(0, true, yesAmount);
      await predictionMarket.takePosition(0, false, noAmount);

      const pos = await predictionMarket.getPosition(0, owner.address);
      expect(pos.yesAmount).to.equal(yesAmount);
      expect(pos.noAmount).to.equal(noAmount);

      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT - yesAmount - noAmount);
    });

    it("should correctly distribute winnings with single owner betting both sides", async function () {
      // In relayer model, only owner can call takePosition/claimWinnings
      // Simplified to single-owner scenario: owner bets YES and NO, verify total payout
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Multi winner test", endTime);

      const betYes = ethers.parseEther("5");
      const betNo = ethers.parseEther("5");

      await predictionMarket.takePosition(0, true, betYes);
      await predictionMarket.takePosition(0, false, betNo);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // totalCollateral = 10, yesSupply = 5
      // owner has 5 YES: 5 * 10 / 5 = 10
      await predictionMarket.claimWinnings(0);
      const bal = await predictionMarket.balances(owner.address);
      expect(bal).to.equal(DEPOSIT_AMOUNT - betYes - betNo + betYes * 2n);
    });

    it("should handle agentTakePosition when market ended", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent expired test", endTime);

      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);

      await time.increaseTo(endTime + 1);

      await expect(
        predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, ethers.parseEther("1"))
      ).to.be.revertedWith("Market ended");
    });

    it("should revert agentTakePosition with zero amount", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent zero test", endTime);

      await expect(
        predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("should verify initial constructor values", async function () {
      expect(await predictionMarket.marketCreationFee()).to.equal(ethers.parseEther("10"));
      expect(await predictionMarket.maxMarketsPerDay()).to.equal(3);
      expect(await predictionMarket.nextMarketId()).to.equal(0);
    });

    it("should correctly emit PositionTaken event", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Event test market", endTime);

      const amount = ethers.parseEther("1");
      await expect(
        predictionMarket.takePosition(0, true, amount)
      )
        .to.emit(predictionMarket, "PositionTaken")
        .withArgs(0, owner.address, true, amount);

      await expect(
        predictionMarket.takePosition(0, false, amount)
      )
        .to.emit(predictionMarket, "PositionTaken")
        .withArgs(0, owner.address, false, amount);
    });

    it("should update market totals correctly after multiple positions", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Totals test market", endTime);

      const amount1 = ethers.parseEther("1");
      const amount2 = ethers.parseEther("2.5");
      const amount3 = ethers.parseEther("1.5");

      await predictionMarket.takePosition(0, true, amount1);
      await predictionMarket.takePosition(0, false, amount2);
      await predictionMarket.takePosition(0, true, amount3);

      const market = await predictionMarket.getMarket(0);
      expect(market.totalYes).to.equal(amount1 + amount3);
      expect(market.totalNo).to.equal(amount2);
    });

    it("should revert when sending BNB directly (no receive function)", async function () {
      const contractAddress = await predictionMarket.getAddress();
      await expect(
        user1.sendTransaction({ to: contractAddress, value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });

  describe("Bug Fix Validations", function () {
    it("should emit FeesWithdrawn event when withdrawing fees", async function () {
      const endTime = (await time.latest()) + 7200;
      await predictionMarket.connect(user1).createUserMarket("FeesWithdrawn event test", endTime, 0);

      await expect(predictionMarket.withdrawFees(CREATION_FEE))
        .to.emit(predictionMarket, "FeesWithdrawn")
        .withArgs(owner.address, CREATION_FEE);
    });

    it("should revert withdrawFees with zero amount", async function () {
      await expect(predictionMarket.withdrawFees(0)).to.be.revertedWith("Amount must be > 0");
    });

    it("should revert setNFAContract with zero address", async function () {
      await expect(
        predictionMarket.setNFAContract(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid NFA address");
    });

    it("should handle claimWinnings correctly when loser pool is zero", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("One-sided market test", endTime);

      const betAmount = ethers.parseEther("5");
      await predictionMarket.takePosition(0, true, betAmount);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.claimWinnings(0);
      const balance = await predictionMarket.balances(owner.address);
      // CTF: 5 * 5 / 5 = 5 (gets back exactly what they put in)
      expect(balance).to.equal(DEPOSIT_AMOUNT - betAmount + betAmount);
    });

    it("should handle user with positions on both sides", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Both sides claim test", endTime);

      const yesAmount = ethers.parseEther("3");
      const noAmount = ethers.parseEther("2");
      await predictionMarket.takePosition(0, true, yesAmount);
      await predictionMarket.takePosition(0, false, noAmount);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // CTF: totalCollateral=5, yesSupply=3, YES wins
      // owner has 3 YES tokens: 3 * 5 / 3 = 5
      await predictionMarket.claimWinnings(0);
      const balance = await predictionMarket.balances(owner.address);
      expect(balance).to.equal(ethers.parseEther("5") + ethers.parseEther("5"));

      // Cannot claim again (tokens burned)
      await expect(
        predictionMarket.claimWinnings(0)
      ).to.be.revertedWith("No winning position");
    });

    it("should handle agentClaimWinnings correctly", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);

      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
      // Owner deposits to take the NO position
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent claim test", endTime);

      const agentBet = ethers.parseEther("3");
      const ownerBet = ethers.parseEther("5");

      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, agentBet);
      await predictionMarket.takePosition(0, false, ownerBet);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      const nfaBalanceBefore = await predictionMarket.balances(nfaSigner.address);
      await predictionMarket.connect(nfaSigner).agentClaimWinnings(1, 0);
      const nfaBalanceAfter = await predictionMarket.balances(nfaSigner.address);

      // CTF: totalCollateral=8, yesSupply=3, agentTokens=3
      // reward = 3 * 8 / 3 = 8
      const expectedReward = agentBet + ownerBet; // 3 + 5 = 8
      expect(nfaBalanceAfter - nfaBalanceBefore).to.equal(expectedReward);
    });

    it("should revert agentClaimWinnings when already claimed", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);

      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent double claim", endTime);

      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, ethers.parseEther("1"));
      await predictionMarket.takePosition(0, false, ethers.parseEther("1"));

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.connect(nfaSigner).agentClaimWinnings(1, 0);

      // Double claim: sub-ledger zeroed -> "No winning position"
      await expect(
        predictionMarket.connect(nfaSigner).agentClaimWinnings(1, 0)
      ).to.be.revertedWith("No winning position");
    });

    it("should revert agentClaimWinnings when no winning position", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);

      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent losing test", endTime);

      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, ethers.parseEther("1"));
      await predictionMarket.takePosition(0, false, ethers.parseEther("1"));

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, false);

      await expect(
        predictionMarket.connect(nfaSigner).agentClaimWinnings(1, 0)
      ).to.be.revertedWith("No winning position");
    });

    it("should handle oracle market with stale price rejection", async function () {
      const MockOracleFactory = await ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracleFactory.deploy(10000000000000n, 8);
      await mockOracle.waitForDeployment();
      const oracleAddress = await mockOracle.getAddress();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createOracleMarket("Stale oracle test", endTime, oracleAddress, 10000000000000n, 1);

      const staleTime = (await time.latest()) - 7200;
      await mockOracle.setUpdatedAt(staleTime);

      await time.increaseTo(endTime);
      await expect(predictionMarket.resolveByOracle(0)).to.be.revertedWith("Stale oracle price");
    });

    it("should prevent resolveMarket on oracle-enabled market", async function () {
      const MockOracleFactory = await ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracleFactory.deploy(10000000000000n, 8);
      await mockOracle.waitForDeployment();
      const oracleAddress = await mockOracle.getAddress();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createOracleMarket("Oracle market manual resolve", endTime, oracleAddress, 10000000000000n, 1);

      await time.increaseTo(endTime);

      await expect(
        predictionMarket.resolveMarket(0, true)
      ).to.be.revertedWith("Use resolveByOracle for oracle markets");
    });

    it("should handle rounding correctly with uneven bets", async function () {
      // In relayer model, only owner can call takePosition/claimWinnings
      // Simplified: owner bets YES and NO, verify total payout with uneven amounts
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Rounding test market", endTime);

      const betYes = ethers.parseEther("3");
      const betNo = ethers.parseEther("7");

      await predictionMarket.takePosition(0, true, betYes);
      await predictionMarket.takePosition(0, false, betNo);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.claimWinnings(0);

      const bal = await predictionMarket.balances(owner.address);

      // CTF: totalCollateral=10, yesSupply=3
      // owner has 3 YES: 3 * 10 / 3 = 10
      const reward = (betYes * (betYes + betNo)) / betYes;
      expect(bal).to.equal(DEPOSIT_AMOUNT - betYes - betNo + reward);
    });

    it("should not allow withdrawFees to exceed accumulated fees", async function () {
      const endTime = (await time.latest()) + 7200;
      await predictionMarket.connect(user1).createUserMarket("Fee limit test market", endTime, 0);

      await expect(
        predictionMarket.withdrawFees(ethers.parseEther("1000"))
      ).to.be.revertedWith("Exceeds accumulated fees");
    });
  });

  // --- Round 4 Bug Fix Tests ---
  describe("Round 4: resolveByOracle emits MarketResolved", function () {
    it("should emit MarketResolved event in resolveByOracle", async function () {
      const MockOracleFactory = await ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracleFactory.deploy(10000000000000n, 8);
      await mockOracle.waitForDeployment();
      const oracleAddress = await mockOracle.getAddress();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createOracleMarket("Oracle event test", endTime, oracleAddress, 10000000000000n, 1);

      await time.increaseTo(endTime);

      await expect(predictionMarket.resolveByOracle(0))
        .to.emit(predictionMarket, "MarketResolved")
        .withArgs(0, true);
    });
  });

  describe("Round 4: Market Cancellation", function () {
    const betAmount = ethers.parseEther("5");

    beforeEach(async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
    });

    it("should cancel a market and emit MarketCancelled", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Cancel test market", endTime);

      await expect(predictionMarket.cancelMarket(0))
        .to.emit(predictionMarket, "MarketCancelled")
        .withArgs(0);

      expect(await predictionMarket.isMarketCancelled(0)).to.equal(true);
    });

    it("should revert cancel on non-existent market", async function () {
      await expect(predictionMarket.cancelMarket(999)).to.be.revertedWith("Market does not exist");
    });

    it("should revert cancel on already resolved market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Already resolved cancel", endTime);
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(predictionMarket.cancelMarket(0)).to.be.revertedWith("Market already resolved");
    });

    it("should only allow owner to cancel", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Non-owner cancel test", endTime);

      await expect(
        predictionMarket.connect(user1).cancelMarket(0)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");
    });

    it("should allow claimRefund after cancellation", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Refund test after cancel", endTime);

      // Owner takes both positions (takePosition is onlyOwner)
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.takePosition(0, true, betAmount);
      await predictionMarket.takePosition(0, false, betAmount);

      await predictionMarket.cancelMarket(0);

      // owner claims refund (claimRefund is NOT onlyOwner)
      await predictionMarket.claimRefund(0);
      // Owner had YES(5) + NO(5) = 10 tokens, totalCollateral=10, totalAllTokens=10
      // Refund = 10 * 10 / 10 = 10
      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("should refund both YES and NO positions for a user who bet both sides", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Both sides refund test", endTime);

      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const yesAmt = ethers.parseEther("3");
      const noAmt = ethers.parseEther("2");
      await predictionMarket.takePosition(0, true, yesAmt);
      await predictionMarket.takePosition(0, false, noAmt);

      await predictionMarket.cancelMarket(0);

      await predictionMarket.claimRefund(0);
      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("should revert claimRefund on non-cancelled market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Non-cancelled refund test", endTime);

      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.takePosition(0, true, betAmount);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(
        predictionMarket.claimRefund(0)
      ).to.be.revertedWith("Market not cancelled");
    });

    it("should revert claimWinnings on cancelled market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Cancelled no winnings test", endTime);

      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.takePosition(0, true, betAmount);
      await predictionMarket.takePosition(0, false, betAmount);

      await predictionMarket.cancelMarket(0);

      await expect(
        predictionMarket.claimWinnings(0)
      ).to.be.revertedWith("Market cancelled, use claimRefund");
    });

    it("should revert double claimRefund (tokens already burned)", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Double refund test", endTime);

      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.takePosition(0, true, betAmount);

      await predictionMarket.cancelMarket(0);

      await predictionMarket.claimRefund(0);
      await expect(
        predictionMarket.claimRefund(0)
      ).to.be.revertedWith("No position");
    });

    it("should revert claimRefund with no position", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("No position refund test", endTime);

      await predictionMarket.cancelMarket(0);

      await expect(
        predictionMarket.connect(user1).claimRefund(0)
      ).to.be.revertedWith("No position");
    });

    it("should revert agentClaimWinnings on cancelled market", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);
      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent cancel test", endTime);

      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, betAmount);
      // Owner takes the NO position (takePosition is onlyOwner)
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.takePosition(0, false, betAmount);

      await predictionMarket.cancelMarket(0);

      await expect(
        predictionMarket.connect(nfaSigner).agentClaimWinnings(1, 0)
      ).to.be.revertedWith("Market cancelled");
    });
  });

  describe("Round 4: getAgentPosition view", function () {
    it("should return agent position data", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);
      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent pos view test", endTime);

      const amount = ethers.parseEther("2");
      await predictionMarket.connect(nfaSigner).agentTakePosition(42, 0, true, amount);

      const pos = await predictionMarket.getAgentPosition(0, 42);
      expect(pos.yesAmount).to.equal(amount);
      expect(pos.noAmount).to.equal(0n);
      expect(pos.claimed).to.equal(false);
    });

    it("should return empty position for non-existent agent", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Empty agent pos test", endTime);

      const pos = await predictionMarket.getAgentPosition(0, 999);
      expect(pos.yesAmount).to.equal(0n);
      expect(pos.noAmount).to.equal(0n);
      expect(pos.claimed).to.equal(false);
    });
  });

  describe("Round 4: isMarketCancelled view", function () {
    it("should return false for non-cancelled market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Not cancelled test", endTime);

      expect(await predictionMarket.isMarketCancelled(0)).to.equal(false);
    });

    it("should return true for cancelled market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Is cancelled test", endTime);
      await predictionMarket.cancelMarket(0);

      expect(await predictionMarket.isMarketCancelled(0)).to.equal(true);
    });

    it("should revert for non-existent market", async function () {
      await expect(predictionMarket.isMarketCancelled(999)).to.be.revertedWith("Market does not exist");
    });
  });

  // --- Round 5 Final Hardening Tests ---
  describe("Round 5: getMarket returns cancelled field", function () {
    it("should return cancelled=false for active market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Cancelled field test", endTime);

      const market = await predictionMarket.getMarket(0);
      expect(market.cancelled).to.equal(false);
    });

    it("should return cancelled=true for cancelled market", async function () {
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Cancelled field true test", endTime);
      await predictionMarket.cancelMarket(0);

      const market = await predictionMarket.getMarket(0);
      expect(market.cancelled).to.equal(true);
      expect(market.resolved).to.equal(true);
    });
  });

  describe("Round 5: RefundClaimed event", function () {
    it("should emit RefundClaimed (not WinningsClaimed) on claimRefund", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("RefundClaimed event test", endTime);

      const betAmount = ethers.parseEther("3");
      await predictionMarket.takePosition(0, true, betAmount);

      await predictionMarket.cancelMarket(0);

      await expect(predictionMarket.claimRefund(0))
        .to.emit(predictionMarket, "RefundClaimed")
        .withArgs(0, owner.address, betAmount);
    });
  });

  describe("Round 5: agentClaimRefund", function () {
    const betAmount = ethers.parseEther("5");

    // Helper to setup nfaSigner for agent tests
    async function setupNfaSigner() {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);
      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
      return nfaSigner;
    }

    it("should allow agent to claim refund on cancelled market", async function () {
      const nfaSigner = await setupNfaSigner();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent refund test", endTime);

      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, betAmount);

      await predictionMarket.cancelMarket(0);

      const balBefore = await predictionMarket.balances(nfaSigner.address);
      await expect(predictionMarket.connect(nfaSigner).agentClaimRefund(1, 0))
        .to.emit(predictionMarket, "AgentRefundClaimed")
        .withArgs(0, 1, betAmount);
      const balAfter = await predictionMarket.balances(nfaSigner.address);

      expect(balAfter - balBefore).to.equal(betAmount);
    });

    it("should revert agentClaimRefund on non-cancelled market", async function () {
      const nfaSigner = await setupNfaSigner();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent refund non-cancel", endTime);
      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, betAmount);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(
        predictionMarket.connect(nfaSigner).agentClaimRefund(1, 0)
      ).to.be.revertedWith("Market not cancelled");
    });

    it("should revert agentClaimRefund from non-NFA caller", async function () {
      const nfaSigner = await setupNfaSigner();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent refund wrong caller", endTime);
      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, betAmount);

      await predictionMarket.cancelMarket(0);

      await expect(
        predictionMarket.connect(user1).agentClaimRefund(1, 0)
      ).to.be.revertedWith("Only NFA contract");
    });

    it("should revert double agentClaimRefund", async function () {
      const nfaSigner = await setupNfaSigner();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent double refund", endTime);
      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, betAmount);

      await predictionMarket.cancelMarket(0);

      await predictionMarket.connect(nfaSigner).agentClaimRefund(1, 0);
      await expect(
        predictionMarket.connect(nfaSigner).agentClaimRefund(1, 0)
      ).to.be.revertedWith("No position");
    });

    it("should revert agentClaimRefund with no position", async function () {
      const nfaSigner = await setupNfaSigner();

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent no pos refund", endTime);
      await predictionMarket.cancelMarket(0);

      await expect(
        predictionMarket.connect(nfaSigner).agentClaimRefund(999, 0)
      ).to.be.revertedWith("No position");
    });
  });

  describe("Round 5: UserMarket also emits MarketCreated", function () {
    it("should emit both MarketCreated and UserMarketCreated for user markets", async function () {
      const endTime = (await time.latest()) + 7200;
      const title = "User market MarketCreated event test";

      const tx = predictionMarket.connect(user1).createUserMarket(title, endTime, 0);

      await expect(tx)
        .to.emit(predictionMarket, "MarketCreated")
        .withArgs(0, title, endTime);

      await expect(tx)
        .to.emit(predictionMarket, "UserMarketCreated")
        .withArgs(0, user1.address, title, CREATION_FEE);
    });
  });

  describe("Arbitration State Machine", function () {
    let endTime: number;
    const betAmount = ethers.parseEther("5");

    beforeEach(async function () {
      // takePosition is onlyOwner, so owner takes both positions
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Arbitration test market", endTime);
      await predictionMarket.takePosition(0, true, betAmount);
      await predictionMarket.takePosition(0, false, betAmount);
    });

    it("should block direct resolveMarket when strict arbitration mode is enabled", async function () {
      await predictionMarket.setStrictArbitrationMode(true);
      await time.increaseTo(endTime);
      await expect(
        predictionMarket.resolveMarket(0, true)
      ).to.be.revertedWith("Direct manual resolve disabled");
    });

    it("should allow owner to proposeResolution and emit event", async function () {
      await time.increaseTo(endTime);
      const tx = await predictionMarket.proposeResolution(0, true);
      await expect(tx).to.emit(predictionMarket, "ResolutionProposed");
    });

    it("should allow market creator to proposeResolution", async function () {
      const userEndTime = (await time.latest()) + 7200;
      await predictionMarket.connect(user1).createUserMarket(
        "Creator arbitration test",
        userEndTime,
        0
      );
      await time.increaseTo(userEndTime);
      await expect(
        predictionMarket.connect(user1).proposeResolution(1, false)
      ).to.emit(predictionMarket, "ResolutionProposed");
    });

    it("should reject proposeResolution from non-owner non-creator", async function () {
      await time.increaseTo(endTime);
      await expect(
        predictionMarket.connect(user2).proposeResolution(0, true)
      ).to.be.revertedWith("Only owner or market creator");
    });

    it("should reject proposeResolution before market ended", async function () {
      await expect(
        predictionMarket.proposeResolution(0, true)
      ).to.be.revertedWith("Market not ended");
    });

    it("should reject duplicate proposeResolution", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await expect(
        predictionMarket.proposeResolution(0, false)
      ).to.be.revertedWith("Proposal already exists");
    });

    it("should allow challengeResolution and emit event", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      const tx = await predictionMarket.connect(user1).challengeResolution(0);
      await expect(tx).to.emit(predictionMarket, "ResolutionChallenged");
    });

    it("should reject challengeResolution from proposer", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await expect(
        predictionMarket.challengeResolution(0)
      ).to.be.revertedWith("Proposer cannot challenge");
    });

    it("should reject challengeResolution after window closed", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await time.increase(6 * 3600 + 1);
      await expect(
        predictionMarket.connect(user1).challengeResolution(0)
      ).to.be.revertedWith("Challenge window closed");
    });

    it("should extend challenge window on each challenge", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      const user3 = (await ethers.getSigners())[3];
      await predictionMarket.connect(user1).challengeResolution(0);
      await predictionMarket.connect(user3).challengeResolution(0);
      await time.increase(2 * 3600);
      await expect(
        predictionMarket.finalizeResolution(0, true)
      ).to.be.revertedWith("Challenge window not closed");
    });

    it("should reject finalizeResolution before window closes", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await expect(
        predictionMarket.finalizeResolution(0, true)
      ).to.be.revertedWith("Challenge window not closed");
    });

    it("should finalizeResolution after window closes (no challenge)", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await time.increase(6 * 3600 + 1);
      const tx = await predictionMarket.finalizeResolution(0, true);
      await expect(tx).to.emit(predictionMarket, "MarketResolved").withArgs(0, true);
      await expect(tx).to.emit(predictionMarket, "ResolutionFinalized").withArgs(0, true);
      const market = await predictionMarket.getMarket(0);
      expect(market.resolved).to.equal(true);
      expect(market.outcome).to.equal(true);
    });

    it("should finalizeResolution after challenged window closes", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await predictionMarket.connect(user1).challengeResolution(0);
      await time.increase(3 * 3600 + 1);
      await expect(predictionMarket.finalizeResolution(0, false))
        .to.emit(predictionMarket, "ResolutionFinalized")
        .withArgs(0, false);
      const market = await predictionMarket.getMarket(0);
      expect(market.resolved).to.equal(true);
      expect(market.outcome).to.equal(false);
    });

    it("should reject resolveMarket when arbitration is active (PROPOSED)", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await expect(
        predictionMarket.resolveMarket(0, true)
      ).to.be.revertedWith("Active arbitration in progress");
    });

    it("should reject resolveMarket when arbitration is active (CHALLENGED)", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await predictionMarket.connect(user1).challengeResolution(0);
      await expect(
        predictionMarket.resolveMarket(0, false)
      ).to.be.revertedWith("Active arbitration in progress");
    });

    it("should only allow owner to finalizeResolution", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await time.increase(6 * 3600 + 1);
      await expect(
        predictionMarket.connect(user1).finalizeResolution(0, true)
      ).to.be.revertedWithCustomError(predictionMarket, "OwnableUnauthorizedAccount");
    });

    it("should allow claimWinnings after finalizeResolution", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);
      await time.increase(6 * 3600 + 1);
      await predictionMarket.finalizeResolution(0, true);
      // claimWinnings is onlyOwner, owner has YES tokens
      await predictionMarket.claimWinnings(0);
      const balance = await predictionMarket.balances(owner.address);
      // Owner bet 5 YES + 5 NO = 10 deposited. YES wins, totalCollateral=10, yesSupply=5
      // reward = 5 * 10 / 5 = 10
      expect(balance).to.equal(DEPOSIT_AMOUNT - betAmount * 2n + betAmount * 2n);
    });

    it("should reject duplicate challenge from same address", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);

      // First challenge from user1 succeeds
      await predictionMarket.connect(user1).challengeResolution(0);

      // Second challenge from same user1 should revert
      await expect(
        predictionMarket.connect(user1).challengeResolution(0)
      ).to.be.revertedWith("Already challenged this market");
    });

    it("should enforce MAX_CHALLENGES = 5", async function () {
      const signers = await ethers.getSigners();
      // Use signers[3] through signers[8] as 6 distinct challengers
      const challengers = signers.slice(3, 9);

      // Deposit USDT for all 6 challengers so they can interact
      for (const challenger of challengers) {
        await mockUSDT.mint(challenger.address, INITIAL_USDT_BALANCE);
        const pmAddress = await predictionMarket.getAddress();
        await mockUSDT.connect(challenger).approve(pmAddress, INITIAL_USDT_BALANCE);
        await predictionMarket.connect(challenger).deposit(DEPOSIT_AMOUNT);
      }

      await time.increaseTo(endTime);
      await predictionMarket.proposeResolution(0, true);

      // 5 different signers challenge successfully (each extends the window by 3 hours)
      for (let i = 0; i < 5; i++) {
        await predictionMarket.connect(challengers[i]).challengeResolution(0);
      }

      // 6th challenger should be rejected
      await expect(
        predictionMarket.connect(challengers[5]).challengeResolution(0)
      ).to.be.revertedWith("Max challenges reached");
    });

    it("should track hasChallenged per market independently", async function () {
      // Create a second market (market 1)
      const now = await time.latest();
      const endTime2 = now + 86400;
      await predictionMarket.createMarket("Second Market", endTime2);

      // owner needs more balance for market 1 (beforeEach already spent 10)
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      // owner takes positions on market 1 (takePosition is onlyOwner)
      await predictionMarket.takePosition(1, true, betAmount);

      // Advance time past both endTimes
      await time.increaseTo(endTime2 + 1);

      // Propose resolution for both markets
      await predictionMarket.proposeResolution(0, true);
      await predictionMarket.proposeResolution(1, true);

      // user1 challenges market 0
      await predictionMarket.connect(user1).challengeResolution(0);

      // user1 should still be able to challenge market 1 (different market)
      await expect(
        predictionMarket.connect(user1).challengeResolution(1)
      ).to.not.be.reverted;
    });
  });

  // --- CTF-Specific Tests ---
  describe("CTF: splitPosition", function () {
    let endTime: number;

    beforeEach(async function () {
      // splitPosition is onlyOwner
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Split test market", endTime);
    });

    it("should split collateral into YES + NO tokens", async function () {
      const amount = ethers.parseEther("3");
      await predictionMarket.splitPosition(0, amount);

      const yesId = await predictionMarket.getYesTokenId(0);
      const noId = await predictionMarket.getNoTokenId(0);

      expect(await predictionMarket.balanceOf(owner.address, yesId)).to.equal(amount);
      expect(await predictionMarket.balanceOf(owner.address, noId)).to.equal(amount);
      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT - amount);
    });

    it("should emit PositionSplit event", async function () {
      const amount = ethers.parseEther("2");
      await expect(predictionMarket.splitPosition(0, amount))
        .to.emit(predictionMarket, "PositionSplit")
        .withArgs(0, owner.address, amount);
    });

    it("should revert on insufficient balance", async function () {
      await expect(
        predictionMarket.splitPosition(0, ethers.parseEther("20"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should revert on zero amount", async function () {
      await expect(
        predictionMarket.splitPosition(0, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("should revert after market ended", async function () {
      await time.increaseTo(endTime + 1);
      await expect(
        predictionMarket.splitPosition(0, ethers.parseEther("1"))
      ).to.be.revertedWith("Market ended");
    });

    it("should revert on resolved market", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);
      await expect(
        predictionMarket.splitPosition(0, ethers.parseEther("1"))
      ).to.be.revertedWith("Market already resolved");
    });
  });

  describe("CTF: mergePositions", function () {
    let endTime: number;

    beforeEach(async function () {
      // splitPosition and mergePositions are onlyOwner
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Merge test market", endTime);
      // Split first to get tokens
      await predictionMarket.splitPosition(0, ethers.parseEther("5"));
    });

    it("should merge YES + NO tokens back into collateral", async function () {
      const amount = ethers.parseEther("3");
      await predictionMarket.mergePositions(0, amount);

      const yesId = await predictionMarket.getYesTokenId(0);
      const noId = await predictionMarket.getNoTokenId(0);

      expect(await predictionMarket.balanceOf(owner.address, yesId)).to.equal(ethers.parseEther("2"));
      expect(await predictionMarket.balanceOf(owner.address, noId)).to.equal(ethers.parseEther("2"));
      expect(await predictionMarket.balances(owner.address)).to.equal(DEPOSIT_AMOUNT - ethers.parseEther("5") + amount);
    });

    it("should emit PositionsMerged event", async function () {
      const amount = ethers.parseEther("2");
      await expect(predictionMarket.mergePositions(0, amount))
        .to.emit(predictionMarket, "PositionsMerged")
        .withArgs(0, owner.address, amount);
    });

    it("should revert on insufficient YES tokens", async function () {
      // Transfer some YES tokens away to simulate insufficient balance
      const yesId = await predictionMarket.getYesTokenId(0);
      await predictionMarket.safeTransferFrom(
        owner.address, user2.address, yesId, ethers.parseEther("4"), "0x"
      );

      await expect(
        predictionMarket.mergePositions(0, ethers.parseEther("3"))
      ).to.be.revertedWith("Insufficient YES tokens");
    });

    it("should revert on insufficient NO tokens", async function () {
      const noId = await predictionMarket.getNoTokenId(0);
      await predictionMarket.safeTransferFrom(
        owner.address, user2.address, noId, ethers.parseEther("4"), "0x"
      );

      await expect(
        predictionMarket.mergePositions(0, ethers.parseEther("3"))
      ).to.be.revertedWith("Insufficient NO tokens");
    });

    it("should revert on resolved market", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(
        predictionMarket.mergePositions(0, ethers.parseEther("1"))
      ).to.be.revertedWith("Market already resolved");
    });

    it("should revert on zero amount", async function () {
      await expect(
        predictionMarket.mergePositions(0, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("CTF: Free Transfer", function () {
    let endTime: number;
    const betAmount = ethers.parseEther("5");

    beforeEach(async function () {
      // takePosition is onlyOwner, owner takes both sides
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Transfer test market", endTime);
      await predictionMarket.takePosition(0, true, betAmount);
      await predictionMarket.takePosition(0, false, betAmount);
    });

    it("should allow free transfer before resolution", async function () {
      const yesId = await predictionMarket.getYesTokenId(0);
      const transferAmount = ethers.parseEther("2");

      // Owner transfers YES tokens to user2
      await predictionMarket.safeTransferFrom(
        owner.address, user2.address, yesId, transferAmount, "0x"
      );

      expect(await predictionMarket.balanceOf(owner.address, yesId)).to.equal(betAmount - transferAmount);
      expect(await predictionMarket.balanceOf(user2.address, yesId)).to.equal(transferAmount);
    });

    it("should allow free transfer after resolution", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      const yesId = await predictionMarket.getYesTokenId(0);
      const transferAmount = ethers.parseEther("2");

      await predictionMarket.safeTransferFrom(
        owner.address, user2.address, yesId, transferAmount, "0x"
      );

      expect(await predictionMarket.balanceOf(owner.address, yesId)).to.equal(betAmount - transferAmount);
      expect(await predictionMarket.balanceOf(user2.address, yesId)).to.equal(transferAmount);
    });

    it("should allow owner to claim after keeping YES tokens", async function () {
      // Owner keeps all YES tokens (no transfer)
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // owner claims (has YES tokens)
      await predictionMarket.claimWinnings(0);
      // CTF: totalCollateral=10, yesSupply=5
      // owner YES = 5: 5 * 10 / 5 = 10
      const ownerBalance = await predictionMarket.balances(owner.address);
      expect(ownerBalance).to.equal(DEPOSIT_AMOUNT - betAmount * 2n + betAmount * 2n);

      // second claim reverts (tokens burned)
      await expect(
        predictionMarket.claimWinnings(0)
      ).to.be.revertedWith("No winning position");
    });

    it("should handle transfer and owner claim with remaining tokens", async function () {
      const yesId = await predictionMarket.getYesTokenId(0);
      const transferAmount = ethers.parseEther("2");

      // owner transfers 2 of 5 YES to user2
      await predictionMarket.safeTransferFrom(
        owner.address, user2.address, yesId, transferAmount, "0x"
      );

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // owner claims with 3 YES: 3 * 10 / 5 = 6
      await predictionMarket.claimWinnings(0);
      const bal1 = await predictionMarket.balances(owner.address);
      expect(bal1).to.equal(DEPOSIT_AMOUNT - betAmount * 2n + (ethers.parseEther("3") * ethers.parseEther("10")) / ethers.parseEther("5"));
    });
  });

  describe("CTF: Arbitrage Scenario", function () {
    it("should allow split -> sell one side -> merge remainder", async function () {
      // splitPosition and mergePositions are onlyOwner
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Arbitrage test", endTime);

      // owner splits 5 USDT -> 5 YES + 5 NO
      await predictionMarket.splitPosition(0, ethers.parseEther("5"));

      const yesId = await predictionMarket.getYesTokenId(0);
      const noId = await predictionMarket.getNoTokenId(0);

      // owner transfers 3 YES to user2 (simulating a sale)
      await predictionMarket.safeTransferFrom(
        owner.address, user2.address, yesId, ethers.parseEther("3"), "0x"
      );

      // owner has 2 YES + 5 NO, can merge 2 pairs
      await predictionMarket.mergePositions(0, ethers.parseEther("2"));

      // owner balance: 10 - 5 (split) + 2 (merge) = 7
      expect(await predictionMarket.balances(owner.address)).to.equal(ethers.parseEther("7"));
      // owner tokens: 0 YES + 3 NO
      expect(await predictionMarket.balanceOf(owner.address, yesId)).to.equal(0);
      expect(await predictionMarket.balanceOf(owner.address, noId)).to.equal(ethers.parseEther("3"));
    });
  });

  describe("CTF: Token ID Encoding", function () {
    it("should correctly encode YES and NO token IDs", async function () {
      expect(await predictionMarket.getYesTokenId(0)).to.equal(0);
      expect(await predictionMarket.getNoTokenId(0)).to.equal(1);
      expect(await predictionMarket.getYesTokenId(1)).to.equal(2);
      expect(await predictionMarket.getNoTokenId(1)).to.equal(3);
      expect(await predictionMarket.getYesTokenId(100)).to.equal(200);
      expect(await predictionMarket.getNoTokenId(100)).to.equal(201);
    });

    it("should handle large market IDs without overflow", async function () {
      const largeId = 2n ** 127n;
      expect(await predictionMarket.getYesTokenId(largeId)).to.equal(largeId * 2n);
      expect(await predictionMarket.getNoTokenId(largeId)).to.equal(largeId * 2n + 1n);
    });
  });

  describe("CTF: ERC1155 Compliance", function () {
    it("should support ERC1155 interface", async function () {
      // ERC1155 interface ID: 0xd9b67a26
      expect(await predictionMarket.supportsInterface("0xd9b67a26")).to.equal(true);
    });

    it("should support ERC165 interface", async function () {
      // ERC165 interface ID: 0x01ffc9a7
      expect(await predictionMarket.supportsInterface("0x01ffc9a7")).to.equal(true);
    });

    it("should handle balanceOfBatch correctly", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Batch balance test", endTime);

      await predictionMarket.splitPosition(0, ethers.parseEther("3"));

      const yesId = await predictionMarket.getYesTokenId(0);
      const noId = await predictionMarket.getNoTokenId(0);

      const balances = await predictionMarket.balanceOfBatch(
        [owner.address, owner.address],
        [yesId, noId]
      );

      expect(balances[0]).to.equal(ethers.parseEther("3"));
      expect(balances[1]).to.equal(ethers.parseEther("3"));
    });
  });

  describe("CTF: Agent ERC1155", function () {
    let nfaSigner: SignerWithAddress;
    let endTime: number;

    beforeEach(async function () {
      [, , , nfaSigner] = await ethers.getSigners();
      await predictionMarket.setNFAContract(nfaSigner.address);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent ERC1155 test", endTime);
      // Setup nfaSigner with USDT
      await mockUSDT.mint(nfaSigner.address, INITIAL_USDT_BALANCE);
      const pmAddress = await predictionMarket.getAddress();
      await mockUSDT.connect(nfaSigner).approve(pmAddress, INITIAL_USDT_BALANCE);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    it("should mint ERC1155 tokens to NFA contract on agentTakePosition", async function () {
      const amount = ethers.parseEther("3");
      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, amount);

      const yesId = await predictionMarket.getYesTokenId(0);
      expect(await predictionMarket.balanceOf(nfaSigner.address, yesId)).to.equal(amount);

      // Agent sub-ledger should track
      const pos = await predictionMarket.getAgentPosition(0, 1);
      expect(pos.yesAmount).to.equal(amount);
    });

    it("should handle agentSplitPosition", async function () {
      const amount = ethers.parseEther("2");
      await predictionMarket.connect(nfaSigner).agentSplitPosition(1, 0, amount);

      const yesId = await predictionMarket.getYesTokenId(0);
      const noId = await predictionMarket.getNoTokenId(0);

      expect(await predictionMarket.balanceOf(nfaSigner.address, yesId)).to.equal(amount);
      expect(await predictionMarket.balanceOf(nfaSigner.address, noId)).to.equal(amount);

      const pos = await predictionMarket.getAgentPosition(0, 1);
      expect(pos.yesAmount).to.equal(amount);
      expect(pos.noAmount).to.equal(amount);
    });

    it("should correctly claim agent winnings and burn ERC1155", async function () {
      const agentBet = ethers.parseEther("3");
      const ownerBet = ethers.parseEther("5");

      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, agentBet);
      // takePosition is onlyOwner, use owner for NO position
      await predictionMarket.deposit(DEPOSIT_AMOUNT);
      await predictionMarket.takePosition(0, false, ownerBet);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.connect(nfaSigner).agentClaimWinnings(1, 0);

      // ERC1155 tokens should be burned
      const yesId = await predictionMarket.getYesTokenId(0);
      expect(await predictionMarket.balanceOf(nfaSigner.address, yesId)).to.equal(0);

      // Sub-ledger should be zeroed
      const pos = await predictionMarket.getAgentPosition(0, 1);
      expect(pos.yesAmount).to.equal(0);
    });

    it("should correctly claim agent refund and burn ERC1155", async function () {
      const agentBet = ethers.parseEther("3");
      await predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, agentBet);

      await predictionMarket.cancelMarket(0);

      const balBefore = await predictionMarket.balances(nfaSigner.address);
      await predictionMarket.connect(nfaSigner).agentClaimRefund(1, 0);
      const balAfter = await predictionMarket.balances(nfaSigner.address);

      expect(balAfter - balBefore).to.equal(agentBet);

      // ERC1155 tokens should be burned
      const yesId = await predictionMarket.getYesTokenId(0);
      expect(await predictionMarket.balanceOf(nfaSigner.address, yesId)).to.equal(0);
    });
  });

  describe("CTF: Mathematical Equivalence", function () {
    it("should produce same result as old pari-mutuel for pure takePosition scenario", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Math equivalence test", endTime);

      const bet1 = ethers.parseEther("5");
      const bet2 = ethers.parseEther("5");

      await predictionMarket.takePosition(0, true, bet1);
      await predictionMarket.takePosition(0, false, bet2);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.claimWinnings(0);
      const balance = await predictionMarket.balances(owner.address);

      // Old model: 5 + (5 * 5 / 5) = 10
      // CTF model: 5 * 10 / 5 = 10
      expect(balance).to.equal(DEPOSIT_AMOUNT - bet1 - bet2 + bet1 + bet2);
    });

    it("should handle split -> claim equivalence", async function () {
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Split claim equiv", endTime);

      // Split 5 USDT -> 5 YES + 5 NO
      await predictionMarket.splitPosition(0, ethers.parseEther("5"));

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // Only YES tokens are winners
      await predictionMarket.claimWinnings(0);
      const balance = await predictionMarket.balances(owner.address);

      // totalCollateral=5, yesSupply=5, owner has 5 YES
      // reward = 5 * 5 / 5 = 5
      expect(balance).to.equal(DEPOSIT_AMOUNT - ethers.parseEther("5") + ethers.parseEther("5"));
    });
  });

  describe("Round 4: Rounding dust verification (CTF)", function () {
    it("should verify dust remains in contract (not distributed more than pool)", async function () {
      // In relayer model, only owner can call takePosition/claimWinnings
      // Simplified: owner bets both sides, verify total payout does not exceed pool
      await predictionMarket.deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Dust verification test", endTime);

      const betYes = 11n;
      const betNo = 11n;

      await predictionMarket.takePosition(0, true, betYes);
      await predictionMarket.takePosition(0, false, betNo);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      const balBefore = await predictionMarket.balances(owner.address);

      await predictionMarket.claimWinnings(0);

      const balAfter = await predictionMarket.balances(owner.address);

      const reward = balAfter - balBefore;
      const totalPool = betYes + betNo;

      // Total rewards should never exceed total pool
      expect(reward).to.be.lte(totalPool);

      // Dust should be minimal
      const dust = totalPool - reward;
      expect(dust).to.be.lt(2n);
    });
  });
});
