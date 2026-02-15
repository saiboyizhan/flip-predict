// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "./BAP578Base.sol";
import "./interfaces/ILearningModule.sol";
import "./interfaces/IMemoryModuleRegistry.sol";
import "./interfaces/IVaultPermissionManager.sol";

/// @title NFA - Non-Fungible Agent for BSC Prediction Market
/// @notice ERC721 agent NFT built on BAP-578 standard with prediction profiles,
///         auto-trade, learning, memory, and vault permission features.
/// @dev Inherits BAP578Base for core agent lifecycle, metadata, funding, and logic execution.
///      Implements IERC1155Receiver to receive CTF position tokens from PredictionMarket.
contract NFA is BAP578Base, ILearningModule, IMemoryModuleRegistry, IVaultPermissionManager, IERC1155Receiver {

    // ─── Prediction Profile ─────────────────────────────────────
    struct PredictionProfile {
        uint256 totalPredictions;
        uint256 correctPredictions;
        bytes32 styleRoot;
        uint256 reputationScore;
    }

    // ─── Auto Trade Auth ────────────────────────────────────────
    struct AutoTradeAuth {
        bool authorized;
        address authorizedCaller;
        uint256 maxAmountPerTrade;
        uint256 maxDailyAmount;
        uint256 dailyUsed;
        uint256 lastResetDay;
        uint256 expiresAt;
    }

    // ─── State ──────────────────────────────────────────────────
    address public predictionMarket;
    mapping(uint256 => uint256) public predictionMarketBalances;
    uint256 public totalAllocatedPredictionMarketBalance;

    // Prediction profile
    mapping(uint256 => PredictionProfile) private _profiles;

    // Auto trade
    mapping(uint256 => AutoTradeAuth) private _autoTradeAuth;

    // Learning module
    mapping(uint256 => LearningMetrics) private _learningMetrics;

    // Memory modules
    mapping(uint256 => mapping(address => MemoryModule)) private _memoryModules;

    // Vault permissions
    mapping(uint256 => mapping(address => Permission)) private _vaultPermissions;

    // ─── Events ─────────────────────────────────────────────────
    event AutoTradeAuthorized(uint256 indexed tokenId, uint256 maxPerTrade, uint256 maxDaily, uint256 expiresAt);
    event AutoTradeRevoked(uint256 indexed tokenId);
    event AgentTradeExecuted(uint256 indexed tokenId, address target, uint256 value);
    event ProfileUpdated(uint256 indexed tokenId);

    // ─── Constructor ────────────────────────────────────────────
    constructor() BAP578Base("NFA Prediction Agent", "NFA") {}

    // ═══════════════════════════════════════════════════════════════
    // PREDICTION PROFILE
    // ═══════════════════════════════════════════════════════════════

    /// @notice Update the agent's prediction profile stats (token owner only)
    function updateProfile(
        uint256 tokenId,
        bytes32 newStyleRoot,
        uint256 totalPredictions,
        uint256 correctPredictions
    ) external onlyTokenOwner(tokenId) {
        PredictionProfile storage profile = _profiles[tokenId];
        profile.styleRoot = newStyleRoot;
        profile.totalPredictions = totalPredictions;
        profile.correctPredictions = correctPredictions;
        if (totalPredictions > 0) {
            profile.reputationScore = (correctPredictions * 10000) / totalPredictions;
        }
        emit ProfileUpdated(tokenId);
    }

    /// @notice Get the agent's prediction profile
    function getProfile(uint256 tokenId) external view returns (PredictionProfile memory) {
        _requireOwned(tokenId);
        return _profiles[tokenId];
    }

    // ═══════════════════════════════════════════════════════════════
    // AUTO TRADE AUTHORIZATION
    // ═══════════════════════════════════════════════════════════════

    /// @notice Authorize a third-party caller to execute trades for this agent
    function authorizeAutoTrade(
        uint256 tokenId,
        address caller,
        uint256 maxPerTrade,
        uint256 maxDaily,
        uint256 duration
    ) external onlyTokenOwner(tokenId) {
        require(caller != address(0), "Invalid caller address");
        require(duration > 0, "Duration must be > 0");
        require(maxPerTrade > 0, "Max per trade must be > 0");
        require(maxDaily >= maxPerTrade, "Max daily must be >= max per trade");
        _autoTradeAuth[tokenId] = AutoTradeAuth({
            authorized: true,
            authorizedCaller: caller,
            maxAmountPerTrade: maxPerTrade,
            maxDailyAmount: maxDaily,
            dailyUsed: 0,
            lastResetDay: block.timestamp / 1 days,
            expiresAt: block.timestamp + duration
        });
        emit AutoTradeAuthorized(tokenId, maxPerTrade, maxDaily, block.timestamp + duration);
    }

    /// @notice Revoke auto-trade authorization (token owner only)
    function revokeAutoTrade(uint256 tokenId) external onlyTokenOwner(tokenId) {
        _autoTradeAuth[tokenId].authorized = false;
        emit AutoTradeRevoked(tokenId);
    }

    /// @notice Execute a trade from agent's balance (owner or authorized caller)
    function executeAgentTrade(
        uint256 tokenId,
        address target,
        bytes calldata data,
        uint256 value
    ) external onlyActiveAgent(tokenId) nonReentrant returns (bytes memory) {
        require(target != address(0), "Invalid target address");
        require(target != address(this), "Cannot call self");
        require(target != predictionMarket, "Cannot call prediction market directly");
        address tokenOwner = ownerOf(tokenId);
        AutoTradeAuth storage auth = _autoTradeAuth[tokenId];

        // Owner can always execute; others need authorization
        if (msg.sender != tokenOwner) {
            require(auth.authorized, "Not authorized");
            require(msg.sender == auth.authorizedCaller, "Not authorized caller");
            require(block.timestamp < auth.expiresAt, "Authorization expired");
            require(value <= auth.maxAmountPerTrade, "Exceeds per-trade limit");

            // Reset daily counter if new day
            uint256 today = block.timestamp / 1 days;
            if (today > auth.lastResetDay) {
                auth.dailyUsed = 0;
                auth.lastResetDay = today;
            }

            require(auth.dailyUsed + value <= auth.maxDailyAmount, "Exceeds daily limit");
            auth.dailyUsed += value;
        }

        require(_agentBalances[tokenId] >= value, "Insufficient agent balance");
        _agentBalances[tokenId] -= value;
        totalAgentBalances -= value;

        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "Trade execution failed");

        emit AgentTradeExecuted(tokenId, target, value);
        return result;
    }

    /// @notice Get the current auto-trade authorization for an agent
    function getAutoTradeAuth(uint256 tokenId) external view returns (AutoTradeAuth memory) {
        _requireOwned(tokenId);
        return _autoTradeAuth[tokenId];
    }

    // ═══════════════════════════════════════════════════════════════
    // LEARNING MODULE (ILearningModule)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Update the agent's learning data Merkle root (token owner only)
    function updateLearning(uint256 tokenId, bytes32 newRoot, bytes calldata /* proof */)
        external
        onlyTokenOwner(tokenId)
    {
        LearningMetrics storage metrics = _learningMetrics[tokenId];
        metrics.learningRoot = newRoot;
        metrics.lastUpdated = block.timestamp;
        emit LearningUpdated(tokenId, newRoot);
    }

    /// @notice Verify a learning claim against the agent's Merkle root
    function verifyLearning(uint256 tokenId, bytes32 claim, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        _requireOwned(tokenId);
        bytes32 root = _learningMetrics[tokenId].learningRoot;
        if (root == bytes32(0)) return false;
        return MerkleProof.verify(proof, root, claim);
    }

    /// @notice Get the agent's learning metrics
    function getLearningMetrics(uint256 tokenId) external view returns (LearningMetrics memory) {
        _requireOwned(tokenId);
        return _learningMetrics[tokenId];
    }

    /// @notice Record a prediction interaction outcome (token owner only)
    function recordInteraction(uint256 tokenId, bool success) external onlyTokenOwner(tokenId) {
        LearningMetrics storage metrics = _learningMetrics[tokenId];
        metrics.totalInteractions++;
        if (success) {
            metrics.successfulOutcomes++;
        }
        metrics.lastUpdated = block.timestamp;
        emit InteractionRecorded(tokenId, metrics.totalInteractions);
    }

    // ═══════════════════════════════════════════════════════════════
    // MEMORY MODULE REGISTRY (IMemoryModuleRegistry)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Register a memory module for the agent (token owner only)
    function registerModule(uint256 tokenId, address moduleAddress, string memory metadata)
        external
        onlyTokenOwner(tokenId)
    {
        _memoryModules[tokenId][moduleAddress] = MemoryModule({
            moduleAddress: moduleAddress,
            metadata: metadata,
            metadataHash: keccak256(abi.encodePacked(metadata)),
            registrationTime: block.timestamp,
            isActive: true
        });
        emit ModuleRegistered(tokenId, moduleAddress);
    }

    /// @notice Deactivate a memory module (token owner only)
    function deactivateModule(uint256 tokenId, address moduleAddress)
        external
        onlyTokenOwner(tokenId)
    {
        _memoryModules[tokenId][moduleAddress].isActive = false;
        emit ModuleDeactivated(tokenId, moduleAddress);
    }

    /// @notice Verify a module's metadata hash matches the expected hash
    function verifyModule(uint256 tokenId, address moduleAddress, bytes32 expectedHash)
        external
        view
        returns (bool)
    {
        return _memoryModules[tokenId][moduleAddress].metadataHash == expectedHash;
    }

    /// @notice Get a registered memory module's data
    function getModule(uint256 tokenId, address moduleAddress)
        external
        view
        returns (MemoryModule memory)
    {
        return _memoryModules[tokenId][moduleAddress];
    }

    // ═══════════════════════════════════════════════════════════════
    // VAULT PERMISSION MANAGER (IVaultPermissionManager)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Delegate vault access to another address (token owner only)
    function delegateAccess(uint256 tokenId, address delegate, PermissionLevel level, uint256 expiryTime)
        external
        onlyTokenOwner(tokenId)
    {
        _vaultPermissions[tokenId][delegate] = Permission({
            delegate: delegate,
            level: level,
            expiryTime: expiryTime,
            isActive: true
        });
        emit AccessDelegated(tokenId, delegate, level, expiryTime);
    }

    /// @notice Revoke a delegate's vault access (token owner only)
    function revokeAccess(uint256 tokenId, address delegate)
        external
        onlyTokenOwner(tokenId)
    {
        _vaultPermissions[tokenId][delegate].isActive = false;
        emit AccessRevoked(tokenId, delegate);
    }

    /// @notice Verify if an address has sufficient vault access level
    function verifyAccess(uint256 tokenId, address accessor, PermissionLevel requiredLevel)
        external
        view
        returns (bool)
    {
        Permission storage perm = _vaultPermissions[tokenId][accessor];
        if (!perm.isActive) return false;
        if (block.timestamp >= perm.expiryTime) return false;
        if (uint8(perm.level) < uint8(requiredLevel)) return false;
        return true;
    }

    /// @notice Get the permission details for a delegate
    function getPermission(uint256 tokenId, address delegate)
        external
        view
        returns (Permission memory)
    {
        return _vaultPermissions[tokenId][delegate];
    }

    function _getPredictionMarketBalance() internal view returns (uint256) {
        (bool success, bytes memory data) = predictionMarket.staticcall(
            abi.encodeWithSignature("balances(address)", address(this))
        );
        require(success && data.length >= 32, "Failed to read PM balance");
        return abi.decode(data, (uint256));
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN (Prediction Market Integration)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Set the PredictionMarket contract address (owner only)
    function setPredictionMarket(address _predictionMarket) external onlyOwner {
        require(_predictionMarket != address(0), "Invalid address");
        predictionMarket = _predictionMarket;
    }

    /// @notice Withdraw NFA's balance from PredictionMarket back to this contract
    function withdrawFromPredictionMarket(uint256 amount) external onlyOwner nonReentrant {
        require(predictionMarket != address(0), "Prediction market not set");
        require(amount > 0, "Amount must be > 0");
        uint256 pmBalance = _getPredictionMarketBalance();
        require(pmBalance >= totalAllocatedPredictionMarketBalance, "PM balance bookkeeping mismatch");
        uint256 unallocated = pmBalance - totalAllocatedPredictionMarketBalance;
        require(amount <= unallocated, "Amount exceeds unallocated PM balance");

        (bool success, ) = predictionMarket.call(
            abi.encodeWithSignature("withdraw(uint256)", amount)
        );
        require(success, "Withdraw from prediction market failed");
    }

    // ═══════════════════════════════════════════════════════════════
    // PREDICTION MARKET BRIDGE
    // ═══════════════════════════════════════════════════════════════

    event AgentDepositedToPM(uint256 indexed tokenId, uint256 amount);
    event AgentPositionViaPM(uint256 indexed tokenId, uint256 indexed marketId, bool isYes, uint256 amount);
    event AgentSplitViaPM(uint256 indexed tokenId, uint256 indexed marketId, uint256 amount);
    event AgentClaimedViaPM(uint256 indexed tokenId, uint256 indexed marketId);
    event AgentRefundViaPM(uint256 indexed tokenId, uint256 indexed marketId);
    event AgentWithdrewFromPM(uint256 indexed tokenId, uint256 amount);

    /// @notice Deposit agent's BNB into PredictionMarket balance (so agent can trade)
    function depositToPredictionMarket(uint256 tokenId, uint256 amount)
        external onlyTokenOwner(tokenId) onlyActiveAgent(tokenId) nonReentrant
    {
        require(predictionMarket != address(0), "Prediction market not set");
        require(amount > 0, "Amount must be > 0");
        require(_agentBalances[tokenId] >= amount, "Insufficient agent balance");
        _agentBalances[tokenId] -= amount;
        totalAgentBalances -= amount;
        (bool success, ) = predictionMarket.call{value: amount}(
            abi.encodeWithSignature("deposit()")
        );
        require(success, "Deposit failed");
        predictionMarketBalances[tokenId] += amount;
        totalAllocatedPredictionMarketBalance += amount;
        emit AgentDepositedToPM(tokenId, amount);
    }

    /// @notice Withdraw this agent's PredictionMarket balance back into local agent balance
    function withdrawFromPredictionMarketToAgent(uint256 tokenId, uint256 amount)
        external onlyTokenOwner(tokenId) nonReentrant
    {
        require(predictionMarket != address(0), "Prediction market not set");
        require(amount > 0, "Amount must be > 0");
        require(predictionMarketBalances[tokenId] >= amount, "Insufficient PM balance for agent");

        uint256 beforeBalance = address(this).balance;
        predictionMarketBalances[tokenId] -= amount;
        totalAllocatedPredictionMarketBalance -= amount;

        (bool success, ) = predictionMarket.call(
            abi.encodeWithSignature("withdraw(uint256)", amount)
        );
        require(success, "Withdraw failed");
        require(address(this).balance >= beforeBalance + amount, "Withdraw amount mismatch");

        _agentBalances[tokenId] += amount;
        totalAgentBalances += amount;
        emit AgentWithdrewFromPM(tokenId, amount);
    }

    /// @notice Take a YES/NO position on a market via PredictionMarket
    function agentPredictionTakePosition(uint256 tokenId, uint256 marketId, bool isYes, uint256 amount)
        external onlyTokenOwner(tokenId) onlyActiveAgent(tokenId) nonReentrant
    {
        require(predictionMarket != address(0), "Prediction market not set");
        require(amount > 0, "Amount must be > 0");
        require(predictionMarketBalances[tokenId] >= amount, "Insufficient PM balance for agent");
        predictionMarketBalances[tokenId] -= amount;
        totalAllocatedPredictionMarketBalance -= amount;
        (bool success, ) = predictionMarket.call(
            abi.encodeWithSignature("agentTakePosition(uint256,uint256,bool,uint256)", tokenId, marketId, isYes, amount)
        );
        require(success, "Take position failed");
        emit AgentPositionViaPM(tokenId, marketId, isYes, amount);
    }

    /// @notice Split collateral into YES+NO tokens via PredictionMarket (CTF)
    function agentPredictionSplitPosition(uint256 tokenId, uint256 marketId, uint256 amount)
        external onlyTokenOwner(tokenId) onlyActiveAgent(tokenId) nonReentrant
    {
        require(predictionMarket != address(0), "Prediction market not set");
        require(amount > 0, "Amount must be > 0");
        require(predictionMarketBalances[tokenId] >= amount, "Insufficient PM balance for agent");
        predictionMarketBalances[tokenId] -= amount;
        totalAllocatedPredictionMarketBalance -= amount;
        (bool success, ) = predictionMarket.call(
            abi.encodeWithSignature("agentSplitPosition(uint256,uint256,uint256)", tokenId, marketId, amount)
        );
        require(success, "Split position failed");
        emit AgentSplitViaPM(tokenId, marketId, amount);
    }

    /// @notice Claim agent winnings from a resolved market via PredictionMarket
    function agentPredictionClaimWinnings(uint256 tokenId, uint256 marketId)
        external onlyTokenOwner(tokenId) nonReentrant
    {
        require(predictionMarket != address(0), "Prediction market not set");
        uint256 pmBalanceBefore = _getPredictionMarketBalance();
        (bool success, ) = predictionMarket.call(
            abi.encodeWithSignature("agentClaimWinnings(uint256,uint256)", tokenId, marketId)
        );
        require(success, "Claim winnings failed");
        uint256 pmBalanceAfter = _getPredictionMarketBalance();
        require(pmBalanceAfter >= pmBalanceBefore, "Invalid PM balance delta");
        uint256 claimedAmount = pmBalanceAfter - pmBalanceBefore;
        if (claimedAmount > 0) {
            predictionMarketBalances[tokenId] += claimedAmount;
            totalAllocatedPredictionMarketBalance += claimedAmount;
        }
        emit AgentClaimedViaPM(tokenId, marketId);
    }

    /// @notice Claim agent refund from a cancelled market via PredictionMarket
    function agentPredictionClaimRefund(uint256 tokenId, uint256 marketId)
        external onlyTokenOwner(tokenId) nonReentrant
    {
        require(predictionMarket != address(0), "Prediction market not set");
        uint256 pmBalanceBefore = _getPredictionMarketBalance();
        (bool success, ) = predictionMarket.call(
            abi.encodeWithSignature("agentClaimRefund(uint256,uint256)", tokenId, marketId)
        );
        require(success, "Claim refund failed");
        uint256 pmBalanceAfter = _getPredictionMarketBalance();
        require(pmBalanceAfter >= pmBalanceBefore, "Invalid PM balance delta");
        uint256 claimedAmount = pmBalanceAfter - pmBalanceBefore;
        if (claimedAmount > 0) {
            predictionMarketBalances[tokenId] += claimedAmount;
            totalAllocatedPredictionMarketBalance += claimedAmount;
        }
        emit AgentRefundViaPM(tokenId, marketId);
    }

    // ═══════════════════════════════════════════════════════════════
    // ERC1155 RECEIVER (for CTF position tokens)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Handle receipt of a single ERC1155 token
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /// @notice Handle receipt of multiple ERC1155 tokens
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    /// @notice ERC165 interface support including ERC1155Receiver
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721Enumerable, IERC165) returns (bool) {
        return
            interfaceId == type(IERC1155Receiver).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
