// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TalonBondFallback — hedge only, NOT deployed unless the real TLNB launch fails
/// @notice A plain, uncompliant ERC-20 standing in for "Talon Bond 2026" (TLNB) if the real
/// A-Token launch (`/atoken/launch`) doesn't reach ISSUED by the hard gate (~Aug 5). TLNB is
/// the ASSET the corporate action is declared against — holders' balances at `recordBlock`
/// define entitlements; it is never itself transferred during a payout (coupons pay in aUSDC),
/// so it does not need Cleanverse compliance semantics to serve that role. If used, this
/// contract's address becomes CorporateActionManager's `asset` parameter, never its `token`.
/// @dev Deliberately minimal: mint-by-owner only, no compliance checks, no pausing. This is a
/// fallback for the DEMO ASSET, not a production instrument — do not extend it.
contract TalonBondFallback is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Talon Bond 2026 (Fallback)", "TLNB") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6; // matches aUSDC — see [P2]/[P3] decimal-consistency notes in smartContractPhase.md
    }
}
