// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../../src/EscrowVault.sol";
import {MockAToken} from "../mocks/MockAToken.sol";

/// @notice Handler for EscrowVault's invariant suite (I1, I3, I4 — I2 belongs to CAM, Phase 2).
/// Bounded random sequencing of deposit / claim / release / donate / freeze / unfreeze against
/// a small fixed actor set and a single token, per smartContractPhase.md §3.3. Ghost variables
/// (`sumDeposited`, `sumReleased`) let the invariant test check I3 without re-deriving it from
/// events. Freeze/unfreeze is deliberately in the mix — I1 must hold even when some fraction of
/// calls are failing mid-run compliance checks, not just on the happy path.
contract EscrowVaultHandler is Test {
    EscrowVault public vault;
    MockAToken public token;
    address public issuer;
    address public depositor;
    address public owner;

    address[] public actors;
    uint256 public sumDeposited;
    uint256 public sumReleased;
    uint256 public nextActionId;

    constructor(EscrowVault _vault, MockAToken _token, address _issuer, address _depositor, address _owner) {
        vault = _vault;
        token = _token;
        issuer = _issuer;
        depositor = _depositor;
        owner = _owner;

        for (uint256 i = 0; i < 5; i++) {
            actors.push(address(uint160(uint256(keccak256(abi.encode("actor", i))))));
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 actorSeed, uint256 amountSeed) external {
        address beneficiary = _actor(actorSeed);
        uint256 amount = bound(amountSeed, 1, 1e12);

        token.mint(issuer, amount);
        nextActionId++;

        vm.prank(depositor);
        try vault.deposit(issuer, beneficiary, address(token), amount, nextActionId, bytes4(0), address(0)) {
            sumDeposited += amount;
        } catch {
            // e.g. beneficiary frozen as a recipient shouldn't block deposit (deposit doesn't
            // move tokens TO the beneficiary), but tolerate any revert defensively.
        }
    }

    function claim(uint256 actorSeed) external {
        address beneficiary = _actor(actorSeed);
        uint256 owed = vault.ledger(beneficiary, address(token));
        vm.prank(beneficiary);
        try vault.claim(address(token)) {
            sumReleased += owed;
        } catch {
            // NothingOwed, or beneficiary frozen — expected, not a failure of the invariant.
        }
    }

    function release(uint256 actorSeed) external {
        address beneficiary = _actor(actorSeed);
        uint256 owed = vault.ledger(beneficiary, address(token));
        try vault.release(beneficiary, address(token)) {
            sumReleased += owed;
        } catch {
            // NothingOwed, or beneficiary frozen mid-flight — expected.
        }
    }

    function donate(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1e12);
        token.mint(address(vault), amount);
    }

    function freeze(uint256 actorSeed) external {
        token.setFrozen(_actor(actorSeed), true);
    }

    function unfreeze(uint256 actorSeed) external {
        token.setFrozen(_actor(actorSeed), false);
    }

    function skim() external {
        vm.prank(owner);
        try vault.skim(address(token)) {} catch {}
    }
}
