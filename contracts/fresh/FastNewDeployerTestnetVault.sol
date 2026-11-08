// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {AutomaticGroupVault} from "./AutomaticGroupVault.sol";

/// @notice Separate testnet deployment with the replacement server reporter authorized at creation.
contract FastNewDeployerTestnetVault is AutomaticGroupVault {
    uint256 public constant FAST_TESTNET_VERSION=1;
    error FastTestnetOnly();

    address private constant EXPECTED_OWNER=0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632;
    address private constant EXPECTED_DEPLOYER=0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d;
    address private constant EXPECTED_TOKEN=0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89;
    address private constant EXPECTED_BNB_FEED=0xDA264c16Ec8832748a1A5A31b963deD9E48e337a;
    address private constant EXPECTED_TOKEN_FEED=0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454;
    address private constant EXPECTED_OPERATIONS=0x8c4AC9b009808a0B49Ba77b58e3871e7cDba463c;
    uint256 private constant EXPECTED_ORACLE_AGE=86400;

    constructor(address initialOwner,address token,address bnbFeed,address tokenFeed,uint256 age,address[] memory partners,address operations)
        AutomaticGroupVault(initialOwner,token,bnbFeed,tokenFeed,age,partners,operations) {
        if(block.chainid!=97 || msg.sender!=EXPECTED_DEPLOYER || initialOwner!=EXPECTED_OWNER || token!=EXPECTED_TOKEN ||
            bnbFeed!=EXPECTED_BNB_FEED || tokenFeed!=EXPECTED_TOKEN_FEED || age!=EXPECTED_ORACLE_AGE ||
            operations!=EXPECTED_OPERATIONS || partners.length!=7 ||
            partners[0]!=0xA7705F5c98263Caae042626a5d49528Dd982Af5F ||
            partners[1]!=0x2F980aC9ae92DB23cA2AEAd1CE8188A5764a7Bfa ||
            partners[2]!=0x730C4664C58aE506C05b50e06c1CE73f71D82b87 ||
            partners[3]!=0xa63AD5EEe7907D76B22eb140cC4009fDc3a6c977 ||
            partners[4]!=0xba869ec421be39c5F5410033Cf7Ec203298B151a ||
            partners[5]!=0x4274d411FF49Cfd2FCf1eC97Fb05f51099d5E0A3 ||
            partners[6]!=0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3) revert FastTestnetOnly();
        reporters[EXPECTED_DEPLOYER]=true;
    }
}
