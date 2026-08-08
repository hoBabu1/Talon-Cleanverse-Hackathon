// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {MockAToken} from "../mocks/MockAToken.sol";
import {ReentrantToken} from "../mocks/ReentrantToken.sol";

contract EscrowVaultTest is Test {
    EscrowVault vault;
    MockAToken token;
    MockAToken token2;

    address owner = makeAddr("owner");
    address depositor = makeAddr("depositor"); // stands in for the CAM
    address issuer = makeAddr("issuer");
    address beneficiary = makeAddr("beneficiary");
    address stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 1_000_000; // 1.0 aUSDC at 6 decimals

    function setUp() public {
        vault = new EscrowVault(owner);
        token = new MockAToken();
        token2 = new MockAToken();

        vm.prank(owner);
        vault.setAuthorizedDepositor(depositor);

        token.mint(issuer, 100 * AMOUNT);
        vm.prank(issuer);
        token.approve(address(vault), type(uint256).max);
        token2.mint(issuer, 100 * AMOUNT);
        vm.prank(issuer);
        token2.approve(address(vault), type(uint256).max);
    }

    function _deposit(address ben, address tok, uint256 amt, uint256 actionId) internal {
        vm.prank(depositor);
        vault.deposit(issuer, ben, tok, amt, actionId, bytes4(0), address(0));
    }

    // (1) deposit from non-authorized caller reverts
    function test_Deposit_RevertsForUnauthorizedCaller() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotAuthorizedDepositor.selector, stranger));
        vault.deposit(issuer, beneficiary, address(token), AMOUNT, 1, bytes4(0), address(0));
    }

    // (2) deposit zero-beneficiary / zero-amount reverts
    function test_Deposit_RevertsOnZeroBeneficiary() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowVault.ZeroBeneficiary.selector);
        vault.deposit(issuer, address(0), address(token), AMOUNT, 1, bytes4(0), address(0));
    }

    function test_Deposit_RevertsOnZeroAmount() public {
        vm.prank(depositor);
        vm.expectRevert(EscrowVault.ZeroAmount.selector);
        vault.deposit(issuer, beneficiary, address(token), 0, 1, bytes4(0), address(0));
    }

    // (3) deposit where transferFrom returns false -> no ledger credit
    function test_Deposit_ReturnsFalseToken_NoCredit() public {
        token.setReturnsFalse(true);
        vm.prank(depositor);
        vm.expectRevert();
        vault.deposit(issuer, beneficiary, address(token), AMOUNT, 1, bytes4(0), address(0));
        assertEq(vault.ledger(beneficiary, address(token)), 0);
    }

    // (4) two deposits same beneficiary different actions sum; one claim drains both
    function test_Deposit_SumsAcrossActions_OneClaimDrainsBoth() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        _deposit(beneficiary, address(token), 2 * AMOUNT, 2);
        assertEq(vault.ledger(beneficiary, address(token)), 3 * AMOUNT);

        vm.prank(beneficiary);
        vault.claim(address(token));
        assertEq(vault.ledger(beneficiary, address(token)), 0);
        assertEq(token.balanceOf(beneficiary), 3 * AMOUNT);
    }

    // [Review-1] Deposited event carries the exact reasonSelector/offender passed in — the
    // [P0-2] flagship field the plan calls out as strictly better than originally planned.
    function test_Deposit_EmitsOffenderAndReasonSelector() public {
        bytes4 reason = bytes4(keccak256("APassNotActive(address)"));
        address offender = makeAddr("frozenHolder");

        vm.expectEmit(true, true, true, true, address(vault));
        emit EscrowVault.Deposited(beneficiary, address(token), AMOUNT, 7, reason, offender);

        vm.prank(depositor);
        vault.deposit(issuer, beneficiary, address(token), AMOUNT, 7, reason, offender);
    }

    // (5) same beneficiary two tokens = independent ledgers
    function test_Deposit_IndependentLedgersPerToken() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        _deposit(beneficiary, address(token2), 2 * AMOUNT, 1);
        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
        assertEq(vault.ledger(beneficiary, address(token2)), 2 * AMOUNT);
    }

    // (6) claim with owed=0 reverts NothingOwed
    function test_Claim_RevertsWhenNothingOwed() public {
        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NothingOwed.selector, beneficiary, address(token)));
        vault.claim(address(token));
    }

    // (7) claim while frozen -> whole tx reverts, ledger intact
    function test_Claim_RevertsWhileFrozen_LedgerIntact() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        token.setFrozen(beneficiary, true);

        vm.prank(beneficiary);
        vm.expectRevert();
        vault.claim(address(token));

        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
        assertEq(vault.totalHeld(address(token)), AMOUNT);
    }

    // (8) third-party release pays beneficiary, never caller
    function test_Release_PaysBeneficiary_NotCaller() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);

        vm.prank(stranger);
        vault.release(beneficiary, address(token));

        assertEq(token.balanceOf(beneficiary), AMOUNT);
        assertEq(token.balanceOf(stranger), 0);
    }

    // (9) release for beneficiary refrozen between off-chain check and tx inclusion -> revert, ledger intact
    function test_EligibilityDrift_MidFlight() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        // Simulates: off-chain preflight said "eligible", but by the time the tx lands, frozen again.
        token.setFrozen(beneficiary, true);

        vm.expectRevert();
        vault.release(beneficiary, address(token));

        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
    }

    // (10) reentrant claim during transfer sees 0 and reverts
    function test_ReentrantClaim_SeesZero_Reverts() public {
        ReentrantToken rToken = new ReentrantToken();
        rToken.mint(issuer, 100 * AMOUNT);
        vm.prank(issuer);
        rToken.approve(address(vault), type(uint256).max);

        vm.prank(depositor);
        vault.deposit(issuer, beneficiary, address(rToken), AMOUNT, 1, bytes4(0), address(0));

        rToken.setReentry(address(vault), abi.encodeCall(EscrowVault.claim, (address(rToken))), true);

        vm.prank(beneficiary);
        vault.claim(address(rToken));

        assertFalse(rToken.lastReentrancySucceeded());
        assertEq(rToken.balanceOf(beneficiary), AMOUNT);
    }

    // (11) reentrant deposit during claim blocked (by the shared nonReentrant guard, not just the caller check)
    function test_ReentrantDeposit_BlockedByGuard() public {
        ReentrantToken rToken = new ReentrantToken();
        rToken.mint(issuer, 100 * AMOUNT);
        vm.prank(issuer);
        rToken.approve(address(vault), type(uint256).max);

        // Deposit normally first (authorized depositor = `depositor`).
        vm.prank(depositor);
        vault.deposit(issuer, beneficiary, address(rToken), AMOUNT, 1, bytes4(0), address(0));

        // Now make the TOKEN itself the authorized depositor, isolating the guard: the only
        // thing that can stop its reentrant deposit call is nonReentrant, not caller-auth.
        vm.prank(owner);
        vault.setAuthorizedDepositor(address(rToken));

        bytes memory reentryCall = abi.encodeCall(
            EscrowVault.deposit, (issuer, beneficiary, address(rToken), AMOUNT, 2, bytes4(0), address(0))
        );
        rToken.setReentry(address(vault), reentryCall, true);

        vm.prank(beneficiary);
        vault.claim(address(rToken));

        assertFalse(rToken.lastReentrancySucceeded());
        // Only the original deposit's amount was ever credited/paid — the reentrant one never landed.
        assertEq(rToken.balanceOf(beneficiary), AMOUNT);
    }

    // (12) donation -> I1 holds, skim recovers exact surplus
    function test_Skim_RecoversExactDonationSurplus() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);

        uint256 donation = 500_000;
        token.mint(address(vault), donation); // unsolicited donation, bypasses deposit()

        assertLe(vault.totalHeld(address(token)), token.balanceOf(address(vault)));

        vm.prank(owner);
        vault.skim(address(token));

        assertEq(token.balanceOf(owner), donation);
        assertEq(token.balanceOf(address(vault)), vault.totalHeld(address(token)));
        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT); // untouched
    }

    function test_Skim_RevertsWhenNothingToSkim() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NothingToSkim.selector, address(token)));
        vault.skim(address(token));
    }

    function test_Skim_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.skim(address(token));
    }

    // (13) enumeration add/no-dup/remove/re-add-after-removal lifecycle
    function test_Enumeration_Lifecycle() public {
        assertEq(vault.beneficiaryCount(address(token)), 0);

        _deposit(beneficiary, address(token), AMOUNT, 1);
        assertEq(vault.beneficiaryCount(address(token)), 1);

        _deposit(beneficiary, address(token), AMOUNT, 2); // second deposit, same beneficiary: no dup
        assertEq(vault.beneficiaryCount(address(token)), 1);

        vm.prank(beneficiary);
        vault.claim(address(token)); // full claim removes them
        assertEq(vault.beneficiaryCount(address(token)), 0);

        _deposit(beneficiary, address(token), AMOUNT, 3); // re-added after removal
        assertEq(vault.beneficiaryCount(address(token)), 1);
        assertEq(vault.beneficiariesOf(address(token))[0], beneficiary);
    }

    // (14) claim with unknown token reverts
    function test_Claim_UnknownToken_Reverts() public {
        address randomToken = makeAddr("randomToken");
        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NothingOwed.selector, beneficiary, randomToken));
        vault.claim(randomToken);
    }

    // (15) returns-false token on claim -> safeTransfer reverts, ledger intact
    function test_Claim_ReturnsFalseToken_LedgerIntact() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        token.setReturnsFalse(true);

        vm.prank(beneficiary);
        vm.expectRevert();
        vault.claim(address(token));

        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
        assertEq(vault.totalHeld(address(token)), AMOUNT);
    }

    // (49)/(50) [P0] the vault's own A-Pass lapsing (sender-side) breaks release/claim, not the
    // beneficiary's fault — attribution must point at the vault, and the mock's dedicated
    // setSenderFrozen toggle is what exercises this (independent of setFrozen/senderChecked).
    function test_Release_RevertsWhenVaultItselfFrozenAsSender() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        token.setSenderFrozen(address(vault), true);

        vm.expectRevert(abi.encodeWithSelector(MockAToken.APassNotActive.selector, address(vault)));
        vault.release(beneficiary, address(token));

        // Ledger intact — this must never look like the beneficiary's problem.
        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
    }

    function test_Claim_RevertsWhenVaultItselfFrozenAsSender() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        token.setSenderFrozen(address(vault), true);

        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(MockAToken.APassNotActive.selector, address(vault)));
        vault.claim(address(token));

        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
    }

    // (36) deposit pulls from `from` param, not msg.sender — CAM (authorized depositor) with
    // zero balance and zero allowance still triggers a successful escrow.
    function test_Deposit_PullsFromParam_NotMsgSender() public {
        assertEq(token.balanceOf(depositor), 0);
        assertEq(token.allowance(depositor, address(vault)), 0);

        _deposit(beneficiary, address(token), AMOUNT, 1);

        assertEq(vault.ledger(beneficiary, address(token)), AMOUNT);
        assertEq(token.balanceOf(depositor), 0); // depositor never touched
    }

    // (43) depositor rotation: old CAM's deposit reverts, new CAM's succeeds, ledger untouched
    function test_DepositorRotation() public {
        _deposit(beneficiary, address(token), AMOUNT, 1);
        uint256 afterFirst = vault.ledger(beneficiary, address(token));

        address newDepositor = makeAddr("newDepositor");
        vm.prank(owner);
        vault.setAuthorizedDepositor(newDepositor);

        vm.prank(depositor); // old CAM
        vm.expectRevert(abi.encodeWithSelector(EscrowVault.NotAuthorizedDepositor.selector, depositor));
        vault.deposit(issuer, beneficiary, address(token), AMOUNT, 2, bytes4(0), address(0));
        assertEq(vault.ledger(beneficiary, address(token)), afterFirst); // untouched by the failed attempt

        vm.prank(newDepositor);
        vault.deposit(issuer, beneficiary, address(token), AMOUNT, 3, bytes4(0), address(0));
        assertEq(vault.ledger(beneficiary, address(token)), afterFirst + AMOUNT);
    }

    // (44) paginated beneficiariesOf: bounds, empty ranges, start+count past end
    function test_PaginatedBeneficiaries_Bounds() public {
        address b1 = makeAddr("b1");
        address b2 = makeAddr("b2");
        address b3 = makeAddr("b3");
        _deposit(b1, address(token), AMOUNT, 1);
        _deposit(b2, address(token), AMOUNT, 2);
        _deposit(b3, address(token), AMOUNT, 3);

        address[] memory page1 = vault.beneficiariesOf(address(token), 0, 2);
        assertEq(page1.length, 2);

        address[] memory page2 = vault.beneficiariesOf(address(token), 2, 2); // clamped: only 1 left
        assertEq(page2.length, 1);

        address[] memory empty1 = vault.beneficiariesOf(address(token), 3, 1); // start == len
        assertEq(empty1.length, 0);

        address[] memory empty2 = vault.beneficiariesOf(address(token), 5, 5); // start past len
        assertEq(empty2.length, 0);

        address[] memory zeroCount = vault.beneficiariesOf(address(token), 0, 0); // count == 0
        assertEq(zeroCount.length, 0);
    }
}
