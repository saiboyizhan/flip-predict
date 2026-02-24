// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "./interfaces/IBAP578.sol";

/// @title BAP578Base - Non-Fungible Agent Standard (BNB Agent Protocol 578)
/// @notice Abstract base contract implementing the BAP-578 agent NFT standard.
///         Provides agent lifecycle management, metadata, funding, and extensibility.
/// @dev Derived contracts add domain-specific features (prediction, trading, etc.)
abstract contract BAP578Base is ERC721Enumerable, ReentrancyGuard, Pausable, Ownable, IBAP578 {

    // ─── Constants ───────────────────────────────────────────────
    uint256 public constant MAX_AGENTS_PER_ADDRESS = 3;

    // ─── State ───────────────────────────────────────────────────
    IERC20 public usdtToken;
    IERC20 public flipToken;
    uint256 public mintPrice;
    uint256 internal _nextTokenId;
    string internal _baseTokenURI;

    mapping(uint256 => AgentState) internal _agentStates;
    mapping(uint256 => AgentMetadata) internal _agentMetadata;
    mapping(uint256 => address) internal _logicAddresses;
    mapping(uint256 => uint256) internal _agentBalances;
    uint256 public totalAgentBalances;
    mapping(address => uint256) public mintCount;

    // ─── Events (BAP-578 extension, not in IBAP578) ──────────────
    event VaultUpdated(uint256 indexed tokenId, string vaultURI, bytes32 vaultHash);

    // ─── Modifiers ───────────────────────────────────────────────
    modifier onlyTokenOwner(uint256 tokenId) {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");
        _;
    }

    modifier onlyActiveAgent(uint256 tokenId) {
        require(_agentStates[tokenId] == AgentState.ACTIVE, "Agent not active");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────
    constructor(
        string memory name_,
        string memory symbol_,
        address _usdtToken,
        address _flipToken,
        uint256 _mintPrice
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        require(_usdtToken != address(0), "Invalid USDT address");
        require(_flipToken != address(0), "Invalid FLIP address");
        usdtToken = IERC20(_usdtToken);
        flipToken = IERC20(_flipToken);
        mintPrice = _mintPrice;
    }

    // ═══════════════════════════════════════════════════════════════
    // MINTING
    // ═══════════════════════════════════════════════════════════════

    /// @notice Mint a new agent NFT (max 3 per address, requires BNB payment)
    /// @param metadata Agent metadata conforming to BAP-578 standard
    /// @return tokenId The minted NFT token ID
    function mint(AgentMetadata calldata metadata)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        require(mintCount[msg.sender] < MAX_AGENTS_PER_ADDRESS, "Max agents per address reached");
        require(msg.value >= mintPrice, "Insufficient BNB");
        uint256 tokenId = _nextTokenId++;
        mintCount[msg.sender]++;
        _safeMint(msg.sender, tokenId);
        _agentMetadata[tokenId] = metadata;
        _agentStates[tokenId] = AgentState.ACTIVE;
        return tokenId;
    }

    /// @notice Get the number of agents minted by an address
    function getMintCount(address account) external view returns (uint256) {
        return mintCount[account];
    }

    // ═══════════════════════════════════════════════════════════════
    // AGENT LIFECYCLE (BAP-578)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Pause an active agent
    function pauseAgent(uint256 tokenId) external onlyTokenOwner(tokenId) {
        require(_agentStates[tokenId] == AgentState.ACTIVE, "Agent not active");
        _agentStates[tokenId] = AgentState.PAUSED;
        emit AgentPaused(tokenId);
    }

    /// @notice Unpause a paused agent
    function unpauseAgent(uint256 tokenId) external onlyTokenOwner(tokenId) {
        require(_agentStates[tokenId] == AgentState.PAUSED, "Agent not paused");
        _agentStates[tokenId] = AgentState.ACTIVE;
        emit AgentUnpaused(tokenId);
    }

    /// @notice Permanently terminate an agent (irreversible)
    function terminateAgent(uint256 tokenId) external onlyTokenOwner(tokenId) {
        require(_agentStates[tokenId] != AgentState.TERMINATED, "Already terminated");
        _agentStates[tokenId] = AgentState.TERMINATED;
        emit AgentTerminated(tokenId);
    }

    /// @notice Get the current state of an agent
    function getState(uint256 tokenId) external view returns (AgentState) {
        _requireOwned(tokenId);
        return _agentStates[tokenId];
    }

    // ═══════════════════════════════════════════════════════════════
    // FUNDING (BAP-578)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Fund an active agent with USDT (anyone can fund)
    function fundAgent(uint256 tokenId, uint256 amount) external onlyActiveAgent(tokenId) {
        require(amount > 0, "Amount must be > 0");
        require(usdtToken.transferFrom(msg.sender, address(this), amount), "USDT transfer failed");
        _agentBalances[tokenId] += amount;
        totalAgentBalances += amount;
        emit AgentFunded(tokenId, amount);
    }

    /// @notice Withdraw USDT from an agent (token owner only, works when terminated)
    function withdrawFromAgent(uint256 tokenId, uint256 amount)
        external
        onlyTokenOwner(tokenId)
        nonReentrant
    {
        require(amount > 0, "Amount must be > 0");
        require(_agentBalances[tokenId] >= amount, "Insufficient agent balance");
        _agentBalances[tokenId] -= amount;
        totalAgentBalances -= amount;
        require(usdtToken.transfer(msg.sender, amount), "USDT transfer failed");
        emit AgentWithdrawn(tokenId, amount);
    }

    /// @notice Get the USDT balance of an agent
    function getAgentBalance(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return _agentBalances[tokenId];
    }

    // ═══════════════════════════════════════════════════════════════
    // METADATA (BAP-578)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Get the full metadata of an agent
    function getAgentMetadata(uint256 tokenId) external view returns (AgentMetadata memory) {
        _requireOwned(tokenId);
        return _agentMetadata[tokenId];
    }

    /// @notice Update the agent's metadata
    function updateAgentMetadata(uint256 tokenId, AgentMetadata calldata metadata)
        external
        onlyTokenOwner(tokenId)
    {
        _agentMetadata[tokenId] = metadata;
        emit MetadataUpdated(tokenId);
    }

    /// @notice Update the agent's vault URI and hash
    function updateVault(uint256 tokenId, string calldata newVaultURI, bytes32 newVaultHash)
        external
        onlyTokenOwner(tokenId)
    {
        _agentMetadata[tokenId].vaultURI = newVaultURI;
        _agentMetadata[tokenId].vaultHash = newVaultHash;
        emit VaultUpdated(tokenId, newVaultURI, newVaultHash);
    }

    // ═══════════════════════════════════════════════════════════════
    // LOGIC ADDRESS (BAP-578)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Set the external logic contract for executeAction
    function setLogicAddress(uint256 tokenId, address logic)
        external
        onlyTokenOwner(tokenId)
    {
        _logicAddresses[tokenId] = logic;
        emit LogicAddressUpdated(tokenId, logic);
    }

    /// @notice Execute an action via the agent's logic contract
    function executeAction(uint256 tokenId, bytes calldata data)
        external
        onlyTokenOwner(tokenId)
        onlyActiveAgent(tokenId)
        nonReentrant
        returns (bytes memory)
    {
        address logic = _logicAddresses[tokenId];
        require(logic != address(0), "No logic address set");
        (bool success, bytes memory result) = logic.call(data);
        require(success, "Action execution failed");
        emit ActionExecuted(tokenId, result);
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // TOKEN URI
    // ═══════════════════════════════════════════════════════════════

    /// @notice Set the base URI for token metadata (owner only)
    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string(abi.encodePacked(_baseTokenURI, Strings.toString(tokenId), ".json"));
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Update the mint price in BNB (owner only)
    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
    }

    /// @notice Withdraw collected BNB from mint fees (owner only)
    function withdrawBNB(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0 && amount <= address(this).balance, "Invalid amount");
        (bool ok, ) = payable(owner()).call{value: amount}("");
        require(ok, "BNB transfer failed");
    }

    /// @notice Withdraw collected FLIP tokens from mint fees (owner only)
    function withdrawFlipTokens(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(flipToken.transfer(owner(), amount), "FLIP transfer failed");
    }

    /// @notice Withdraw surplus USDT not belonging to agent balances
    function withdrawSurplus(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        uint256 usdtBalance = usdtToken.balanceOf(address(this));
        require(usdtBalance >= totalAgentBalances, "Balance inconsistency");
        uint256 available = usdtBalance - totalAgentBalances;
        require(amount <= available, "Exceeds available surplus");
        require(usdtToken.transfer(owner(), amount), "USDT transfer failed");
    }

    receive() external payable {}
}
