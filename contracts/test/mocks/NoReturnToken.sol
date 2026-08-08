// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The classic "missing return value" ERC-20 shape (USDT-style): `transferFrom`
/// succeeds but returns no data at all, rather than `true`. Used to prove
/// CorporateActionManager's low-level-call handling tolerates this the same way SafeERC20
/// does — a typed `try/catch returns (bool)` would throw an uncatchable ABI-decode error here.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        // deliberately no `return true;` — and no return type at all, matching real USDT.
    }
}
