// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeferredRewardsVault} from "./DeferredRewardsVault.sol";

/// @notice Fresh accounts with every new independent branch assigned to the first reward group.
contract AutomaticGroupVault is DeferredRewardsVault {
    uint256 public constant AUTO_REWARD_GROUP_VERSION=1;
    event RewardBranchAutoAssigned(address indexed user,address indexed branch);

    constructor(address owner,address token,address bnbFeed,address tokenFeed,uint256 age,address[] memory partners,address operations)
        DeferredRewardsVault(owner,token,bnbFeed,tokenFeed,age,partners,operations) {}

    function _onNetworkBranch(address who,address branch) internal override {
        if(rewardGroups[who].length==0)rewardGroups[who].push();
        groupedBranch[who][branch]=true;
        RewardGroup storage group=rewardGroups[who][0];
        group.branches.push(branch);group.consumedUsd.push(0);
        emit RewardBranchAutoAssigned(who,branch);
    }

    /// @notice Group membership follows recorded branch volume without a separate wallet action.
    function createRewardGroup(address[] calldata) external pure override {revert NetworkInvalid();}
    function addRewardBranches(uint256,address[] calldata) external pure override {revert NetworkInvalid();}
}
