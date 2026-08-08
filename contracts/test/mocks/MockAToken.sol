// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAToken} from "../../src/interfaces/IAToken.sol";

/// @notice Test double for a Cleanverse A-Token. Reproduces the exact on-chain behaviors
/// proven empirically during the Phase 0 spike (see /learning.md), with per-address toggles
/// so tests can arrange any combination the spike observed:
///   - `APassNotActive(address offender)` (selector 0x322fde89) on a frozen recipient, and
///     optionally on a frozen sender too (`senderChecked`), matching the spike's finding that
///     the sender side IS checked (test f, k).
///   - a distinct "pool rule" failure selector, separate from compliance (spike test h intent
///     — the module itself was unusable on Monad, but the taxonomy still must not conflate
///     "ineligible" with "some other on-chain restriction").
///   - a token-level pause that reverts everything, unrelated to any individual party.
///   - a returns-false mode (no revert, `transfer`/`transferFrom` just report failure) to test
///     SafeERC20's protection against silently-broken tokens.
contract MockAToken is IAToken {
    string public constant name = "Mock A-Token";
    string public constant symbol = "mA";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    mapping(address => bool) public frozen; // frozen as RECIPIENT always; as SENDER too if senderChecked
    mapping(address => bool) public senderFrozen; // frozen as SENDER only, regardless of senderChecked
    mapping(address => bool) public expired; // [P4] expired as RECIPIENT always; as SENDER too if senderChecked
    mapping(address => bool) public senderExpired; // [P4] expired as SENDER only — the expired-issuer scenario
    mapping(address => bool) public poolRuleFail;
    mapping(address => bool) public returnsFalseFor; // returns false only when `to` is this address
    bool public senderChecked;
    bool public returnsFalse; // returns false for EVERY transfer, regardless of recipient
    bool public paused;

    error APassNotActive(address offender);
    error APassExpired(address offender); // [P4] distinct selector from APassNotActive — see /learning.md
    error PoolRuleFailed(address offender);
    error TokenPaused();

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFrozen(address addr, bool value) external {
        frozen[addr] = value;
    }

    function setSenderFrozen(address addr, bool value) external {
        senderFrozen[addr] = value;
    }

    function setExpired(address addr, bool value) external {
        expired[addr] = value;
    }

    function setSenderExpired(address addr, bool value) external {
        senderExpired[addr] = value;
    }

    function setSenderChecked(bool value) external {
        senderChecked = value;
    }

    function setPoolRuleFail(address addr, bool value) external {
        poolRuleFail[addr] = value;
    }

    function setReturnsFalse(bool value) external {
        returnsFalse = value;
    }

    function setReturnsFalseFor(address to, bool value) external {
        returnsFalseFor[to] = value;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount; // underflow reverts on insufficient allowance
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        if (paused) revert TokenPaused();
        if (poolRuleFail[to] || (senderChecked && poolRuleFail[from])) {
            revert PoolRuleFailed(poolRuleFail[to] ? to : from);
        }
        if (frozen[to]) revert APassNotActive(to);
        if (senderFrozen[from] || (senderChecked && frozen[from])) revert APassNotActive(from);
        if (expired[to]) revert APassExpired(to);
        if (senderExpired[from] || (senderChecked && expired[from])) revert APassExpired(from);
        if (returnsFalse || returnsFalseFor[to]) return false;

        balanceOf[from] -= amount; // underflow reverts on insufficient balance
        balanceOf[to] += amount;
        return true;
    }
}
