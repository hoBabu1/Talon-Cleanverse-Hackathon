// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant, Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {MockAToken} from "../mocks/MockAToken.sol";
import {EscrowVaultHandler} from "./EscrowVaultHandler.sol";

/// @notice I1, I3, I4 from smartContractPhase.md §3.3. I2 (corporate-action budget
/// conservation) belongs to CorporateActionManager and lands in Phase 2/3.
contract EscrowVaultInvariantTest is StdInvariant, Test {
    EscrowVault vault;
    MockAToken token;
    EscrowVaultHandler handler;

    address owner = makeAddr("owner");
    address issuer = makeAddr("issuer");
    address depositor = makeAddr("depositor");

    function setUp() public {
        vault = new EscrowVault(owner);
        token = new MockAToken();

        vm.prank(owner);
        vault.setAuthorizedDepositor(depositor);

        vm.prank(issuer);
        token.approve(address(vault), type(uint256).max);

        handler = new EscrowVaultHandler(vault, token, issuer, depositor, owner);

        targetContract(address(handler));
    }

    /// I1: per token, ledger sum <= balanceOf(vault). Donations (via handler.donate) must never
    /// be able to falsify this — only widen the gap that `skim` can recover.
    function invariant_I1_LedgerNeverExceedsBalance() public view {
        assertLe(vault.totalHeld(address(token)), token.balanceOf(address(vault)));
    }

    /// I3: totalHeld == sum(Deposited amounts) - sum(Released amounts), tracked via the
    /// handler's ghost variables against every successful call it made.
    function invariant_I3_TotalHeldMatchesGhostAccounting() public view {
        assertEq(vault.totalHeld(address(token)), handler.sumDeposited() - handler.sumReleased());
    }

    /// I4: skim can never pull the vault's real balance below totalHeld (i.e. below what's
    /// ledger-backed) — checked implicitly by I1 holding after every handler call including
    /// `skim`, since skim's own transfer amount is exactly `balanceOf - totalHeld`.
    function invariant_I4_SkimNeverTouchesLedgerBackedFunds() public view {
        assertGe(token.balanceOf(address(vault)), vault.totalHeld(address(token)));
    }
}
