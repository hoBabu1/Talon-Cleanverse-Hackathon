// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title EscrowVault — the Omnibus engine
/// @notice Holds pooled A-Tokens for holders whose entitlement could not be paid directly
/// (their A-Pass was expired or frozen at pay-date). Keeps a per-beneficiary sub-ledger so
/// pooled custody never loses track of who owns what.
///
/// @dev Core invariant, enforced by fuzz/invariant tests, not just convention:
///     sum(ledger[*][token]) <= token.balanceOf(address(this))
/// It is `<=`, not `==` — anyone can donate tokens to this contract unasked, and a donation
/// must never be able to falsify the invariant. `skim` recovers exactly that surplus and
/// nothing ledger-backed. See smartContractPhase.md §1 (and its [RT]/[RT2]/[P0] corrections)
/// for the full design history; do not deviate from it without discussing why.
///
/// @dev We deliberately do NOT reimplement Cleanverse's compliance checks. Its A-Token reverts
/// `APassNotActive(address offender)` on-chain when a party isn't currently eligible (proven
/// empirically — see /learning.md). Escrow release is simply a retry of a real transfer:
/// success means Cleanverse itself has confirmed the beneficiary is eligible again.
///
/// @dev [P0-1] Custody requires this contract to hold its own A-Pass (a plain `/generate_apass`
/// call for its address — NOT Validator pool registration, which isn't even configured for
/// Monad in the sandbox this was proven against). The A-Token checks the SENDER side too, so
/// if this vault's own A-Pass ever lapses, every beneficiary's `claim`/`release` breaks at
/// once — through no fault of theirs. Mitigated operationally (far-future expiry, backend
/// monitoring) and diagnostically in CorporateActionManager (`VaultNotEligible`).
contract EscrowVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice beneficiary => token => amount owed to them, held in this contract.
    mapping(address beneficiary => mapping(address token => uint256 amount)) public ledger;

    /// @notice token => total amount currently owed across all beneficiaries. Stored, never
    /// recomputed by summing the ledger — that sum is unbounded and would break at scale.
    mapping(address token => uint256 amount) public totalHeld;

    /// @dev token => set of beneficiaries with a nonzero ledger entry. Lets the frontend
    /// enumerate the omnibus pool from raw RPC if the backend indexer dies mid-demo.
    mapping(address token => EnumerableSet.AddressSet) private _beneficiaries;

    /// @notice The CorporateActionManager currently allowed to call `deposit`.
    /// @dev Mutable, not set-once — [RT2] a CAM redeploy (the likeliest mid-window redeploy)
    /// must not force a full vault redeploy too, which would strand escrowed funds under the
    /// old vault. Mutability adds no attacker leverage: the owner who could re-point this could
    /// equally deploy a fresh vault, and `deposit` only ever credits real beneficiaries with
    /// real token pulls — it cannot be used to fabricate a credit.
    address public authorizedDepositor;

    event Deposited(
        address indexed beneficiary,
        address indexed token,
        uint256 amount,
        uint256 indexed actionId,
        bytes4 reasonSelector,
        address offender
    );
    event Released(address indexed beneficiary, address indexed token, uint256 amount, address trigger);
    event Skimmed(address indexed token, uint256 amount);
    event AuthorizedDepositorSet(address indexed oldDepositor, address indexed newDepositor);

    error NotAuthorizedDepositor(address caller);
    error ZeroBeneficiary();
    error ZeroAmount();
    error NothingOwed(address beneficiary, address token);
    error NothingToSkim(address token);

    modifier onlyAuthorizedDepositor() {
        _checkAuthorizedDepositor();
        _;
    }

    function _checkAuthorizedDepositor() internal view {
        if (msg.sender != authorizedDepositor) revert NotAuthorizedDepositor(msg.sender);
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Owner-only: points this vault at the CorporateActionManager allowed to escrow
    /// into it. See `authorizedDepositor` NatSpec for why this is mutable.
    function setAuthorizedDepositor(address newDepositor) external onlyOwner {
        address old = authorizedDepositor;
        authorizedDepositor = newDepositor;
        emit AuthorizedDepositorSet(old, newDepositor);
    }

    /// @notice Escrows `amount` of `token` for `beneficiary`, pulled from `from` (the issuer).
    /// @dev Only the authorized CAM may call this. `from` is explicit rather than `msg.sender`
    /// because the CAM never holds tokens itself (smartContractPhase.md §2.3) — it passes its
    /// own `owner()` (the issuer), who must have approved this vault directly.
    /// `reasonSelector`/`offender` are derived by the CAM from the actual revert it saw, never
    /// issuer-authored free text — an audit trail must not be able to lie about why money moved.
    /// @dev Credits the ledger with the requested `amount`, not the observed post-transfer
    /// balance delta. This is safe for the real Cleanverse A-Token (standard-behaved, confirmed
    /// by the Phase 0 spike) but would falsify `Σ ledger <= balanceOf` for a fee-on-transfer or
    /// deflationary token. This contract has no token-shape validation of its own — that
    /// protection is CorporateActionManager's `allowedToken` allowlist (§2.1), checked once at
    /// `declareAction`. Do not treat this contract as safe in isolation against an arbitrary
    /// caller-supplied `token`.
    function deposit(
        address from,
        address beneficiary,
        address token,
        uint256 amount,
        uint256 actionId,
        bytes4 reasonSelector,
        address offender
    ) external onlyAuthorizedDepositor nonReentrant {
        if (beneficiary == address(0)) revert ZeroBeneficiary();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(from, address(this), amount);

        ledger[beneficiary][token] += amount;
        totalHeld[token] += amount;
        _beneficiaries[token].add(beneficiary); // no-op if already present; re-adds after a prior full claim

        emit Deposited(beneficiary, token, amount, actionId, reasonSelector, offender);
    }

    /// @notice Beneficiary-triggered claim of their own escrowed `token` balance.
    function claim(address token) external nonReentrant {
        _release(msg.sender, token);
    }

    /// @notice Permissionless retry: anyone may trigger a release on behalf of `beneficiary`.
    /// Funds only ever move to `beneficiary` — this can never be used to steal or redirect.
    function release(address beneficiary, address token) external nonReentrant {
        _release(beneficiary, token);
    }

    /// @dev Shared by `claim`/`release`. NOT an external self-call — `this.release(...)` would
    /// re-enter the shared `nonReentrant` guard and block every claim. [RT2]
    /// @dev Effects-before-interaction, revert-through, no manual state restore: if the
    /// transfer reverts (beneficiary still ineligible), the EVM unwinds every effect below for
    /// free. An earlier draft zeroed-then-restored the ledger entry on failure, which silently
    /// discards any reentrant credit that landed during the external call — this pattern has no
    /// such bug because there is nothing to restore. [RT]
    function _release(address beneficiary, address token) internal {
        uint256 amt = ledger[beneficiary][token];
        if (amt == 0) revert NothingOwed(beneficiary, token);

        ledger[beneficiary][token] = 0;
        totalHeld[token] -= amt;
        _beneficiaries[token].remove(beneficiary);

        emit Released(beneficiary, token, amt, msg.sender);

        // Still ineligible => reverts => whole tx reverts => ledger intact, nothing lost.
        IERC20(token).safeTransfer(beneficiary, amt);
    }

    /// @notice Owner-only sweep of any surplus over `totalHeld[token]` — i.e. tokens donated
    /// to this contract unasked. Can never touch ledger-backed funds: the transferred amount is
    /// exactly `balanceOf(this) - totalHeld[token]`, so a beneficiary's claim is unaffected.
    function skim(address token) external onlyOwner nonReentrant {
        uint256 surplus = IERC20(token).balanceOf(address(this)) - totalHeld[token];
        if (surplus == 0) revert NothingToSkim(token);
        IERC20(token).safeTransfer(owner(), surplus);
        emit Skimmed(token, surplus);
    }

    /// @notice Amount of `token` currently owed to `beneficiary`.
    function ledgerOf(address beneficiary, address token) external view returns (uint256) {
        return ledger[beneficiary][token];
    }

    /// @notice Total amount of `token` currently owed across all beneficiaries.
    function totalHeldOf(address token) external view returns (uint256) {
        return totalHeld[token];
    }

    /// @notice Full beneficiary set for `token`. Unbounded — prefer the paginated overload for
    /// large sets, since this can exceed RPC gas/response limits.
    function beneficiariesOf(address token) external view returns (address[] memory) {
        return _beneficiaries[token].values();
    }

    /// @notice Paginated beneficiary enumeration: `count` addresses starting at `start`.
    /// [RT2] Exists so the raw-RPC fallback (frontend renders `/escrow` without the backend)
    /// stays viable even when a beneficiary set grows past what a single unbounded call can
    /// return. Clamps `count` to the remaining length; returns an empty array if `start` is at
    /// or past the end.
    function beneficiariesOf(address token, uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 len = _beneficiaries[token].length();
        if (start >= len) return new address[](0);
        uint256 end = start + count;
        if (end > len) end = len;
        address[] memory page = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = _beneficiaries[token].at(i);
        }
        return page;
    }

    /// @notice Number of distinct beneficiaries currently owed `token`.
    function beneficiaryCount(address token) external view returns (uint256) {
        return _beneficiaries[token].length();
    }
}
