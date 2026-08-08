// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {CorporateActionManager} from "../src/CorporateActionManager.sol";

/// @notice Phase 4 deploy script (smartContractPhase.md). Deploys EscrowVault + CAM, wires
/// `authorizedDepositor`, and allowlists aUSDC — the primary coupon currency. Does NOT
/// allowlist TLNB (never a payment token — it's the demo asset) or TLNC (not ISSUED yet).
/// @dev Custody does not require Validator pool registration ([P0-1], spike-proven) — the
/// vault's own A-Pass is generated separately by `scripts/generate-vault-apass.mjs`, since
/// that's a Cleanverse API call, unreachable from forge.
contract Deploy is Script {
    address constant AUSDC = 0xaC0893567D43C3E7e6e35a72803df05416C1f20D;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        EscrowVault vault = new EscrowVault(deployer);
        CorporateActionManager cam = new CorporateActionManager(deployer, payable(address(vault)));
        vault.setAuthorizedDepositor(address(cam));
        cam.setAllowedToken(AUSDC, true);

        vm.stopBroadcast();

        console2.log("Deployer:", deployer);
        console2.log("EscrowVault:", address(vault));
        console2.log("CorporateActionManager:", address(cam));
        console2.log("aUSDC allowlisted:", AUSDC);
    }
}
