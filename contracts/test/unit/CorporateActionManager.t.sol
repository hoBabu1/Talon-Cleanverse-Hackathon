// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {CorporateActionManager} from "../../src/CorporateActionManager.sol";
import {MockAToken} from "../mocks/MockAToken.sol";
import {StubRevertToken} from "../mocks/StubRevertToken.sol";
import {NoReturnToken} from "../mocks/NoReturnToken.sol";

contract CorporateActionManagerTest is Test {
    EscrowVault vault;
    CorporateActionManager cam;
    MockAToken token;

    address issuer = makeAddr("issuer"); // also owns both vault and CAM in this deployment
    address holder1 = makeAddr("holder1");
    address holder2 = makeAddr("holder2");
    address holder3 = makeAddr("holder3");
    address stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 1_000_000;

    function setUp() public {
        vault = new EscrowVault(issuer);
        cam = new CorporateActionManager(issuer, payable(address(vault)));
        token = new MockAToken();

        vm.startPrank(issuer);
        vault.setAuthorizedDepositor(address(cam));
        cam.setAllowedToken(address(token), true);
        vm.stopPrank();

        token.mint(issuer, 1_000_000_000 * AMOUNT);
        vm.startPrank(issuer);
        token.approve(address(cam), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _declare(uint256 totalAmount, bytes32 holderSetHash, uint32 totalHolders) internal returns (uint256) {
        vm.prank(issuer);
        return
            cam.declareAction(address(token), address(token), block.number, totalAmount, holderSetHash, totalHolders, 0);
    }

    function _single(address h, uint256 amt) internal pure returns (address[] memory hs, uint256[] memory amts) {
        hs = new address[](1);
        hs[0] = h;
        amts = new uint256[](1);
        amts[0] = amt;
    }

    function _chainHash(bytes32 prev, address[] memory hs, uint256[] memory amts) internal pure returns (bytes32) {
        return keccak256(abi.encode(prev, hs, amts));
    }

    /// [P3] `runningHash` no longer starts at a bare `bytes32(0)` — it's seeded with a
    /// provenance binding computed inside `declareAction` itself. Off-chain (and here in
    /// tests), the seed is precomputable because `actionId` is a predictable owner-only serial
    /// (`cam.actionsCount()` before the declare call IS the actionId that call will receive).
    function _predictedSeed(address token_, address asset_, uint256 recordBlock) internal view returns (bytes32) {
        uint256 predictedActionId = cam.actionsCount();
        return keccak256(abi.encode(block.chainid, address(cam), predictedActionId, token_, asset_, recordBlock));
    }

    function _exec(uint256 actionId, address[] memory hs, uint256[] memory amts) internal {
        vm.prank(issuer);
        cam.executePayoutRun(actionId, hs, amts);
    }

    // ---------------------------------------------------------------------
    // (16) declare with unallowlisted token / EOA token / future recordBlock / zero total reverts
    // ---------------------------------------------------------------------
    function test_Declare_RevertsOnUnallowlistedToken() public {
        MockAToken other = new MockAToken();
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.TokenNotAllowed.selector, address(other)));
        cam.declareAction(address(other), address(other), block.number, AMOUNT, bytes32(0), 1, 0);
    }

    function test_Declare_RevertsOnEOAToken() public {
        address eoa = makeAddr("eoaToken");
        vm.prank(issuer);
        cam.setAllowedToken(eoa, true);

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.TokenNotAContract.selector, eoa));
        cam.declareAction(eoa, eoa, block.number, AMOUNT, bytes32(0), 1, 0);
    }

    function test_Declare_RevertsOnFutureRecordBlock() public {
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(CorporateActionManager.FutureRecordBlock.selector, block.number + 1, block.number)
        );
        cam.declareAction(address(token), address(token), block.number + 1, AMOUNT, bytes32(0), 1, 0);
    }

    function test_Declare_RevertsOnZeroTotalAmount() public {
        vm.prank(issuer);
        vm.expectRevert(CorporateActionManager.ZeroTotalAmount.selector);
        cam.declareAction(address(token), address(token), block.number, 0, bytes32(0), 1, 0);
    }

    // (42) declareAction with redirectAfter != 0 reverts RedirectNotSupported
    function test_Declare_RevertsOnRedirectAfter() public {
        vm.prank(issuer);
        vm.expectRevert(CorporateActionManager.RedirectNotSupported.selector);
        cam.declareAction(address(token), address(token), block.number, AMOUNT, bytes32(0), 1, 1);
    }

    // (B1) asset must be a real contract too, independent of the token check
    function test_Declare_RevertsOnEOAAsset() public {
        address eoaAsset = makeAddr("eoaAsset");
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.AssetNotAContract.selector, eoaAsset));
        cam.declareAction(address(token), eoaAsset, block.number, AMOUNT, bytes32(0), 1, 0);
    }

    // (B1) scrip dividend: asset == token is explicitly legitimate, must NOT revert
    function test_Declare_AllowsAssetEqualToToken() public {
        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(token), address(token), block.number, AMOUNT, bytes32(0), 1, 0);
        assertEq(cam.getAction(actionId).asset, address(token));
    }

    // (B2) runningHash is seeded with the provenance binding at declaration, not bytes32(0)
    function test_Declare_SeedsRunningHashWithProvenanceBinding() public {
        address asset = address(new MockAToken()); // asset must be a real contract
        uint256 predictedActionId = cam.actionsCount();

        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(token), asset, block.number, AMOUNT, bytes32(0), 1, 0);
        assertEq(actionId, predictedActionId);

        bytes32 expectedSeed =
            keccak256(abi.encode(block.chainid, address(cam), actionId, address(token), asset, block.number));
        assertEq(cam.getAction(actionId).runningHash, expectedSeed);
        assertNotEq(cam.getAction(actionId).runningHash, bytes32(0));
    }

    // (B3) ActionDeclared previously had ZERO test coverage — no test asserted this event at
    // all. Pins the full payload including [P3]'s new `asset` field.
    function test_Declare_EmitsActionDeclared_FullPayload() public {
        address asset = address(new MockAToken()); // asset must be a real contract
        bytes32 hash = keccak256("some-commitment");

        vm.expectEmit(true, true, true, true, address(cam));
        emit CorporateActionManager.ActionDeclared(0, address(token), asset, block.number, AMOUNT, hash, 3);

        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(token), asset, block.number, AMOUNT, hash, 3, 0);
        assertEq(actionId, 0);

        CorporateActionManager.CorporateAction memory action = cam.getAction(actionId);
        assertEq(action.token, address(token));
        assertEq(action.asset, asset);
        assertEq(action.holderSetHash, hash);
        assertEq(action.totalHolders, 3);
    }

    // ---------------------------------------------------------------------
    // (17) execute by non-owner / on None / on Closed reverts
    // ---------------------------------------------------------------------
    function test_Execute_RevertsForNonOwner() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.prank(stranger);
        vm.expectRevert();
        cam.executePayoutRun(actionId, hs, amts);
    }

    function test_Execute_RevertsOnNoneAction() public {
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CorporateActionManager.InvalidActionStatus.selector, 999, CorporateActionManager.ActionStatus.None
            )
        );
        cam.executePayoutRun(999, hs, amts);
    }

    function test_Execute_RevertsOnClosedAction() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        vm.prank(issuer);
        cam.closeAction(actionId);

        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CorporateActionManager.InvalidActionStatus.selector,
                actionId,
                CorporateActionManager.ActionStatus.Closed
            )
        );
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (18) length mismatch reverts
    function test_Execute_RevertsOnLengthMismatch() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 2);
        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](1);
        amts[0] = AMOUNT;

        vm.prank(issuer);
        vm.expectRevert(CorporateActionManager.LengthMismatch.selector);
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (19) zero amount reverts
    function test_Execute_RevertsOnZeroAmount() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, 0);

        vm.prank(issuer);
        vm.expectRevert(CorporateActionManager.ZeroAmount.selector);
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (20) duplicate in batch reverts
    function test_Execute_RevertsOnDuplicateInBatch() public {
        uint256 actionId = _declare(3 * AMOUNT, bytes32(0), 2);
        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder1;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.DuplicateHolder.selector, actionId, holder1));
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (21) same holder across batches reverts
    function test_Execute_RevertsOnDuplicateAcrossBatches() public {
        uint256 actionId = _declare(3 * AMOUNT, bytes32(0), 2);
        (address[] memory hs1, uint256[] memory amts1) = _single(holder1, AMOUNT);
        _exec(actionId, hs1, amts1);

        (address[] memory hs2, uint256[] memory amts2) = _single(holder1, AMOUNT);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.DuplicateHolder.selector, actionId, holder1));
        cam.executePayoutRun(actionId, hs2, amts2);
    }

    // (22) same holder across different actions OK
    function test_Execute_SameHolderDifferentActionsOK() public {
        uint256 action1 = _declare(AMOUNT, bytes32(0), 1);
        uint256 action2 = _declare(AMOUNT, bytes32(0), 1);

        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        _exec(action1, hs, amts);
        _exec(action2, hs, amts);

        assertEq(uint8(cam.holderStatusOf(action1, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
        assertEq(uint8(cam.holderStatusOf(action2, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
    }

    // (23) all-frozen batch -> all escrowed, sums correct
    function test_Execute_AllFrozenBatch_AllEscrowed() public {
        token.setFrozen(holder1, true);
        token.setFrozen(holder2, true);

        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        _exec(actionId, hs, amts);

        CorporateActionManager.CorporateAction memory a = cam.getAction(actionId);
        assertEq(a.paidCount, 0);
        assertEq(a.escrowedCount, 2);
        assertEq(a.remainingBudget, 0);
        assertEq(vault.ledger(holder1, address(token)), AMOUNT);
        assertEq(vault.ledger(holder2, address(token)), AMOUNT);
    }

    // (24) mixed batch order-independent — same content, different order, across two actions
    function test_Execute_MixedBatch_OrderIndependent() public {
        token.setFrozen(holder2, true); // holder1 pays direct, holder2 escrows

        uint256 actionA = _declare(2 * AMOUNT, bytes32(0), 2);
        address[] memory hsA = new address[](2);
        hsA[0] = holder1;
        hsA[1] = holder2;
        uint256[] memory amtsA = new uint256[](2);
        amtsA[0] = AMOUNT;
        amtsA[1] = AMOUNT;
        _exec(actionA, hsA, amtsA);

        uint256 actionB = _declare(2 * AMOUNT, bytes32(0), 2);
        address[] memory hsB = new address[](2);
        hsB[0] = holder2;
        hsB[1] = holder1;
        uint256[] memory amtsB = new uint256[](2);
        amtsB[0] = AMOUNT;
        amtsB[1] = AMOUNT;
        _exec(actionB, hsB, amtsB);

        CorporateActionManager.CorporateAction memory a = cam.getAction(actionA);
        CorporateActionManager.CorporateAction memory b = cam.getAction(actionB);
        assertEq(a.paidCount, b.paidCount);
        assertEq(a.escrowedCount, b.escrowedCount);
        assertEq(a.remainingBudget, b.remainingBudget);
    }

    // (25) batch exceeding remainingBudget reverts; two actions can't share one budget
    function test_Execute_RevertsWhenBatchExceedsBudget() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT + 1);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(CorporateActionManager.BudgetExceeded.selector, actionId, AMOUNT + 1, AMOUNT)
        );
        cam.executePayoutRun(actionId, hs, amts);
    }

    function test_Execute_TwoActionsDontShareBudget() public {
        uint256 actionA = _declare(AMOUNT, bytes32(0), 1);
        uint256 actionB = _declare(AMOUNT, bytes32(0), 1);

        (address[] memory hsA, uint256[] memory amtsA) = _single(holder1, AMOUNT);
        _exec(actionA, hsA, amtsA); // drains actionA's budget fully

        (address[] memory hsB, uint256[] memory amtsB) = _single(holder2, AMOUNT); // actionB's own, untouched
        _exec(actionB, hsB, amtsB); // succeeds independently

        assertEq(cam.getAction(actionA).remainingBudget, 0);
        assertEq(cam.getAction(actionB).remainingBudget, 0);
    }

    // ---------------------------------------------------------------------
    // (26)/(27), and [P2] additions 51-54: the issuer-side preflight (ruled on after Phase 2
    // review — an allowance/balance shortfall is an issuer-side setup failure, must revert the
    // whole batch, never get smeared across holders as escrow entries).
    // ---------------------------------------------------------------------

    // (51) insufficient issuer balance -> batch reverts IssuerInsufficientBalance, zero holders
    // marked, zero escrow rows.
    function test_Execute_Preflight_InsufficientBalance_Reverts() public {
        MockAToken poor = new MockAToken();
        vm.prank(issuer);
        cam.setAllowedToken(address(poor), true);
        poor.mint(issuer, AMOUNT - 1); // one short
        vm.startPrank(issuer);
        poor.approve(address(cam), type(uint256).max);
        poor.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(poor), address(poor), block.number, AMOUNT, bytes32(0), 1, 0);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CorporateActionManager.IssuerInsufficientBalance.selector, issuer, AMOUNT, AMOUNT - 1
            )
        );
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(vault.ledger(holder1, address(poor)), 0);
    }

    // (52) insufficient CAM (direct-pay) allowance -> batch reverts IssuerAllowanceTooLowForManager
    // — eligible holders are NEVER escrowed for an issuer's setup error (this is the behavior
    // change from the original design: previously this got silently, gracefully escrowed).
    function test_Execute_Preflight_InsufficientManagerAllowance_Reverts() public {
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        vm.prank(issuer);
        token.approve(address(cam), AMOUNT); // only enough for ONE holder, batchTotal wants 2

        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CorporateActionManager.IssuerAllowanceTooLowForManager.selector, issuer, 2 * AMOUNT, AMOUNT
            )
        );
        cam.executePayoutRun(actionId, hs, amts);

        // Neither holder touched — not even escrowed. This is the point of the ruling.
        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(vault.ledger(holder1, address(token)), 0);

        vm.prank(issuer);
        token.approve(address(cam), type(uint256).max);
        _exec(actionId, hs, amts); // (27) replay after fix succeeds, no double pay
        assertEq(token.balanceOf(holder1), AMOUNT);
        assertEq(token.balanceOf(holder2), AMOUNT);
    }

    // (53) insufficient vault (escrow-leg) allowance -> batch reverts IssuerAllowanceTooLowForVault
    function test_Execute_Preflight_InsufficientVaultAllowance_Reverts() public {
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        vm.prank(issuer);
        token.approve(address(vault), AMOUNT); // only enough for ONE holder's escrow

        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CorporateActionManager.IssuerAllowanceTooLowForVault.selector, issuer, 2 * AMOUNT, AMOUNT
            )
        );
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(vault.ledger(holder1, address(token)), 0);

        vm.prank(issuer);
        token.approve(address(vault), type(uint256).max);
        _exec(actionId, hs, amts); // replay after fix succeeds, no double credit
        assertEq(token.balanceOf(holder1), AMOUNT);
        assertEq(token.balanceOf(holder2), AMOUNT);
    }

    // (54) all three preflights pass, then a mid-loop failure still behaves per the offender
    // taxonomy — the preflight is a PRECONDITION, not a substitute for per-holder logic.
    function test_Execute_Preflight_PassesThenMidLoopFailure_StillTaxonomy() public {
        token.setFrozen(holder2, true); // genuinely ineligible, unrelated to the preflight
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2); // full allowances from setUp

        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        _exec(actionId, hs, amts); // preflight passes; doesn't revert

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.Escrowed));
        assertEq(vault.ledger(holder2, address(token)), AMOUNT);
    }

    // (28) escrow leg reverts (paused/deregistered) -> whole batch reverts, no Paid survives
    function test_Execute_EscrowLegReverts_WholeBatchReverts_NoPaidSurvives() public {
        token.setFrozen(holder2, true); // forces holder2 into the escrow leg
        vm.prank(issuer);
        vault.setAuthorizedDepositor(address(0xdead)); // vault now rejects CAM's deposit calls

        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        address[] memory hs = new address[](2);
        hs[0] = holder1; // would have paid directly
        hs[1] = holder2; // triggers escrow leg, which now reverts
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        vm.prank(issuer);
        vm.expectRevert(); // EscrowVault.NotAuthorizedDepositor
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(token.balanceOf(holder1), 0);
    }

    // (29) holder frozen between batch 1 and 2 -> escrowed correctly (drift during execution)
    function test_Execute_HolderFrozenBetweenBatches() public {
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        (address[] memory hs1, uint256[] memory amts1) = _single(holder1, AMOUNT);
        _exec(actionId, hs1, amts1);
        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));

        token.setFrozen(holder2, true); // drift happens here, between batches
        (address[] memory hs2, uint256[] memory amts2) = _single(holder2, AMOUNT);
        _exec(actionId, hs2, amts2);

        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.Escrowed));
        assertEq(vault.ledger(holder2, address(token)), AMOUNT);
    }

    // (30) escrowed holder unfrozen -> claim succeeds -> CAM status remains Escrowed (documented)
    function test_ClaimAfterEscrow_CAMStatusStaysEscrowed() public {
        token.setFrozen(holder1, true);
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        _exec(actionId, hs, amts);

        token.setFrozen(holder1, false);
        vm.prank(holder1);
        vault.claim(address(token));

        assertEq(token.balanceOf(holder1), AMOUNT);
        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Escrowed));
    }

    // (31) closeAction then late batch reverts; unspent correct
    function test_Close_ThenLateBatchReverts_UnspentCorrect() public {
        // totalHolders=2 (not 1) so closing after only 1 holder is a PARTIAL close — full
        // coverage would additionally require the chained hash to match, which isn't this
        // test's concern.
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        _exec(actionId, hs, amts);

        vm.prank(issuer);
        cam.closeAction(actionId);
        assertEq(cam.getAction(actionId).remainingBudget, AMOUNT); // unspent

        (address[] memory hs2, uint256[] memory amts2) = _single(holder2, AMOUNT);
        vm.prank(issuer);
        vm.expectRevert();
        cam.executePayoutRun(actionId, hs2, amts2);
    }

    // (32) close from Declared = cancel: terminal, late batch reverts, coverageComplete=false
    function test_Close_FromDeclared_IsCancel() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);

        vm.expectEmit(true, false, false, true, address(cam));
        emit CorporateActionManager.ActionClosed(actionId, 0, 0, AMOUNT, false);
        vm.prank(issuer);
        cam.closeAction(actionId);

        assertEq(uint8(cam.getAction(actionId).status), uint8(CorporateActionManager.ActionStatus.Closed));

        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CorporateActionManager.InvalidActionStatus.selector,
                actionId,
                CorporateActionManager.ActionStatus.Closed
            )
        );
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (33) token-paused mock: batch reverts; unpause -> replay succeeds
    function test_Execute_TokenPaused_BatchReverts_UnpauseReplaySucceeds() public {
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        token.setPaused(true);

        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        vm.prank(issuer);
        vm.expectRevert();
        cam.executePayoutRun(actionId, hs, amts);

        token.setPaused(false);
        _exec(actionId, hs, amts);
        assertEq(token.balanceOf(holder1), AMOUNT);
    }

    // ---------------------------------------------------------------------
    // [RT2] additions 37-42
    // ---------------------------------------------------------------------

    // (37) batch not matching chained commitment -> full-coverage close reverts
    function test_Close_RevertsOnHashMismatch_WrongBatchContent() public {
        // Commitment computed for a DIFFERENT batch than what actually gets executed.
        (address[] memory committedHs, uint256[] memory committedAmts) = _single(holder1, AMOUNT);
        bytes32 committedHash = _chainHash(bytes32(0), committedHs, committedAmts);

        uint256 actionId = _declare(2 * AMOUNT, committedHash, 1);

        (address[] memory actualHs, uint256[] memory actualAmts) = _single(holder2, AMOUNT); // wrong holder
        _exec(actionId, actualHs, actualAmts);

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.CoverageHashMismatch.selector, actionId));
        cam.closeAction(actionId);
    }

    // (38) batch that reverts for an unrelated reason leaves commitment untouched; in-order
    // execution afterward still verifies at close.
    function test_Close_RevertedAttempt_DoesNotCorruptCommitment() public {
        bytes32 seed = _predictedSeed(address(token), address(token), block.number);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        bytes32 committedHash = _chainHash(seed, hs, amts);
        uint256 actionId = _declare(AMOUNT, committedHash, 1);

        // A wrong/over-budget attempt reverts atomically — nextIndex/runningHash untouched.
        (address[] memory badHs, uint256[] memory badAmts) = _single(holder1, AMOUNT + 1);
        vm.prank(issuer);
        vm.expectRevert();
        cam.executePayoutRun(actionId, badHs, badAmts);

        assertEq(cam.getAction(actionId).nextIndex, 0);
        assertEq(cam.getAction(actionId).runningHash, seed); // still the seed, not touched by the revert

        // Correct batch now executes and closes cleanly.
        _exec(actionId, hs, amts);
        vm.prank(issuer);
        cam.closeAction(actionId);
        assertTrue(true); // did not revert => coverage verified
    }

    // (39) close from Declared then executePayoutRun reverts — covered by test_Close_FromDeclared_IsCancel above.

    // (40) partial-coverage close emits coverageComplete=false with correct counts
    function test_Close_PartialCoverage_EmitsFalseWithCorrectCounts() public {
        uint256 actionId = _declare(3 * AMOUNT, bytes32(0), 3);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        _exec(actionId, hs, amts); // only 1 of 3 holders processed

        vm.expectEmit(true, false, false, true, address(cam));
        emit CorporateActionManager.ActionClosed(actionId, 1, 0, 2 * AMOUNT, false);
        vm.prank(issuer);
        cam.closeAction(actionId);
    }

    // (41)/(46) [P0] issuer frozen mid-run -> batch reverts atomically IssuerNotEligible, zero
    // holders marked, replay after unfreeze succeeds.
    function test_Execute_IssuerFrozenMidRun_RevertsIssuerNotEligible() public {
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        token.setSenderFrozen(issuer, true);

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.IssuerNotEligible.selector, issuer));
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(cam.getAction(actionId).remainingBudget, 2 * AMOUNT);

        token.setSenderFrozen(issuer, false);
        _exec(actionId, hs, amts);
        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.Paid));
    }

    // (48) APassNotActive(holder) -> escrow row carries offender == holder
    function test_Execute_ComplianceEscrow_OffenderIsHolder() public {
        token.setFrozen(holder1, true);
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.expectEmit(true, true, false, true, address(vault));
        emit EscrowVault.Deposited(holder1, address(token), AMOUNT, actionId, cam.REASON_FROZEN(), holder1);
        _exec(actionId, hs, amts);
    }

    // [P4] APassExpired(holder) -> escrow row carries REASON_EXPIRED (NOT REASON_FROZEN) with
    // offender == holder. Caught live during Phase 4: a holder's real-expiry test A-Pass had
    // genuinely lapsed, producing a different selector than freezing does.
    function test_Execute_ExpiredHolder_EscrowedWithCorrectReason() public {
        token.setExpired(holder1, true);
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.expectEmit(true, true, false, true, address(vault));
        emit EscrowVault.Deposited(holder1, address(token), AMOUNT, actionId, cam.REASON_EXPIRED(), holder1);
        _exec(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Escrowed));
    }

    // [P4] issuer's A-Pass EXPIRES (not frozen) mid-run -> must revert IssuerNotEligible, same
    // as the frozen case — the offender check has to cover both selectors, or an expired issuer
    // gets misrouted through UNKNOWN_REVERT and smears every holder in the batch.
    function test_Execute_ExpiredIssuer_RevertsIssuerNotEligible() public {
        uint256 actionId = _declare(2 * AMOUNT, bytes32(0), 2);
        address[] memory hs = new address[](2);
        hs[0] = holder1;
        hs[1] = holder2;
        uint256[] memory amts = new uint256[](2);
        amts[0] = AMOUNT;
        amts[1] = AMOUNT;

        token.setSenderExpired(issuer, true);

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.IssuerNotEligible.selector, issuer));
        cam.executePayoutRun(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.None));
        assertEq(cam.getAction(actionId).remainingBudget, 2 * AMOUNT);

        token.setSenderExpired(issuer, false);
        _exec(actionId, hs, amts);
        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
        assertEq(uint8(cam.holderStatusOf(actionId, holder2)), uint8(CorporateActionManager.HolderStatus.Paid));
    }

    // [P4] VaultNotEligible must also fire for an expired vault, not just a frozen one — same
    // synthetic-token proof pattern as the frozen VaultNotEligible test above, since this
    // branch is structurally unreachable via the real direct-pay call either way.
    function test_Execute_ExpiredVault_RevertsVaultNotEligible_ButSynthetic() public {
        StubRevertToken stub = new StubRevertToken();
        vm.prank(issuer);
        cam.setAllowedToken(address(stub), true);
        stub.setRevertData(abi.encodeWithSelector(CorporateActionManager.APassExpired.selector, address(vault)));

        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(stub), address(stub), block.number, AMOUNT, bytes32(0), 1, 0);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.VaultNotEligible.selector, address(vault)));
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (47) VaultNotEligible: the branch is implemented and correctly wired, but — as documented
    // in learning.md's Phase 2 entry — structurally UNREACHABLE via the real direct-pay call,
    // because the vault is never a party to `transferFrom(issuer, holder, amt)`. This test
    // proves the branch itself is correct using a synthetic token that can produce that revert
    // shape; it does NOT claim this is reachable with the real Cleanverse A-Token.
    function test_Execute_VaultNotEligible_BranchIsCorrect_ButSynthetic() public {
        StubRevertToken stub = new StubRevertToken();
        vm.prank(issuer);
        cam.setAllowedToken(address(stub), true);
        stub.setRevertData(abi.encodeWithSelector(CorporateActionManager.APassNotActive.selector, address(vault)));

        vm.prank(issuer);
        uint256 actionId = cam.declareAction(address(stub), address(stub), block.number, AMOUNT, bytes32(0), 1, 0);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.VaultNotEligible.selector, address(vault)));
        cam.executePayoutRun(actionId, hs, amts);
    }

    // A token that returns `false` (no revert at all) on transferFrom must escrow the holder
    // with REASON_RETURNED_FALSE, not silently mark them Paid.
    function test_Execute_TransferFromReturnsFalse_Escrows() public {
        // Only the direct-pay leg (issuer -> holder1) returns false; the escrow leg's own
        // pull (issuer -> vault) must stay unaffected so the graceful-escrow path is what
        // actually gets exercised here, not an unrelated SafeERC20 revert on the escrow leg.
        token.setReturnsFalseFor(holder1, true);
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.expectEmit(true, true, false, true, address(cam));
        emit CorporateActionManager.HolderEscrowed(actionId, holder1, AMOUNT, cam.REASON_RETURNED_FALSE(), "");
        _exec(actionId, hs, amts);

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Escrowed));
        assertEq(vault.ledger(holder1, address(token)), AMOUNT);
    }

    // [Review-1] A token that succeeds but returns no data at all (the classic USDT-style
    // "missing return value" shape) must be tolerated exactly like SafeERC20 tolerates it —
    // NOT via a typed try/catch, which cannot catch an ABI-decode failure and would revert
    // the whole batch uncatchably. Proves the low-level-call fix actually works.
    function test_Execute_NoReturnValueToken_TreatedAsSuccess() public {
        NoReturnToken noReturn = new NoReturnToken();
        noReturn.mint(issuer, AMOUNT);
        vm.prank(issuer);
        noReturn.approve(address(cam), type(uint256).max);
        vm.prank(issuer);
        noReturn.approve(address(vault), type(uint256).max); // preflight checks both allowances
        vm.prank(issuer);
        cam.setAllowedToken(address(noReturn), true);

        vm.prank(issuer);
        uint256 actionId =
            cam.declareAction(address(noReturn), address(noReturn), block.number, AMOUNT, bytes32(0), 1, 0);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);
        _exec(actionId, hs, amts); // must NOT revert

        assertEq(uint8(cam.holderStatusOf(actionId, holder1)), uint8(CorporateActionManager.HolderStatus.Paid));
        assertEq(noReturn.balanceOf(holder1), AMOUNT);
    }

    // (38) two batches submitted in an order that doesn't match the off-chain-committed
    // sequence: each executes fine on its own, but the resulting runningHash is chained in the
    // WRONG order, so full-coverage close is permanently impossible for this action (no
    // recovery path — the commitment is order-sensitive by design, §2.1).
    function test_Close_RevertsOnHashMismatch_BatchesOutOfCommittedOrder() public {
        bytes32 seed = _predictedSeed(address(token), address(token), block.number);
        (address[] memory hs1, uint256[] memory amts1) = _single(holder1, AMOUNT);
        (address[] memory hs2, uint256[] memory amts2) = _single(holder2, AMOUNT);
        // Off-chain commitment assumes holder1's batch executes BEFORE holder2's.
        bytes32 afterFirst = _chainHash(seed, hs1, amts1);
        bytes32 committedHash = _chainHash(afterFirst, hs2, amts2);

        uint256 actionId = _declare(2 * AMOUNT, committedHash, 2);

        // Executed in the WRONG (swapped) order instead.
        _exec(actionId, hs2, amts2);
        _exec(actionId, hs1, amts1);

        assertEq(cam.getAction(actionId).nextIndex, 2); // full coverage by count...
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CorporateActionManager.CoverageHashMismatch.selector, actionId));
        cam.closeAction(actionId); // ...but the chained hash doesn't match, so close still reverts.
    }

    // The REAL way a vault's-own-A-Pass-lapsed problem manifests: the escrow leg's raw
    // SafeERC20 revert propagates undecoded (no IssuerNotEligible/VaultNotEligible framing),
    // since `_escrow` is deliberately not wrapped in its own try/catch (§2.4). Batch still
    // reverts atomically, which is the safety property that matters — but the diagnostic
    // naming the plan's prose promises for this exact scenario does not actually fire here.
    // Flagged for the hostile review pass.
    function test_Execute_VaultFrozenAsRecipient_RealPath_RevertsUndiagnosed() public {
        token.setFrozen(holder1, true); // forces the escrow leg
        token.setFrozen(address(vault), true); // vault can't RECEIVE either
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.prank(issuer);
        vm.expectRevert(); // raw revert from the escrow leg's safeTransferFrom, not VaultNotEligible
        cam.executePayoutRun(actionId, hs, amts);
    }

    // (56) [P2] pins OZ v5's bubbling behaviour: the escrow leg's raw revert must carry
    // APassNotActive(vault) INTACT to transaction level (SafeERC20._callOptionalReturn does
    // returndatacopy+revert, not a generic "call failed" swallow) — this is exactly what lets
    // the frontend decode it and render the off-chain diagnostic the [P2] ruling relies on. If
    // this test ever fails, the off-chain-diagnosis answer for VaultNotEligible breaks too.
    function test_EscrowLeg_VaultFrozen_RevertBubblesIntact() public {
        token.setFrozen(holder1, true);
        token.setFrozen(address(vault), true);
        uint256 actionId = _declare(AMOUNT, bytes32(0), 1);
        (address[] memory hs, uint256[] memory amts) = _single(holder1, AMOUNT);

        vm.prank(issuer);
        (bool success, bytes memory returnData) =
            address(cam).call(abi.encodeCall(CorporateActionManager.executePayoutRun, (actionId, hs, amts)));
        assertFalse(success);

        // SafeERC20's own revert wraps the underlying reason, but the ORIGINAL
        // APassNotActive(address) selector + the vault's address must still be present
        // somewhere in the bubbled revert data, verbatim.
        bytes memory expectedInner = abi.encodeWithSelector(MockAToken.APassNotActive.selector, address(vault));
        assertTrue(_containsBytes(returnData, expectedInner), "APassNotActive(vault) not found intact in revert data");
    }

    function _containsBytes(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || haystack.length < needle.length) return false;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool matchFound = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    matchFound = false;
                    break;
                }
            }
            if (matchFound) return true;
        }
        return false;
    }
}
