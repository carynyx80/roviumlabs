// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title RoviumAgentToken
 * @notice Fixed-supply ERC-20 associated with a RoviumPad research agent.
 *
 * Design (intentionally minimal):
 *  - The entire supply is minted once, to the creator, in the constructor.
 *  - No owner, no admin, no mint, no burn-from, no pause, no fees, no blacklist,
 *    no upgradeability. After deployment nobody — including RoviumPad — can change it.
 *  - `agentId` and `metadataURI` are immutable references used by RoviumPad to verify
 *    which agent the token belongs to. They grant no rights.
 *
 * DISCLOSURE: This token does not represent ownership of any real-world asset, any
 * investment or profit right, or any claim on revenue of the agent or of RoviumPad.
 *
 * Security: built on OpenZeppelin Contracts v5 ERC20 (audited). This wrapper has not been
 * independently audited; obtain a professional audit before any mainnet deployment.
 */
contract RoviumAgentToken is ERC20 {
    /// @notice RoviumPad agent identifier this token is associated with.
    string public agentId;
    /// @notice Off-chain metadata (agent profile URL).
    string public metadataURI;
    /// @notice Address that received the full supply at deployment.
    address public immutable creator;
    /// @notice Identifies the RoviumPad token standard version.
    string public constant ROVIUM_TOKEN_VERSION = "1";

    error InvalidSupply();
    error InvalidCreator();
    error InvalidAgentId();

    event AgentTokenDeployed(address indexed creator, string agentId, uint256 totalSupply, string metadataURI);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupplyWholeTokens,
        address creator_,
        string memory agentId_,
        string memory metadataURI_
    ) ERC20(name_, symbol_) {
        if (totalSupplyWholeTokens == 0 || totalSupplyWholeTokens > 1e15) revert InvalidSupply();
        if (creator_ == address(0)) revert InvalidCreator();
        if (bytes(agentId_).length == 0 || bytes(agentId_).length > 64) revert InvalidAgentId();
        creator = creator_;
        agentId = agentId_;
        metadataURI = metadataURI_;
        uint256 supply = totalSupplyWholeTokens * 10 ** decimals();
        _mint(creator_, supply);
        emit AgentTokenDeployed(creator_, agentId_, supply, metadataURI_);
    }
}
