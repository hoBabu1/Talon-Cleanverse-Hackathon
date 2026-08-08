// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

/// @notice Combined-system handler (smartContractPhase.md §3.3, Phase 3 pre-deploy gate):
/// random sequencing across BOTH contracts through their REAL wiring — CAM's escrow leg
/// actually deposits into the vault, beneficiaries actually claim/release from the vault
/// afterward, donations and mid-run freezes are mixed in throughout. This deliberately does
/// NOT call `vault.deposit` directly (that bypass is already covered in isolation by Phase 1's
/// own handler) — every escrow credit here is a real consequence of `executePayoutRun`.
contract CombinedHandler is Test {
    EscrowVault public vault;
    CorporateActionManager public cam;
    MockAToken public token;
    address public issuer;

    address[] public holders;
    uint256[] public actionIds;

    /// @dev Ghost sums for I2 (per action) and I3 (vault-wide), since the structs themselves
    /// only store counts/current balances, not lifetime totals.
    mapping(uint256 actionId => uint256) public sumProcessed;
    uint256 public sumDeposited; // vault-wide, across every successful CAM escrow leg
    uint256 public sumReleased; // vault-wide, across every successful claim/release

    constructor(EscrowVault _vault, CorporateActionManager _cam, MockAToken _token, address _issuer) {
        vault = _vault;
        cam = _cam;
        token = _token;
        issuer = _issuer;

        for (uint256 i = 0; i < 5; i++) {
            holders.push(address(uint160(uint256(keccak256(abi.encode("combinedActor", i))))));
        }
    }

    function _holder(uint256 seed) internal view returns (address) {
        return holders[seed % holders.length];
    }

    /// @dev `totalHolders: 0` and `holderSetHash: bytes32(0)` deliberately mean this handler
    /// never targets full-coverage close — a fuzzed handler can't pre-commit a chained hash for
    /// holder/amount picks it hasn't made yet, so trying to reach full coverage here would mean
    /// either scripting the "random" sequence (defeats the point of fuzzing) or accepting
    /// spurious `CoverageHashMismatch` reverts that would pollute the revert-tracking in
    /// `forge test`'s summary. Full-coverage/chained-hash close through the real cross-contract
    /// wiring is deliberately covered instead by scripted tests in `test/unit/Combined.t.sol`.
    /// This handler's job is fund-conservation (I1-I4) under arbitrary sequencing, which does
    /// not require ever closing an action at all — `totalHolders: 0` just keeps every close
    /// attempt in the "partial coverage" branch, which never touches the hash.
    function declare(uint256 totalAmountSeed) external {
        uint256 totalAmount = bound(totalAmountSeed, 1, 1e12);
        vm.prank(issuer);
        uint256 id = cam.declareAction(address(token), address(token), block.number, totalAmount, bytes32(0), 0, 0);
        actionIds.push(id);
    }

    function executeBatch(uint256 actionSeed, uint256 holderSeed, uint256 amountSeed) external {
        if (actionIds.length == 0) return;
        uint256 actionId = actionIds[actionSeed % actionIds.length];

        CorporateActionManager.CorporateAction memory action = cam.getAction(actionId);
        if (action.status == CorporateActionManager.ActionStatus.Closed) return;
        if (action.remainingBudget == 0) return;

        address holder = _holder(holderSeed);
        if (cam.holderStatusOf(actionId, holder) != CorporateActionManager.HolderStatus.None) return;

        uint256 amt = bound(amountSeed, 1, action.remainingBudget);
        token.mint(issuer, amt);

        address[] memory hs = new address[](1);
        hs[0] = holder;
        uint256[] memory amts = new uint256[](1);
        amts[0] = amt;

        uint256 ledgerBefore = vault.ledger(holder, address(token));
        vm.prank(issuer);
        try cam.executePayoutRun(actionId, hs, amts) {
            sumProcessed[actionId] += amt;
            uint256 ledgerAfter = vault.ledger(holder, address(token));
            if (ledgerAfter > ledgerBefore) {
                sumDeposited += (ledgerAfter - ledgerBefore); // this specific call escrowed
            }
        } catch {}
    }

    function close(uint256 actionSeed) external {
        if (actionIds.length == 0) return;
        uint256 actionId = actionIds[actionSeed % actionIds.length];
        vm.prank(issuer);
        try cam.closeAction(actionId) {} catch {}
    }

    function claim(uint256 holderSeed) external {
        address holder = _holder(holderSeed);
        uint256 owed = vault.ledger(holder, address(token));
        vm.prank(holder);
        try vault.claim(address(token)) {
            sumReleased += owed;
        } catch {}
    }

    function release(uint256 holderSeed, uint256 callerSeed) external {
        address holder = _holder(holderSeed);
        address caller = _holder(callerSeed); // permissionless — any actor may trigger it
        uint256 owed = vault.ledger(holder, address(token));
        vm.prank(caller);
        try vault.release(holder, address(token)) {
            sumReleased += owed;
        } catch {}
    }

    function donate(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1e12);
        token.mint(address(vault), amount);
    }

    function freeze(uint256 holderSeed) external {
        token.setFrozen(_holder(holderSeed), true);
    }

    function unfreeze(uint256 holderSeed) external {
        token.setFrozen(_holder(holderSeed), false);
    }

    function skim() external {
        vm.prank(issuer); // vault owner == issuer in this deployment
        try vault.skim(address(token)) {} catch {}
    }

    function actionIdsLength() external view returns (uint256) {
        return actionIds.length;
    }
}
