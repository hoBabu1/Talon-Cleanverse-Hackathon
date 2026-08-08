// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CorporateActionManager} from "../../src/CorporateActionManager.sol";

/// @notice Test-only subclass exposing the internal revert-decoder for direct fuzz testing
/// (checklist 45) — the real contract keeps it internal since nothing external needs it.
contract CorporateActionManagerHarness is CorporateActionManager {
    constructor(address initialOwner, address payable escrowAddress)
        CorporateActionManager(initialOwner, escrowAddress)
    {}

    function decodeRevert(bytes memory err) external pure returns (bytes4 sel, address offender) {
        return _decodeRevert(err);
    }
}
