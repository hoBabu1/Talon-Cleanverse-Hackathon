// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CorporateActionManagerHarness} from "../mocks/CorporateActionManagerHarness.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";

/// @notice Fuzz coverage for CorporateActionManager, per smartContractPhase.md §3.3.
contract CorporateActionManagerFuzzTest is Test {
    CorporateActionManagerHarness harness;

    function setUp() public {
        EscrowVault vault = new EscrowVault(address(this));
        harness = new CorporateActionManagerHarness(address(this), payable(address(vault)));
    }

    // (45) _decodeRevert on malformed revert data — never reverts, safe for any length.
    function testFuzz_DecodeRevert_NeverReverts(bytes memory err) public view {
        (bytes4 sel, address offender) = harness.decodeRevert(err);
        if (err.length < 4) {
            assertEq(sel, bytes4(0));
            assertEq(offender, address(0));
        }
        if (err.length < 36) {
            assertEq(offender, address(0));
        }
    }

    function test_DecodeRevert_EmptyBytes() public view {
        (bytes4 sel, address offender) = harness.decodeRevert("");
        assertEq(sel, bytes4(0));
        assertEq(offender, address(0));
    }

    function test_DecodeRevert_ExactlyFourBytes() public view {
        (bytes4 sel, address offender) = harness.decodeRevert(abi.encodePacked(bytes4(0x322fde89)));
        assertEq(sel, bytes4(0x322fde89));
        assertEq(offender, address(0));
    }

    function test_DecodeRevert_FullAPassNotActiveShape() public {
        address expected = makeAddr("offender");
        bytes memory err = abi.encodeWithSignature("APassNotActive(address)", expected);
        (bytes4 sel, address offender) = harness.decodeRevert(err);
        assertEq(sel, bytes4(0x322fde89));
        assertEq(offender, expected);
    }

    function test_DecodeRevert_GarbageTail_StillSafe() public {
        bytes memory err = abi.encodePacked(bytes4(0x322fde89), makeAddr("x"), uint256(12345), "trailing junk");
        (bytes4 sel,) = harness.decodeRevert(err);
        assertEq(sel, bytes4(0x322fde89)); // decodes fine, extra tail bytes ignored
    }

    // declareAction always reverts on a zero total amount, regardless of other otherwise-valid
    // inputs (allowlisted contract token, past record block, no redirect).
    function testFuzz_Declare_RevertsOnZeroTotal(bytes32 holderSetHash, uint32 totalHolders) public {
        harness.setAllowedToken(address(harness), true); // any contract address will do
        vm.expectRevert(CorporateActionManager.ZeroTotalAmount.selector);
        harness.declareAction(address(harness), address(harness), block.number, 0, holderSetHash, totalHolders, 0);
    }
}
