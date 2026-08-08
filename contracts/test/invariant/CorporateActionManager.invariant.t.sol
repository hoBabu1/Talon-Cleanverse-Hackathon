// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant, Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {MockAToken} from "../mocks/MockAToken.sol";
import {CorporateActionManagerHandler} from "./CorporateActionManagerHandler.sol";

/// @notice I2 from smartContractPhase.md §3.3: per action, paidTotal + escrowedTotal +
/// remainingBudget == totalAmount (conservation). I1/I3/I4 are the vault's, covered in
/// EscrowVault.invariant.t.sol.
contract CorporateActionManagerInvariantTest is StdInvariant, Test {
    EscrowVault vault;
    CorporateActionManager cam;
    MockAToken token;
    CorporateActionManagerHandler handler;

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

        handler = new CorporateActionManagerHandler(cam, token, issuer);
        targetContract(address(handler));
    }

    function invariant_I2_BudgetConservation() public view {
        uint256 n = handler.actionIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 actionId = handler.actionIds(i);
            CorporateActionManager.CorporateAction memory action = cam.getAction(actionId);
            assertEq(action.totalAmount - action.remainingBudget, handler.sumProcessed(actionId));
        }
    }
}
