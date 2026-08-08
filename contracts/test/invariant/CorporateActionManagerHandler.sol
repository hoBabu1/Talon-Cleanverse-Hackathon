// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

/// @notice Handler for I2: per action, paidTotal + escrowedTotal + remainingBudget ==
/// totalAmount. Random sequencing of declare / executeBatch / close / freeze / unfreeze
/// against a small fixed holder set (smartContractPhase.md §3.3).
contract CorporateActionManagerHandler is Test {
    CorporateActionManager public cam;
    MockAToken public token;
    address public issuer;

    uint256[] public actionIds;
    address[] public holders;
    /// @dev Ghost sum of amounts successfully processed (paid or escrowed) per action — the
    /// struct itself only stores holder counts, not amount totals, so I2 needs this to verify
    /// `totalAmount - remainingBudget` actually matches what was really submitted and accepted.
    mapping(uint256 actionId => uint256) public sumProcessed;

    constructor(CorporateActionManager _cam, MockAToken _token, address _issuer) {
        cam = _cam;
        token = _token;
        issuer = _issuer;

        for (uint256 i = 0; i < 5; i++) {
            holders.push(address(uint160(uint256(keccak256(abi.encode("camActor", i))))));
        }
    }

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

        address holder = holders[holderSeed % holders.length];
        if (cam.holderStatusOf(actionId, holder) != CorporateActionManager.HolderStatus.None) return;

        uint256 amt = bound(amountSeed, 1, action.remainingBudget);
        token.mint(issuer, amt);

        address[] memory hs = new address[](1);
        hs[0] = holder;
        uint256[] memory amts = new uint256[](1);
        amts[0] = amt;

        vm.prank(issuer);
        try cam.executePayoutRun(actionId, hs, amts) {
            sumProcessed[actionId] += amt;
        } catch {}
    }

    function close(uint256 actionSeed) external {
        if (actionIds.length == 0) return;
        uint256 actionId = actionIds[actionSeed % actionIds.length];
        vm.prank(issuer);
        try cam.closeAction(actionId) {} catch {}
    }

    function freeze(uint256 holderSeed) external {
        token.setFrozen(holders[holderSeed % holders.length], true);
    }

    function unfreeze(uint256 holderSeed) external {
        token.setFrozen(holders[holderSeed % holders.length], false);
    }

    function actionIdsLength() external view returns (uint256) {
        return actionIds.length;
    }
}
