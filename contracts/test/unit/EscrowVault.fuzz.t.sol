// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

/// @notice Fuzzed property tests on top of the fixed-case unit suite — random amounts and
/// addresses on deposit/claim/release/skim, per smartContractPhase.md §3.3.
contract EscrowVaultFuzzTest is Test {
    EscrowVault vault;
    MockAToken token;

    address owner = makeAddr("owner");
    address depositor = makeAddr("depositor");
    address issuer = makeAddr("issuer");

    function setUp() public {
        vault = new EscrowVault(owner);
        token = new MockAToken();

        vm.prank(owner);
        vault.setAuthorizedDepositor(depositor);

        vm.prank(issuer);
        token.approve(address(vault), type(uint256).max);
    }

    function testFuzz_DepositThenClaim_ExactAmount(address beneficiary, uint96 amount) public {
        vm.assume(beneficiary != address(0));
        vm.assume(amount > 0);
        token.mint(issuer, amount);

        vm.prank(depositor);
        vault.deposit(issuer, beneficiary, address(token), amount, 1, bytes4(0), address(0));
        assertEq(vault.ledger(beneficiary, address(token)), amount);

        vm.prank(beneficiary);
        vault.claim(address(token));

        assertEq(vault.ledger(beneficiary, address(token)), 0);
        assertEq(token.balanceOf(beneficiary), amount);
    }

    function testFuzz_MultipleDeposits_SumCorrectly(address beneficiary, uint64 amt1, uint64 amt2, uint64 amt3) public {
        vm.assume(beneficiary != address(0));
        vm.assume(amt1 > 0 && amt2 > 0 && amt3 > 0);
        uint256 total = uint256(amt1) + amt2 + amt3;
        token.mint(issuer, total);

        vm.startPrank(depositor);
        vault.deposit(issuer, beneficiary, address(token), amt1, 1, bytes4(0), address(0));
        vault.deposit(issuer, beneficiary, address(token), amt2, 2, bytes4(0), address(0));
        vault.deposit(issuer, beneficiary, address(token), amt3, 3, bytes4(0), address(0));
        vm.stopPrank();

        assertEq(vault.ledger(beneficiary, address(token)), total);
        assertEq(vault.totalHeld(address(token)), total);
    }

    function testFuzz_Skim_NeverTouchesLedgerBalance(address beneficiary, uint96 depositAmt, uint96 donation) public {
        vm.assume(beneficiary != address(0));
        vm.assume(depositAmt > 0);
        token.mint(issuer, depositAmt);

        vm.prank(depositor);
        vault.deposit(issuer, beneficiary, address(token), depositAmt, 1, bytes4(0), address(0));

        token.mint(address(vault), donation);

        if (donation == 0) {
            vm.prank(owner);
            vm.expectRevert(abi.encodeWithSelector(EscrowVault.NothingToSkim.selector, address(token)));
            vault.skim(address(token));
        } else {
            vm.prank(owner);
            vault.skim(address(token));
            assertEq(token.balanceOf(owner), donation);
        }

        assertEq(vault.ledger(beneficiary, address(token)), depositAmt);
        assertGe(token.balanceOf(address(vault)), vault.totalHeld(address(token)));
    }

    function testFuzz_Deposit_RevertsOnZeroInputs(address beneficiary, address tok, uint256 amount) public {
        // beneficiary == 0 always reverts regardless of amount
        vm.prank(depositor);
        vm.expectRevert(EscrowVault.ZeroBeneficiary.selector);
        vault.deposit(issuer, address(0), tok, amount == 0 ? 1 : amount, 1, bytes4(0), address(0));

        vm.assume(beneficiary != address(0));
        vm.prank(depositor);
        vm.expectRevert(EscrowVault.ZeroAmount.selector);
        vault.deposit(issuer, beneficiary, tok, 0, 1, bytes4(0), address(0));
    }
}
