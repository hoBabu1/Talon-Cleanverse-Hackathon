// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant, Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {MockAToken} from "../mocks/MockAToken.sol";
import {CombinedHandler} from "./CombinedHandler.sol";

/// @notice Phase 3 pre-deploy gate (smartContractPhase.md §3.3): I1-I4 held simultaneously
/// under full random cross-contract sequencing — donations and mid-run freezes included —
/// exercising the REAL CAM -> vault wiring, not either contract in isolation. Phase 4 does not
/// start until this suite is green.
contract CombinedInvariantTest is StdInvariant, Test {
    EscrowVault vault;
    CorporateActionManager cam;
    MockAToken token;
    CombinedHandler handler;

    address issuer = makeAddr("issuer");

    function setUp() public {
        vault = new EscrowVault(issuer);
        cam = new CorporateActionManager(issuer, payable(address(vault)));
        token = new MockAToken();

        vm.startPrank(issuer);
        vault.setAuthorizedDepositor(address(cam));
        cam.setAllowedToken(address(token), true);
        token.approve(address(cam), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        handler = new CombinedHandler(vault, cam, token, issuer);
        targetContract(address(handler));
    }

    /// I1: Σ ledger <= balanceOf(vault) — must hold even with CAM-driven escrow, direct
    /// claims/releases, donations, and skims all interleaved.
    function invariant_I1_LedgerNeverExceedsBalance() public view {
        assertLe(vault.totalHeld(address(token)), token.balanceOf(address(vault)));
    }

    /// I2: per action, totalAmount - remainingBudget == amounts actually processed.
    function invariant_I2_BudgetConservation() public view {
        uint256 n = handler.actionIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 actionId = handler.actionIds(i);
            CorporateActionManager.CorporateAction memory action = cam.getAction(actionId);
            assertEq(action.totalAmount - action.remainingBudget, handler.sumProcessed(actionId));
        }
    }

    /// I3: vault totalHeld == Σ Deposited - Σ Released, ghost-tracked across every REAL
    /// CAM-driven escrow leg and every claim/release, not a synthetic direct-deposit path.
    function invariant_I3_TotalHeldMatchesGhostAccounting() public view {
        assertEq(vault.totalHeld(address(token)), handler.sumDeposited() - handler.sumReleased());
    }

    /// I4: the vault's real balance never drops below what's ledger-backed, even after skims.
    function invariant_I4_SkimNeverTouchesLedgerBackedFunds() public view {
        assertGe(token.balanceOf(address(vault)), vault.totalHeld(address(token)));
    }
}
