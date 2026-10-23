// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {AutomaticGroupVault} from "./AutomaticGroupVault.sol";

/// @notice Separate testnet deployment with the fixed server reporter authorized at creation.
contract FastTestnetVault is AutomaticGroupVault {
    uint256 public constant FAST_TESTNET_VERSION=1;
    error FastTestnetOnly();

    constructor(address initialOwner,address token,address bnbFeed,address tokenFeed,uint256 age,address[] memory partners,address operations)
        AutomaticGroupVault(initialOwner,token,bnbFeed,tokenFeed,age,partners,operations) {
        if(block.chainid!=97 || msg.sender!=0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2 || initialOwner!=0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632) revert FastTestnetOnly();
        reporters[0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2]=true;
    }
}
