// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Cumulative USD business-volume metrics, not cash or guaranteed income.
abstract contract ThreeLinePlan {
    error NetworkInvalid(); error NetworkInsufficient(); error NetworkPreparationRequired(); error NetworkStageChanged();
    uint256 public constant ACTIVE_DIRECT_USD = 100 ether;
    uint256 public constant NETWORK_BATCH_LIMIT = 64;
    uint256 public constant NETWORK_PLAN_VERSION = 2;
    mapping(address => uint256) public qualifiedDirects;
    mapping(address => mapping(address => uint256)) public branchVolumeUsd;
    mapping(address => address[]) private networkBranches;
    struct VolumeJob { address child; address ancestor; uint256 usd; }
    VolumeJob[] public volumeJobs;
    struct RewardGroup { address[] branches; uint256[] consumedUsd; uint8 stage; uint256 preparedUsd; uint256 cursor; }
    mapping(address => RewardGroup[]) private rewardGroups;
    mapping(address => mapping(uint256 => mapping(uint8 => mapping(uint256 => uint256)))) private reservedUsd;
    mapping(address => mapping(address => bool)) public groupedBranch;
    event NetworkVolumeQueued(uint256 indexed job,address indexed source,uint256 usd);
    event NetworkVolumeProgress(uint256 indexed job,address nextAncestor);
    event RewardGroupCreated(address indexed user,uint256 indexed group,address[] branches);
    event RewardBranchesAdded(address indexed user,uint256 indexed group,address[] branches);
    event NetworkRewardPrepared(address indexed user,uint256 indexed group,uint8 stage,uint256 preparedUsd,uint256 cursor);
    event NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd);
    function _networkParent(address who) internal view virtual returns(address);
    function _capitalChanged(address who,uint256 beforeUsd,uint256 afterUsd) internal {
        address parent=_networkParent(who); if(parent==address(0)) return;
        if(beforeUsd<ACTIVE_DIRECT_USD && afterUsd>=ACTIVE_DIRECT_USD) qualifiedDirects[parent]++;
        if(beforeUsd>=ACTIVE_DIRECT_USD && afterUsd<ACTIVE_DIRECT_USD) qualifiedDirects[parent]--;
    }
    function volumeJobCount() external view returns(uint256) { return volumeJobs.length; }
    function _addNetworkVolume(address who,uint256 usd) internal {
        if(usd==0) return;
        address parent=_networkParent(who); if(parent==address(0)) return;
        uint256 job=volumeJobs.length; volumeJobs.push(VolumeJob(who,parent,usd));
        emit NetworkVolumeQueued(job,who,usd); _processVolume(job,8);
    }
    /// @notice Anyone may finish deep ancestry propagation; cursors prevent replay. No external calls.
    function processNetworkVolume(uint256 job,uint256 steps) external {
        if(job>=volumeJobs.length || steps==0 || steps>64) revert NetworkInvalid();
        _processVolume(job,steps);
    }
    function _processVolume(uint256 job,uint256 steps) private {
        VolumeJob storage v=volumeJobs[job];
        for(uint256 i;i<steps && v.ancestor!=address(0);i++) {
            address parent=v.ancestor; address child=v.child;
            if(branchVolumeUsd[parent][child]==0) networkBranches[parent].push(child);
            branchVolumeUsd[parent][child]+=v.usd;
            v.child=parent; v.ancestor=_networkParent(parent);
        }
        emit NetworkVolumeProgress(job,v.ancestor);
    }
    /// @notice A ceiling per independent branch, never a required three-way split.
    function branchCapBps(uint256 targetUsd) public pure returns(uint16) {
        return targetUsd<=10000 ether ? 6000 : targetUsd<=100000 ether ? 4500 : 3500;
    }
    function networkBranchCount(address who) external view returns(uint256) { return networkBranches[who].length; }
    function networkBranch(address who,uint256 index) external view returns(address) { return networkBranches[who][index]; }
    /// @notice Paginated capped historical volume. Sum pages, clipping the final total at the target.
    function rankVolumePage(address who,uint256 targetUsd,uint256 start,uint256 limit) external view returns(uint256 eligibleUsd,uint256 next) {
        if(targetUsd==0 || limit==0 || limit>NETWORK_BATCH_LIMIT || start>networkBranches[who].length) revert NetworkInvalid();
        uint256 end=start+Math.min(limit,networkBranches[who].length-start);
        uint256 cap=Math.mulDiv(targetUsd,branchCapBps(targetUsd),10000);
        for(next=start;next<end;next++) eligibleUsd+=Math.min(Math.min(branchVolumeUsd[who][networkBranches[who][next]],cap),targetUsd-eligibleUsd);
    }
    function rankQualified(address who,uint256 directs,uint256 total) public view returns(bool) {
        if(total==0 || qualifiedDirects[who]<directs) return false;
        uint256 cap=Math.mulDiv(total,branchCapBps(total),10000); uint256 eligible;
        address[] storage branches=networkBranches[who];
        for(uint256 i;i<branches.length;i++) {
            eligible+=Math.min(Math.min(branchVolumeUsd[who][branches[i]],cap),total-eligible);
            if(eligible==total) return true;
        }
        return false;
    }
    /// @notice Disjoint groups accept any total number of branches in batches of up to 64.
    function createRewardGroup(address[] calldata branches) external {
        uint256 index=rewardGroups[msg.sender].length;
        rewardGroups[msg.sender].push();
        _appendBranches(msg.sender,index,branches);
        emit RewardGroupCreated(msg.sender,index,branches);
    }
    function addRewardBranches(uint256 group,address[] calldata branches) external {
        if(group>=rewardGroups[msg.sender].length || rewardGroups[msg.sender][group].stage>=14) revert NetworkInvalid();
        _appendBranches(msg.sender,group,branches);
        emit RewardBranchesAdded(msg.sender,group,branches);
    }
    function _appendBranches(address who,uint256 group,address[] calldata branches) private {
        if(branches.length==0 || branches.length>NETWORK_BATCH_LIMIT) revert NetworkInvalid();
        RewardGroup storage g=rewardGroups[who][group];
        for(uint256 i;i<branches.length;i++) {
            address b=branches[i];
            if(b==address(0)||_networkParent(b)!=who||groupedBranch[who][b]) revert NetworkInvalid();
            groupedBranch[who][b]=true;
            g.branches.push(b); g.consumedUsd.push(0);
        }
    }
    function rewardGroupCount(address who) external view returns(uint256) { return rewardGroups[who].length; }
    function rewardGroup(address who,uint256 group) external view returns(RewardGroup memory) { return rewardGroups[who][group]; }
    function rewardProgress(address who,uint256 group) external view returns(uint8 stage,uint256 preparedUsd,uint256 cursor,uint256 branches) {
        RewardGroup storage g=rewardGroups[who][group]; return(g.stage,g.preparedUsd,g.cursor,g.branches.length);
    }
    /// @dev Bind a reviewed transaction to one stage even if another transaction confirms first.
    function _checkRewardStage(address who,uint256 group,uint8 expectedStage) internal view {
        if(group>=rewardGroups[who].length) revert NetworkInvalid();
        if(rewardGroups[who][group].stage!=expectedStage) revert NetworkStageChanged();
    }
    function rewardBranch(address who,uint256 group,uint256 index) external view returns(address branch,uint256 consumedUsd,uint256 reservedForStageUsd) {
        RewardGroup storage g=rewardGroups[who][group];return(g.branches[index],g.consumedUsd[index],reservedUsd[who][group][g.stage][index]);
    }
    function rewardStage(uint256 stage) public pure returns(uint256 volumeUsd,uint256 rewardUsd) {
        uint256[14] memory volumes=[uint256(500),1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];
        if(stage>=14) revert NetworkInvalid();
        volumeUsd=volumes[stage]*1 ether;
        rewardUsd=volumeUsd*(stage<5?7:stage<8?6:stage<11?5:3)/100;
    }
    /// @notice consume includes already reserved volume for the current stage. Large groups can use the paginated getters.
    function rewardPreview(address who,uint256 group) public view returns(bool eligible,uint256 volumeUsd,uint256 rewardUsd,uint256[] memory consume) {
        RewardGroup storage g=rewardGroups[who][group];
        consume=new uint256[](g.branches.length);
        if(g.stage>=14) return(false,0,0,consume);
        (volumeUsd,rewardUsd)=rewardStage(g.stage);
        uint256 cap=Math.mulDiv(volumeUsd,branchCapBps(volumeUsd),10000); uint256 remaining=volumeUsd-g.preparedUsd;
        for(uint256 i;i<g.branches.length;i++) consume[i]=reservedUsd[who][group][g.stage][i];
        for(uint256 j;j<g.branches.length && remaining>0;j++) {
            uint256 i=(g.cursor+j)%g.branches.length;
            uint256 take=Math.min(Math.min(branchVolumeUsd[who][g.branches[i]]-g.consumedUsd[i],cap-consume[i]),remaining);
            consume[i]+=take; remaining-=take;
        }
        eligible=remaining==0;
    }
    /// @dev Reserves volume exclusively for this group's current stage. It remains claimable after funding/oracle failures.
    function _prepareReward(address who,uint256 group,uint256 steps) internal {
        if(group>=rewardGroups[who].length || steps==0 || steps>NETWORK_BATCH_LIMIT) revert NetworkInvalid();
        RewardGroup storage g=rewardGroups[who][group]; if(g.stage>=14) revert NetworkInsufficient();
        (uint256 target,)=rewardStage(g.stage); uint256 cap=Math.mulDiv(target,branchCapBps(target),10000);
        uint256 count=Math.min(steps,g.branches.length);
        for(uint256 j;j<count && g.preparedUsd<target;j++) {
            uint256 i=g.cursor; uint256 already=reservedUsd[who][group][g.stage][i];
            uint256 take=Math.min(Math.min(branchVolumeUsd[who][g.branches[i]]-g.consumedUsd[i],cap-already),target-g.preparedUsd);
            if(take>0) { g.consumedUsd[i]+=take; reservedUsd[who][group][g.stage][i]=already+take; g.preparedUsd+=take; }
            g.cursor=(i+1)%g.branches.length;
        }
        emit NetworkRewardPrepared(who,group,g.stage,g.preparedUsd,g.cursor);
    }
    function _consumeReward(address who,uint256 group) internal returns(uint256 rewardUsd) {
        _prepareReward(who,group,NETWORK_BATCH_LIMIT);
        RewardGroup storage g=rewardGroups[who][group];
        (uint256 volume,uint256 reward)=rewardStage(g.stage);
        if(g.preparedUsd!=volume) {
            if(g.branches.length>NETWORK_BATCH_LIMIT) revert NetworkPreparationRequired();
            revert NetworkInsufficient();
        }
        emit NetworkRewardEarned(who,group,g.stage,volume,reward); g.stage++; g.preparedUsd=0; g.cursor=0;
        return reward;
    }
}
