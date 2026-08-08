// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAToken} from "../../src/interfaces/IAToken.sol";

/// @notice Minimal token whose `transferFrom` always reverts with caller-supplied raw bytes.
/// Used to construct revert shapes that don't arise naturally from MockAToken's normal
/// eligibility logic — e.g. proving CorporateActionManager's `VaultNotEligible` branch is
/// correctly wired even though it is structurally unreachable via the real direct-pay call
/// (the vault is never a party to `transferFrom(issuer, holder, amt)` — see learning.md).
contract StubRevertToken is IAToken {
    bytes public revertData;
    uint256 public mockBalance = type(uint256).max;
    uint256 public mockAllowance = type(uint256).max;

    function setRevertData(bytes calldata data) external {
        revertData = data;
    }

    function allowance(address, address) external view returns (uint256) {
        return mockAllowance;
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("StubRevertToken: transfer not used");
    }

    function transferFrom(address, address, uint256) external view returns (bool) {
        bytes memory data = revertData;
        assembly ("memory-safe") {
            revert(add(data, 0x20), mload(data))
        }
    }

    function balanceOf(address) external view returns (uint256) {
        return mockBalance;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}
