// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAToken} from "../interfaces/IAToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SpikeVault — Phase 0 custody spike, throwaway contract
/// @notice Answers one empirical question: can a contract we own actually pull and push
/// Cleanverse A-Tokens, and under what conditions (pool registration, freeze state, pause
/// state)? See /smartContractPhase.md §0. This contract is NOT the real EscrowVault and is
/// never deployed alongside it in production — it exists only to generate the raw on-chain
/// results recorded in /learning.md that decide Plan A vs Plan B.
contract SpikeVault is Ownable {
    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Pulls `amt` of `token` from `from` into this contract. Used for spike cases
    /// (d1)/(d2)/(e): does an unregistered (or registered) contract-as-spender work at all.
    function pull(address token, address from, uint256 amt) external onlyOwner returns (bool) {
        return IAToken(token).transferFrom(from, address(this), amt);
    }

    /// @notice Pushes `amt` of `token` from this contract to `to`. Used for spike cases
    /// (b)/(c)/(g): can the vault pay an active holder, does it revert on a frozen one,
    /// what happens while the pool is paused.
    function push(address token, address to, uint256 amt) external onlyOwner returns (bool) {
        return IAToken(token).transfer(to, amt);
    }
}
