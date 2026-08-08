// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface for a Cleanverse A-Token (an ERC-20 whose transfer()
/// reverts on-chain if either party's A-Pass is not active — confirmed empirically
/// on Monad testnet, see /learning.md entry "does freezing actually block transfers".
/// We deliberately do NOT re-implement compliance checks ourselves: we call transfer()
/// and react to success/revert, so Cleanverse's own contract stays the single source
/// of truth on eligibility.
interface IAToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}
