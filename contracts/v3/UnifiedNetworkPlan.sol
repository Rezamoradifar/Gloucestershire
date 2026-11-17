// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {V3NetworkPlan} from "./V3NetworkPlan.sol";

interface IUnifiedNetworkVault {
    function referrerOf(address who) external view returns(address);
}

/// @notice Testnet network-plan component for the experimental unified vault.
/// @dev Users call inherited group/volume methods on this component. The parent
/// alone may report capital and create volume or consume reward stages.
contract UnifiedNetworkPlan is V3NetworkPlan {
    address public immutable vault;
    mapping(address => mapping(uint8 => uint256)) public qualifiedVolume;
    error UnauthorizedVault();

    modifier onlyVault() {if(msg.sender!=vault)revert UnauthorizedVault();_;}
    constructor(address vault_){
        if(block.chainid!=97||vault_==address(0))revert NetworkInvalid();
        vault=vault_;
    }
    function _networkParent(address who) internal view override returns(address){
        return IUnifiedNetworkVault(vault).referrerOf(who);
    }
    function _onBranchVolume(address who,uint256 beforeVolume,uint256 afterVolume) internal override {
        uint256[5] memory targets=[uint256(2_500 ether),10_000 ether,50_000 ether,250_000 ether,1_000_000 ether];
        for(uint8 tier=0;tier<5;tier++){
            uint256 cap=Math.mulDiv(targets[tier],branchCapBps(targets[tier]),10_000);
            qualifiedVolume[who][tier]+=Math.min(afterVolume,cap)-Math.min(beforeVolume,cap);
        }
    }
    function capitalChanged(address who,uint256 beforeUsd,uint256 afterUsd) external onlyVault {
        _capitalChanged(who,beforeUsd,afterUsd);
    }
    function addVolume(address who,uint256 usd) external onlyVault {_addNetworkVolume(who,usd);}
    function prepareFor(address who,uint256 group,uint8 expectedStage,uint256 steps) external onlyVault {
        _checkRewardStage(who,group,expectedStage);
        _prepareReward(who,group,steps);
    }
    function consumeFor(address who,uint256 group,uint8 expectedStage,uint8 count) external onlyVault returns(uint256 total){
        if(count==0||uint256(expectedStage)+count>14)revert NetworkInvalid();
        _checkRewardStage(who,group,expectedStage);
        for(uint256 i=0;i<count;i++)total+=_consumeReward(who,group);
    }
}
