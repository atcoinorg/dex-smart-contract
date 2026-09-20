// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ERC20-ATCOIN (Event-Only Bridge)
 * @author W-DEVELOP Group developing.w@gmail.com
 * @dev https://github.com/atcoinorg/atcoin
 * @notice Wrapper Token for Custodial Bridge EVM ATCOIN.
 *         The 1:1 economic model is secured by off-chain ATCOIN reserves
 *         VERSION = 1.0.0
 * @dev ERC20 token simulating ATCOIN
 */
contract ATCOINCore is Initializable, ERC20Upgradeable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    // The maximum number of ERC20-ATCOIN tokens that can be issued
    // ATCOIN 8_820_000_000_000_000_000
    uint64 public constant MAX_ATCOIN_UNITS = 8820000000000000000;

    // Minimum withdrawal amount
    uint64 public constant MIN_WITHDRAW = 10000000; // 0.1 ATCOIN

    // Maximum number of transactions in one batch
    uint256 public constant MAX_BATCH = 200;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Counters for indexing (useful for parsing events and checking order).
    uint256 public mintDepositNonce; // ++ On each successful mint
    uint256 public burnNonce;        // ++ On each successful burn

    // Selective pause for mint
    bool public mintPaused;
    // Selective pause for burn
    bool public burnPaused;

    // Mapping: address → true if blacklisted
    mapping(address => bool) private blacklisted;
    // ATCOIN address for withdrawal
    mapping(address => string) private atcoinWallet;
    //
    mapping(uint256 => bool) public burnNonceListCompleted;

    error AmountTooLow();
    error BatchTooLarge();
    error ExceedsMaxSupply();
    error InsufficientBalance();
    error InvalidUserAddress();
    error InvalidTxId();
    error InvalidAmount();
    error LenMismatch();
    error BurnPaused();
    error MintPaused();
    error BlackListed();
    error TransfersPaused();
    error RoleAlreadyGranted();
    error ReentrancyGuard();
    error InvalidATCOINAddress();
    error ATCOINWalletNotRegistered();

    event DepositMinted(address indexed user, uint64 amount, string atcoinWallet, string atcoinTxId, uint256 indexed nonce);

    event WithdrawRequested(address indexed from, uint64 amount, string atcoinAddress, uint256 indexed nonce);
    event WithdrawCompleted(address indexed to, uint64 amount, string atcoinTxId, uint256 indexed nonce);

    event PausedEvent(address indexed by);
    event UnpausedEvent(address indexed by);
    event PausedByMintEvent(address indexed by);
    event UnpausedByMintEvent(address indexed by);
    event PausedByBurnEvent(address indexed by);
    event UnpausedByBurnEvent(address indexed by);

    event BlacklistUpdatedEvent(address indexed user, bool value);

    event GrantPauserRoleEvent(bytes32 indexed role, address indexed to);
    event RevokePauserRoleEvent(bytes32 indexed role, address indexed from);
    event GrantMinterRoleEvent(bytes32 indexed role, address indexed to);
    event RevokeMinterRoleEvent(bytes32 indexed role, address indexed from);
    event GrantAdminRoleEvent(bytes32 indexed role, address indexed to);
    event RevokeAdminRoleEvent(bytes32 indexed role, address indexed from);
    event ATCOINWalletRegistered(address indexed user, string atcoinAddress);

    event EmergencyWithdrawERC20(address token, address to, uint256 amount);

    /// @dev Initialized only through a proxy
    constructor() {
        _disableInitializers();
    }
    
    /// @dev Disallow upgrade without code verification
    /// @param newImplementation Address of the new contract
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @dev Reentrancy protection (reentrancy)
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    /// @notice Contract initialization for Proxy
    /// @param initialOwner Contract owner
    function initialize(address initialOwner) public initializer {
        __ERC20_init("EVM ATCOIN", "ATCOIN");
        __Ownable_init(initialOwner); // Owner assignment
        __Pausable_init();
        __AccessControl_init();

        // Assign roles
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);

        // nonReentrant init
        _status = _NOT_ENTERED;
    }

    /// @notice Pause user bridge operations, except for _mint and _burn
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit PausedEvent(msg.sender);
    }

    /// @notice Enable user bridge operations, except for _mint and _burn
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
        emit UnpausedEvent(msg.sender);
    }

    /// @notice Forced pause for mint
    function pauseByMint() external onlyRole(PAUSER_ROLE) {
        if (!mintPaused) {
            mintPaused = true;
            emit PausedByMintEvent(msg.sender);
        }
    }

    /// @notice Forced unpause for minting
    function unpauseByMint() external onlyRole(PAUSER_ROLE) {
        if (mintPaused) {
            mintPaused = false;
            emit UnpausedByMintEvent(msg.sender);
        }
    }

    /// @notice Forced pause for burn
    function pauseByBurn() external onlyRole(PAUSER_ROLE) {
        if (!burnPaused) {
            burnPaused = true;
            emit PausedByBurnEvent(msg.sender);
        }
    }

    /// @notice Forced unpause for burn
    function unpauseByBurn() external onlyRole(PAUSER_ROLE) {
        if (burnPaused) {
            burnPaused = false;
            emit UnpausedByBurnEvent(msg.sender);
        }
    }

    /// @notice Add or remove a user from the blacklist
    /// @param user User address
    /// @param value true — block, false — unblock
    /// @dev Admins only
    function setBlacklist(address user, bool value) external onlyRole(ADMIN_ROLE) {
        if (user == address(0)) revert InvalidUserAddress();
        blacklisted[user] = value;
        emit BlacklistUpdatedEvent(user, value);
    }

    /// @notice Checks if the user is blocked
    /// @param user User address
    function isBlacklisted(address user) external view returns (bool) {
        return blacklisted[user];
    }

    /// @notice Logic for minting new EVM ATCOIN for multiple users
    /// @param users - Users to mint EVM ATCOIN for
    /// @param amounts - Amount of tokens withdrawn
    /// @param atcoinMintWallet - Wallet in ATCOIN network
    /// @param atcoinTxIds - Transaction hashes on the ATCOIN network
    function batchMintDepositEVMATCOINHandler(
        address[] calldata users,
        uint64[] calldata amounts,
        string[] calldata atcoinMintWallet,
        string[] calldata atcoinTxIds
    ) external onlyRole(MINTER_ROLE) {
        if (mintPaused) revert MintPaused();
        uint256 uLen = users.length;
        uint256 totalAmounts = 0;
 
        if (uLen == 0 || uLen != amounts.length || uLen != atcoinMintWallet.length || uLen != atcoinTxIds.length) revert LenMismatch();
        if (uLen > MAX_BATCH) revert BatchTooLarge();


        for (uint256 i; i < uLen; ++i) {
            totalAmounts = totalAmounts + amounts[i];
        }
        if (totalSupply() + totalAmounts > MAX_ATCOIN_UNITS) revert ExceedsMaxSupply();
        for (uint256 i; i < uLen; ++i) {
            // Executes the _mint event from the backend
            _mint(users[i], amounts[i]);

            // Send an event to the backend
            emit DepositMinted(users[i], amounts[i], atcoinMintWallet[i], atcoinTxIds[i], ++mintDepositNonce);
        }
    }

    /// @notice Returns the registered ATCOIN wallet for an EVM user
    /// @param user EVM user address
    function getATCOINWallet(address user) external view returns (string memory) {
        return atcoinWallet[user];
    }

    /// @notice User burns EVM ATCOIN to receive ATCOIN via the bridge
    /// @param withdrawAmount — Amount of tokens the user wants to convert back
    function withdrawalRequest(
        uint64 withdrawAmount
    ) external nonReentrant {
        if (blacklisted[msg.sender]) revert BlackListed();
        if (burnPaused) revert BurnPaused();

        if (bytes(atcoinWallet[msg.sender]).length == 0) {
            revert ATCOINWalletNotRegistered();
        }

        // Balance amount of the msg.sender holder
        uint256 balance = balanceOf(msg.sender);

        // Check that the user has sufficient funds
        if (withdrawAmount > balance) revert InsufficientBalance();
        if (withdrawAmount < MIN_WITHDRAW) revert AmountTooLow();
        if (withdrawAmount > MAX_ATCOIN_UNITS) revert InvalidAmount();
        
        _burn(msg.sender, withdrawAmount);

        // Send an event to the backend
        emit WithdrawRequested(msg.sender, withdrawAmount, atcoinWallet[msg.sender], ++burnNonce);
    }

    /// @notice Register an ATCOIN address to receive exchanges from the msg.sender address.
    /// @dev Only addresses approved on the backend will be converted from EVM ATCOIN to ATCOIN.
    /// @param atcoinAddress — Address to map in the ATCOIN network
    function registerEVMATCOINToATCOINWallet(
        string calldata atcoinAddress
    ) external whenNotPaused {
        if (blacklisted[msg.sender]) revert BlackListed();

        if (bytes(atcoinAddress).length == 0) {
            revert InvalidATCOINAddress();
        }

        atcoinWallet[msg.sender] = atcoinAddress;

        emit ATCOINWalletRegistered(
            msg.sender,
            atcoinAddress
        );
    }

    /// @notice Logic for completing ATCOIN withdrawals, bulk withdrawal trusted report
    /// @param evmUsers - Recipient addresses in the EVM ATCOIN network
    /// @param amounts - Amount of tokens withdrawn
    /// @param atcoinTxIds - Transaction hashes on the ATCOIN network
    /// @param burnNoncesCompleted - Transaction numbers in the EVM network
    function batchWithdrawCompleted(
        address[] calldata evmUsers,
        uint64[] calldata amounts,
        string[] calldata atcoinTxIds,
        uint256[] calldata burnNoncesCompleted
    ) external onlyRole(ADMIN_ROLE) {
        uint256 uLen = evmUsers.length;
 
        if (uLen > MAX_BATCH) revert BatchTooLarge();
        if (uLen == 0 || uLen != amounts.length || uLen != atcoinTxIds.length || uLen != burnNoncesCompleted.length) revert LenMismatch();

        for (uint256 i; i < uLen; ++i) {
            if (burnNoncesCompleted[i] != 0 && burnNonce >= burnNoncesCompleted[i] && !burnNonceListCompleted[burnNoncesCompleted[i]]) {
                burnNonceListCompleted[burnNoncesCompleted[i]] = true;
                // Send an event as a completion report 
                emit WithdrawCompleted(evmUsers[i], amounts[i], atcoinTxIds[i], burnNoncesCompleted[i]);
            }
        }
    }

    /// @notice Override OpenZeppelin ERC20 to block transfers when paused
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (blacklisted[from] || blacklisted[to]) {
            revert BlackListed();
        }

        // We only prohibit regular transfers during pauses.
        // Mint (from == address(0)) and Burn (to == address(0)) remain allowed.
        if (paused() && from != address(0) && to != address(0)) {
            revert TransfersPaused();
        }

        super._update(from, to, amount);
    }

    /// @notice Blocks allowance spending involving blacklisted accounts.
    /// @dev Prevents a blacklisted spender from bypassing blacklist restrictions
    ///      by calling transferFrom on behalf of another token holder.
    ///      Standard allowance validation and deduction are handled by OpenZeppelin.
    function _spendAllowance(
        address owner_,
        address spender,
        uint256 value
    ) internal override {
        if (blacklisted[owner_] || blacklisted[spender]) {
            revert BlackListed();
        }

        super._spendAllowance(owner_, spender, value);
    }

    /// @notice Override OpenZeppelin ERC20 to simulate ATCOIN-like 8-decimal precision
    function decimals() public pure override returns (uint8) {
        return 8;
    }

    /// @notice Assign Admin role
    /// @param account Role recipient address
    function grantAdminRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidUserAddress();
        if (hasRole(ADMIN_ROLE, account)) revert RoleAlreadyGranted();
        _grantRole(ADMIN_ROLE, account);

        emit GrantAdminRoleEvent(ADMIN_ROLE, account);
    }

    /// @notice Revoke Admin role
    /// @param account Role recipient address
    function revokeAdminRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidUserAddress();
        _revokeRole(ADMIN_ROLE, account);

        emit RevokeAdminRoleEvent(ADMIN_ROLE, account);
    }

    /// @notice Assign Minter role
    /// @param account Role recipient address
    function grantMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidUserAddress();
        if (hasRole(MINTER_ROLE, account)) revert RoleAlreadyGranted();
        _grantRole(MINTER_ROLE, account);

        emit GrantMinterRoleEvent(MINTER_ROLE, account);
    }

    /// @notice Revoke Minter role
    /// @param account Role recipient address
    function revokeMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidUserAddress();
        _revokeRole(MINTER_ROLE, account);

        emit RevokeMinterRoleEvent(MINTER_ROLE, account);
    }

    /// @notice Assign Pauser role
    /// @param account Role recipient address
    function grantPauserRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidUserAddress();
        if (hasRole(PAUSER_ROLE, account)) revert RoleAlreadyGranted();
        _grantRole(PAUSER_ROLE, account);

        emit GrantPauserRoleEvent(PAUSER_ROLE, account);
    }

    /// @notice Revoke Pauser role
    /// @param account Role recipient address
    function revokePauserRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(PAUSER_ROLE, account);

        emit RevokePauserRoleEvent(PAUSER_ROLE, account);
    }

    /// @notice Query Super Admin status
    /// @param user User address
    function isSuperAdmin(address user) external view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, user);
    }

    /// @notice Query Admin status
    /// @param user User address
    function isAdmin(address user) external view returns (bool) {
        return hasRole(ADMIN_ROLE, user);
    }

    /// @notice Query Minter status
    /// @param user User address
    function isMinter(address user) external view returns (bool) {
        return hasRole(MINTER_ROLE, user);
    }

    /// @notice Query Pauser status
    /// @param user User address
    function isPauser(address user) external view returns (bool) {
        return hasRole(PAUSER_ROLE, user);
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuard();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    /// @notice Withdraw tokens from the contract (in case of a critical error)
    /// @dev Allows the owner/admin to recover tokens (e.g., accidentally stuck in the contract).
    /// @param token Token address
    /// @param to Recipient address
    /// @param amount Token amount
    function emergencyWithdrawERC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(to, amount);

        emit EmergencyWithdrawERC20(token, to, amount);
    }
}
