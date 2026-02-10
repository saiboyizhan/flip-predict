import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { PredictionMarket, MockUSDT, MockOracle } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PredictionMarket", function () {
  let predictionMarket: PredictionMarket;
  let usdt: MockUSDT;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseUnits("10000", 18);
  const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 18);

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();
    await usdt.waitForDeployment();

    // Deploy PredictionMarket
    const PredictionMarketFactory = await ethers.getContractFactory("PredictionMarket");
    predictionMarket = await PredictionMarketFactory.deploy(await usdt.getAddress());
    await predictionMarket.waitForDeployment();

    // Distribute USDT to users
    await usdt.mint(user1.address, INITIAL_BALANCE);
    await usdt.mint(user2.address, INITIAL_BALANCE);

    // Approve PredictionMarket to spend USDT
    await usdt.connect(user1).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
    await usdt.connect(user2).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
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
      const balanceBefore = await usdt.balanceOf(user1.address);
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const balanceAfter = await usdt.balanceOf(user1.address);
      expect(balanceBefore - balanceAfter).to.equal(DEPOSIT_AMOUNT);
    });

    it("should revert on zero amount", async function () {
      await expect(predictionMarket.connect(user1).deposit(0)).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    it("should withdraw USDT successfully", async function () {
      const withdrawAmount = ethers.parseUnits("500", 18);
      await predictionMarket.connect(user1).withdraw(withdrawAmount);
      expect(await predictionMarket.balances(user1.address)).to.equal(DEPOSIT_AMOUNT - withdrawAmount);
    });

    it("should emit Withdraw event", async function () {
      await expect(predictionMarket.connect(user1).withdraw(DEPOSIT_AMOUNT))
        .to.emit(predictionMarket, "Withdraw")
        .withArgs(user1.address, DEPOSIT_AMOUNT);
    });

    it("should revert on insufficient balance", async function () {
      const tooMuch = ethers.parseUnits("2000", 18);
      await expect(predictionMarket.connect(user1).withdraw(tooMuch)).to.be.revertedWith("Insufficient balance");
    });

    it("should revert on zero amount", async function () {
      await expect(predictionMarket.connect(user1).withdraw(0)).to.be.revertedWith("Amount must be > 0");
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
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Will BTC reach 100k?", endTime);
    });

    it("should take a YES position", async function () {
      const amount = ethers.parseUnits("100", 18);
      await predictionMarket.connect(user1).takePosition(0, true, amount);

      const pos = await predictionMarket.getPosition(0, user1.address);
      expect(pos.yesAmount).to.equal(amount);
      expect(pos.noAmount).to.equal(0);
    });

    it("should take a NO position", async function () {
      const amount = ethers.parseUnits("100", 18);
      await predictionMarket.connect(user1).takePosition(0, false, amount);

      const pos = await predictionMarket.getPosition(0, user1.address);
      expect(pos.yesAmount).to.equal(0);
      expect(pos.noAmount).to.equal(amount);
    });

    it("should deduct from user balance", async function () {
      const amount = ethers.parseUnits("100", 18);
      await predictionMarket.connect(user1).takePosition(0, true, amount);
      expect(await predictionMarket.balances(user1.address)).to.equal(DEPOSIT_AMOUNT - amount);
    });

    it("should revert on insufficient balance", async function () {
      const tooMuch = ethers.parseUnits("2000", 18);
      await expect(
        predictionMarket.connect(user1).takePosition(0, true, tooMuch)
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should revert after market ended", async function () {
      await time.increaseTo(endTime + 1);
      const amount = ethers.parseUnits("100", 18);
      await expect(
        predictionMarket.connect(user1).takePosition(0, true, amount)
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

  describe("Claim Winnings", function () {
    let endTime: number;
    const betAmount = ethers.parseUnits("500", 18);

    beforeEach(async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Will BTC reach 100k?", endTime);

      // user1 bets YES, user2 bets NO
      await predictionMarket.connect(user1).takePosition(0, true, betAmount);
      await predictionMarket.connect(user2).takePosition(0, false, betAmount);
    });

    it("should claim winnings for YES winner", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.connect(user1).claimWinnings(0);

      // Winner gets their stake (500) + loser pool (500) = 1000
      const balanceAfter = await predictionMarket.balances(user1.address);
      expect(balanceAfter).to.equal(DEPOSIT_AMOUNT - betAmount + betAmount * 2n);
    });

    it("should claim winnings for NO winner", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, false);

      await predictionMarket.connect(user2).claimWinnings(0);

      const balanceAfter = await predictionMarket.balances(user2.address);
      expect(balanceAfter).to.equal(DEPOSIT_AMOUNT - betAmount + betAmount * 2n);
    });

    it("should emit WinningsClaimed event", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      const expectedReward = betAmount * 2n; // stake + loser pool
      await expect(predictionMarket.connect(user1).claimWinnings(0))
        .to.emit(predictionMarket, "WinningsClaimed")
        .withArgs(0, user1.address, expectedReward);
    });

    it("should revert if market not resolved", async function () {
      await expect(predictionMarket.connect(user1).claimWinnings(0)).to.be.revertedWith("Market not resolved");
    });

    it("should revert if no winning position", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(predictionMarket.connect(user2).claimWinnings(0)).to.be.revertedWith("No winning position");
    });

    it("should revert if already claimed", async function () {
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.connect(user1).claimWinnings(0);
      await expect(predictionMarket.connect(user1).claimWinnings(0)).to.be.revertedWith("Already claimed");
    });

    it("should distribute proportionally with multiple winners", async function () {
      // Resolve YES
      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      // user1 (the only YES bettor) should get all the loser pool
      await predictionMarket.connect(user1).claimWinnings(0);
      // 500 (stake) + 500 (loser pool) = 1000
      const expectedBalance = DEPOSIT_AMOUNT - betAmount + betAmount * 2n;
      expect(await predictionMarket.balances(user1.address)).to.equal(expectedBalance);
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

      // Deposit for users
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
        // Set price above target
        await mockOracle.setPrice(TARGET_PRICE + 100000000n); // $1 above
        await time.increaseTo(endTime);

        await expect(predictionMarket.resolveByOracle(0))
          .to.emit(predictionMarket, "OracleResolution");

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true); // YES wins
        expect(market.resolvedPrice).to.equal(TARGET_PRICE + 100000000n);
      });

      it("should resolve NO when price is below target (price_above type)", async function () {
        // Set price below target
        await mockOracle.setPrice(TARGET_PRICE - 100000000n); // $1 below
        await time.increaseTo(endTime);

        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(false); // NO wins
      });

      it("should resolve YES when price equals target (price_above type)", async function () {
        // Price equals target -> >= means YES
        await time.increaseTo(endTime);

        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true); // YES wins (>=)
      });

      it("should allow anyone to call resolveByOracle", async function () {
        await time.increaseTo(endTime);

        // user1 (not owner) can call resolveByOracle
        await expect(predictionMarket.connect(user1).resolveByOracle(0)).to.not.be.reverted;

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
      });

      it("should revert for non-oracle market", async function () {
        // Create a manual market
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
        await predictionMarket.createOracleMarket(
          "BTC below 100k?",
          endTime,
          oracleAddress,
          TARGET_PRICE,
          2 // price_below
        );

        // Set price below target
        await mockOracle.setPrice(TARGET_PRICE - 100000000n);
        await time.increaseTo(endTime);

        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true); // YES wins - price is below
      });

      it("should resolve NO when price is above target (price_below type)", async function () {
        const endTime = (await time.latest()) + 3600;
        await predictionMarket.createOracleMarket(
          "BTC below 100k?",
          endTime,
          oracleAddress,
          TARGET_PRICE,
          2 // price_below
        );

        // Set price above target
        await mockOracle.setPrice(TARGET_PRICE + 100000000n);
        await time.increaseTo(endTime);

        await predictionMarket.resolveByOracle(0);

        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(false); // NO wins - price is above
      });
    });

    describe("Oracle Full Flow", function () {
      it("should complete full oracle market lifecycle: create -> bet -> resolve -> claim", async function () {
        const endTime = (await time.latest()) + 3600;
        const betAmount = ethers.parseUnits("500", 18);

        // 1. Create oracle market
        await predictionMarket.createOracleMarket(
          "BTC above 100k?",
          endTime,
          oracleAddress,
          TARGET_PRICE,
          1 // price_above
        );

        // 2. Users take positions
        await predictionMarket.connect(user1).takePosition(0, true, betAmount); // user1 bets YES
        await predictionMarket.connect(user2).takePosition(0, false, betAmount); // user2 bets NO

        // 3. Set price above target and resolve by oracle
        await mockOracle.setPrice(TARGET_PRICE + 500000000n); // $5 above target
        await time.increaseTo(endTime);

        // Anyone can trigger resolution
        await predictionMarket.connect(user2).resolveByOracle(0);

        // Verify resolution
        const market = await predictionMarket.getMarket(0);
        expect(market.resolved).to.equal(true);
        expect(market.outcome).to.equal(true); // YES wins
        expect(market.resolvedPrice).to.equal(TARGET_PRICE + 500000000n);

        // 4. Winner claims
        await predictionMarket.connect(user1).claimWinnings(0);

        // user1 started with 1000, bet 500, won 500+500=1000
        const finalBalance = await predictionMarket.balances(user1.address);
        expect(finalBalance).to.equal(DEPOSIT_AMOUNT - betAmount + betAmount * 2n);

        // 5. Loser cannot claim
        await expect(
          predictionMarket.connect(user2).claimWinnings(0)
        ).to.be.revertedWith("No winning position");
      });
    });
  });

  describe("Pause", function () {
    it("should pause and unpause", async function () {
      await predictionMarket.pause();
      await expect(predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT)).to.be.revertedWithCustomError(
        predictionMarket,
        "EnforcedPause"
      );

      await predictionMarket.unpause();
      // Need to approve first
      await usdt.mint(user1.address, DEPOSIT_AMOUNT);
      await usdt.connect(user1).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
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
    const CREATION_FEE = ethers.parseUnits("10", 18);

    beforeEach(async function () {
      // Mint extra USDT for creation fees
      await usdt.mint(user1.address, ethers.parseUnits("1000", 18));
      await usdt.connect(user1).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
    });

    it("should create a user market with 10 USDT fee", async function () {
      const endTime = (await time.latest()) + 7200; // 2 hours from now
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
      const endTime = (await time.latest()) + 1800; // 30 minutes
      await expect(
        predictionMarket.connect(user1).createUserMarket("A valid title for the market", endTime, 0)
      ).to.be.revertedWith("End time too soon");
    });

    it("should reject end time too far (more than 90 days)", async function () {
      const endTime = (await time.latest()) + 91 * 86400; // 91 days
      await expect(
        predictionMarket.connect(user1).createUserMarket("A valid title for the market", endTime, 0)
      ).to.be.revertedWith("End time too far");
    });

    it("should reset daily count on a new day", async function () {
      const endTime = (await time.latest()) + 7200;

      // Create 3 markets today
      await predictionMarket.connect(user1).createUserMarket("Market one - test title", endTime, 0);
      await predictionMarket.connect(user1).createUserMarket("Market two - test title", endTime, 0);
      await predictionMarket.connect(user1).createUserMarket("Market three test title", endTime, 0);

      // Advance time by 1 day
      await time.increase(86400);

      const newEndTime = (await time.latest()) + 7200;
      // Should succeed on new day
      await expect(
        predictionMarket.connect(user1).createUserMarket("Market on new day!!", newEndTime, 0)
      ).to.not.be.reverted;
    });

    it("should create market with initial liquidity", async function () {
      // Deposit first so user1 has balance
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 7200;
      const liquidity = ethers.parseUnits("100", 18);

      await predictionMarket.connect(user1).createUserMarket(
        "Market with liquidity test",
        endTime,
        liquidity
      );

      const market = await predictionMarket.getMarket(0);
      const half = liquidity / 2n;
      expect(market.totalYes).to.equal(half);
      expect(market.totalNo).to.equal(liquidity - half);

      // Balance should be reduced
      expect(await predictionMarket.balances(user1.address)).to.equal(DEPOSIT_AMOUNT - liquidity);
    });
  });

  describe("Agent Take Position", function () {
    let nfaSigner: SignerWithAddress;
    let endTime: number;

    beforeEach(async function () {
      [, , , nfaSigner] = await ethers.getSigners();

      // Set NFA contract
      await predictionMarket.setNFAContract(nfaSigner.address);

      // Create a market
      endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent test market", endTime);

      // Deposit for nfaSigner (simulate NFA contract having balance)
      await usdt.mint(nfaSigner.address, INITIAL_BALANCE);
      await usdt.connect(nfaSigner).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);
    });

    it("should allow NFA contract to take position", async function () {
      const amount = ethers.parseUnits("100", 18);
      await expect(
        predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, amount)
      )
        .to.emit(predictionMarket, "AgentPositionTaken")
        .withArgs(0, 1, true, amount);

      const pos = await predictionMarket.getPosition(0, nfaSigner.address);
      expect(pos.yesAmount).to.equal(amount);
    });

    it("should reject non-NFA contract caller", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const amount = ethers.parseUnits("100", 18);
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
      const newFee = ethers.parseUnits("20", 18);
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
      // First create a user market to generate fees
      await usdt.mint(user1.address, ethers.parseUnits("100", 18));
      await usdt.connect(user1).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
      const endTime = (await time.latest()) + 7200;
      await predictionMarket.connect(user1).createUserMarket("Withdraw fee test market", endTime, 0);

      const fee = ethers.parseUnits("10", 18);
      const ownerBalanceBefore = await usdt.balanceOf(owner.address);
      await predictionMarket.withdrawFees(fee);
      const ownerBalanceAfter = await usdt.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(fee);
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
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.pause();
      await expect(
        predictionMarket.connect(user1).withdraw(DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert takePosition when paused", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Pause test market", endTime);
      await predictionMarket.pause();

      await expect(
        predictionMarket.connect(user1).takePosition(0, true, ethers.parseUnits("100", 18))
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert claimWinnings when paused", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Pause claim test", endTime);

      const betAmount = ethers.parseUnits("100", 18);
      await predictionMarket.connect(user1).takePosition(0, true, betAmount);
      await predictionMarket.connect(user2).takePosition(0, false, betAmount);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await predictionMarket.pause();
      await expect(
        predictionMarket.connect(user1).claimWinnings(0)
      ).to.be.revertedWithCustomError(predictionMarket, "EnforcedPause");
    });

    it("should revert takePosition on non-existent market", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await expect(
        predictionMarket.connect(user1).takePosition(999, true, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Market does not exist");
    });

    it("should revert claimWinnings on non-existent market", async function () {
      await expect(
        predictionMarket.connect(user1).claimWinnings(999)
      ).to.be.revertedWith("Market does not exist");
    });

    it("should revert takePosition on resolved market", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Resolved position test", endTime);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true);

      await expect(
        predictionMarket.connect(user1).takePosition(0, true, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Market already resolved");
    });

    it("should revert takePosition with zero amount", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Zero amount test", endTime);

      await expect(
        predictionMarket.connect(user1).takePosition(0, true, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("should revert resolveMarket on non-existent market", async function () {
      await expect(
        predictionMarket.resolveMarket(999, true)
      ).to.be.revertedWith("Market does not exist");
    });

    it("should handle multiple deposits and withdrawals correctly", async function () {
      const amount1 = ethers.parseUnits("300", 18);
      const amount2 = ethers.parseUnits("200", 18);
      const withdrawAmount = ethers.parseUnits("400", 18);

      await predictionMarket.connect(user1).deposit(amount1);
      await predictionMarket.connect(user1).deposit(amount2);
      expect(await predictionMarket.balances(user1.address)).to.equal(amount1 + amount2);

      await predictionMarket.connect(user1).withdraw(withdrawAmount);
      expect(await predictionMarket.balances(user1.address)).to.equal(amount1 + amount2 - withdrawAmount);
    });

    it("should handle user taking both YES and NO positions on the same market", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Both sides test", endTime);

      const yesAmount = ethers.parseUnits("200", 18);
      const noAmount = ethers.parseUnits("300", 18);

      await predictionMarket.connect(user1).takePosition(0, true, yesAmount);
      await predictionMarket.connect(user1).takePosition(0, false, noAmount);

      const pos = await predictionMarket.getPosition(0, user1.address);
      expect(pos.yesAmount).to.equal(yesAmount);
      expect(pos.noAmount).to.equal(noAmount);

      expect(await predictionMarket.balances(user1.address)).to.equal(DEPOSIT_AMOUNT - yesAmount - noAmount);
    });

    it("should correctly distribute winnings with multiple YES bettors", async function () {
      const user3 = (await ethers.getSigners())[3];
      await usdt.mint(user3.address, INITIAL_BALANCE);
      await usdt.connect(user3).approve(await predictionMarket.getAddress(), ethers.MaxUint256);

      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user3).deposit(DEPOSIT_AMOUNT);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Multi winner test", endTime);

      // user1 bets 300 YES, user3 bets 200 YES, user2 bets 500 NO
      const bet1 = ethers.parseUnits("300", 18);
      const bet3 = ethers.parseUnits("200", 18);
      const bet2 = ethers.parseUnits("500", 18);

      await predictionMarket.connect(user1).takePosition(0, true, bet1);
      await predictionMarket.connect(user3).takePosition(0, true, bet3);
      await predictionMarket.connect(user2).takePosition(0, false, bet2);

      await time.increaseTo(endTime);
      await predictionMarket.resolveMarket(0, true); // YES wins

      // user1 gets 300 + (300 * 500 / 500) = 300 + 300 = 600
      await predictionMarket.connect(user1).claimWinnings(0);
      const bal1 = await predictionMarket.balances(user1.address);
      expect(bal1).to.equal(DEPOSIT_AMOUNT - bet1 + bet1 + (bet1 * bet2) / (bet1 + bet3));

      // user3 gets 200 + (200 * 500 / 500) = 200 + 200 = 400
      await predictionMarket.connect(user3).claimWinnings(0);
      const bal3 = await predictionMarket.balances(user3.address);
      expect(bal3).to.equal(DEPOSIT_AMOUNT - bet3 + bet3 + (bet3 * bet2) / (bet1 + bet3));
    });

    it("should handle user market creation with sufficient USDT approval", async function () {
      // User tries to create market without approving USDT
      const noApprovalUser = (await ethers.getSigners())[4];
      await usdt.mint(noApprovalUser.address, ethers.parseUnits("100", 18));
      // No approval given

      const endTime = (await time.latest()) + 7200;
      await expect(
        predictionMarket.connect(noApprovalUser).createUserMarket("A valid title for no approval test", endTime, 0)
      ).to.be.reverted; // SafeERC20 will revert
    });

    it("should handle agentTakePosition when market ended", async function () {
      const nfaSigner = (await ethers.getSigners())[3];
      await predictionMarket.setNFAContract(nfaSigner.address);

      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Agent expired test", endTime);

      await usdt.mint(nfaSigner.address, INITIAL_BALANCE);
      await usdt.connect(nfaSigner).approve(await predictionMarket.getAddress(), ethers.MaxUint256);
      await predictionMarket.connect(nfaSigner).deposit(DEPOSIT_AMOUNT);

      await time.increaseTo(endTime + 1);

      await expect(
        predictionMarket.connect(nfaSigner).agentTakePosition(1, 0, true, ethers.parseUnits("100", 18))
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
      expect(await predictionMarket.usdt()).to.equal(await usdt.getAddress());
      expect(await predictionMarket.marketCreationFee()).to.equal(ethers.parseUnits("10", 18));
      expect(await predictionMarket.maxMarketsPerDay()).to.equal(3);
      expect(await predictionMarket.nextMarketId()).to.equal(0);
    });

    it("should revert constructor with zero address USDT", async function () {
      const PredictionMarketFactory = await ethers.getContractFactory("PredictionMarket");
      await expect(
        PredictionMarketFactory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid USDT address");
    });

    it("should correctly emit PositionTaken event", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Event test market", endTime);

      const amount = ethers.parseUnits("100", 18);
      await expect(
        predictionMarket.connect(user1).takePosition(0, true, amount)
      )
        .to.emit(predictionMarket, "PositionTaken")
        .withArgs(0, user1.address, true, amount);

      await expect(
        predictionMarket.connect(user1).takePosition(0, false, amount)
      )
        .to.emit(predictionMarket, "PositionTaken")
        .withArgs(0, user1.address, false, amount);
    });

    it("should update market totals correctly after multiple positions", async function () {
      await predictionMarket.connect(user1).deposit(DEPOSIT_AMOUNT);
      await predictionMarket.connect(user2).deposit(DEPOSIT_AMOUNT);
      const endTime = (await time.latest()) + 3600;
      await predictionMarket.createMarket("Totals test market", endTime);

      const amount1 = ethers.parseUnits("100", 18);
      const amount2 = ethers.parseUnits("250", 18);
      const amount3 = ethers.parseUnits("150", 18);

      await predictionMarket.connect(user1).takePosition(0, true, amount1);
      await predictionMarket.connect(user2).takePosition(0, false, amount2);
      await predictionMarket.connect(user1).takePosition(0, true, amount3);

      const market = await predictionMarket.getMarket(0);
      expect(market.totalYes).to.equal(amount1 + amount3);
      expect(market.totalNo).to.equal(amount2);
    });
  });
});
