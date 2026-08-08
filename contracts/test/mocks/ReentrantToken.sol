// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAToken} from "../../src/interfaces/IAToken.sol";

/// @notice Test double that attempts a reentrant call into a configured target mid-`transfer`,
/// simulating a malicious/compromised A-Token trying to exploit EscrowVault's external call in
/// `_release` (or `deposit`'s pull-in). The reentrant call is made via low-level `.call` so its
/// success/failure never reverts the outer transfer — the whole point is to prove the *outer*
/// flow still completes correctly while the *reentrant* attempt is independently rejected by
/// EscrowVault's `nonReentrant` guard (or by the ledger already reading zero, whichever fires
/// first). Tests assert on `lastReentrancySucceeded` after the outer call.
contract ReentrantToken is IAToken {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public reentryTarget;
    bytes public reentryCalldata;
    bool public reentryEnabled;
    bool public lastReentrancySucceeded;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setReentry(address target, bytes calldata data, bool enabled) external {
        reentryTarget = target;
        reentryCalldata = data;
        reentryEnabled = enabled;
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
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        if (reentryEnabled) {
            (bool ok,) = reentryTarget.call(reentryCalldata);
            lastReentrancySucceeded = ok;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
