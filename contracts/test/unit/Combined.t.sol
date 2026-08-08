// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

/// @notice Phase 3 "Combined system" UNIT coverage (smartContractPhase.md §3 table): scripted,
/// deterministic cross-contract flows — escrow leg, claim after escrow — including the
/// full-coverage chained-hash close end-to-end through the REAL wiring. The randomized
/// invariant handler (`CombinedHandler`) cannot reliably reach full-coverage close (it can't
/// know its own future random picks at declare time to pre-commit a matching hash), so that
/// specific scenario is deliberately covered here instead, scripted rather than fuzzed.
contract CombinedTest is Test {
    EscrowVault vault;
    CorporateActionManager cam;
    MockAToken token;

    address issuer = makeAddr("issuer");
    address holder1 = makeAddr("holder1");
    address holder2 = makeAddr("holder2");

    uint256 constant AMOUNT = 1_000_000;

    function setUp() public {
        vault = new EscrowVault(issuer);
        cam = new CorporateActionManager(issuer, payable(address(vault)));
        token = new MockAToken();

        vm.startPrank(issuer);
        vault.setAuthorizedDepositor(address(cam));
        cam.setAllowedToken(address(token), true);
        vm.stopPrank();

        token.mint(issuer, 1_000_000 * AMOUNT);
        vm.startPrank(issuer);
        token.approve(address(cam), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    /// [P3] `runningHash` is seeded with a provenance binding, not a bare `bytes32(0)` — see
    /// CorporateActionManager.declareAction. `actionId` is precomputable off-chain (and here)
    /// via `actionsCount()` before the declare call, since it's a predictable owner-only serial.
    function _predictedSeed(address token_, address asset_, uint256 recordBlock) internal view returns (bytes32) {
        uint256 predictedActionId = cam.actionsCount();
        return keccak256(abi.encode(block.chainid, address(cam), predictedActionId, token_, asset_, recordBlock));
    }

    /// Single-holder end-to-end: escrowed via the real CAM->vault wiring, closed with full
    /// coverage (chained hash matches — proves the commitment mechanism works through the real
    /// contracts, not just CAM in isolation as Phase 2's own tests already covered), then
    /// unfrozen and claimed directly from the vault, bypassing CAM entirely for the claim leg.
    function test_CrossContract_EscrowThenClaimAfterUnfreeze_FullCoverageClose() public {
        token.setFrozen(holder1, true);

        address[] memory hs = new address[](1);
        hs[0] = holder1;
        uint256[] memory amts = new uint256[](1);
        amts[0] = AMOUNT;
        bytes32 seed = _predictedSeed(address(token), address(token), block.number);
        bytes32 committedHash = keccak256(abi.encode(seed, hs, amts));

        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(token), address(token), block.number, AMOUNT, committedHash, 1, 0);

        vm.prank(issuer);
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Escrowed));
        assertEq(vault.ledger(holder1, address(token)), AMOUNT);

        // Full-coverage close: nextIndex == totalHolders AND the chained hash matches.
        vm.prank(issuer);
        cam.closeAction(actionId);
        assertEq(uint8(cam.getAction(actionId).status), uint8(CorporateActionManager.ActionStatus.Closed));

        // Drift recovery: holder becomes eligible again, claims DIRECTLY from the vault — CAM
        // is never involved in this leg at all.
        token.setFrozen(holder1, false);
        vm.prank(holder1);
        vault.claim(address(token));

        assertEq(token.balanceOf(holder1), AMOUNT);
        assertEq(vault.ledger(holder1, address(token)), 0);
        // CAM's record stays Escrowed forever — execution-time fact, documented deliberate (§2.5).
        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Escrowed));
    }

    /// Two holders, mixed outcome (one paid direct, one escrowed), single batch, full-coverage
    /// close — proves the chained-hash commitment tolerates a mixed-outcome batch correctly
    /// (the hash only commits to WHO/HOW MUCH was submitted, not the pay-vs-escrow outcome).
    function test_CrossContract_MixedBatch_FullCoverageClose() public {
        token.setFrozen(holder2, true);

        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;
        bytes32 seed = _predictedSeed(address(token), address(token), block.number);
        bytes32 committedHash = keccak256(abi.encode(seed, hs, amts));

        vm.prank(issuer);
        uint256 actionId =
            cam.declareAction(address(token), address(token), block.number, 2 * AMOUNT, committedHash, 2, 0);

        vm.prank(issuer);
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.Escrowed));

        vm.prank(issuer);
        cam.closeAction(actionId);

        CorporateActionManager.CorporateAction memory action = cam.getAction(actionId);
        assertEq(uint8(action.status), uint8(CorporateActionManager.ActionStatus.Closed));
        assertEq(action.paidCount, 1);
        assertEq(action.escrowedCount, 1);
        assertEq(action.remainingBudget, 0);
    }

    /// Multi-batch cross-contract flow: two batches for the same action, chained hash carried
    /// forward correctly across batches, full coverage only after BOTH land.
    function test_CrossContract_MultiBatch_ChainedAcrossCalls() public {
        token.setFrozen(holder2, true);

        address[] memory hs1 = new address[](1);
        hs1[0] = holder1;
        uint256[] memory amts1 = new uint256[](1);
        amts1[0] = AMOUNT;
        bytes32 seed = _predictedSeed(address(token), address(token), block.number);
        bytes32 afterBatch1 = keccak256(abi.encode(seed, hs1, amts1));

        address[] memory hs2 = new address[](1);
        hs2[0] = holder2;
        uint256[] memory amts2 = new uint256[](1);
        amts2[0] = AMOUNT;
        bytes32 committedHash = keccak256(abi.encode(afterBatch1, hs2, amts2));

        vm.prank(issuer);
        uint256 actionId =
            cam.declareAction(address(token), address(token), block.number, 2 * AMOUNT, committedHash, 2, 0);

        vm.prank(issuer);
        cam.executePayoutRun(actionId, hs1, amts1);
        assertEq(cam.getAction(actionId).nextIndex, 1);

        // Closing now (partial coverage) must NOT check the hash at all — only full coverage does.
        // Skip closing here to keep the flow going toward full coverage instead.

        vm.prank(issuer);
        cam.executePayoutRun(actionId, hs2, amts2);
        assertEq(cam.getAction(actionId).nextIndex, 2);

        vm.prank(issuer);
        cam.closeAction(actionId); // full coverage, chained hash matches across both batches
        assertEq(uint8(cam.getAction(actionId).status), uint8(CorporateActionManager.ActionStatus.Closed));
        assertEq(vault.ledger(holder2, address(token)), AMOUNT);
    }
}
