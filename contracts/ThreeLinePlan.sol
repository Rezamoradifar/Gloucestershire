// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Cumulative USD business-volume metrics, not cash or guaranteed income.
abstract contract ThreeLinePlan {
    error NetworkInvalid(); error NetworkInsufficient();
    uint256 public constant ACTIVE_DIRECT_USD = 100 ether;
    mapping(address => uint256) public qualifiedDirects;
    mapping(address => mapping(address => uint256)) public branchVolumeUsd;
    mapping(address => address[3]) public largestBranches;
    struct VolumeJob { address child; address ancestor; uint256 usd; }
    VolumeJob[] public volumeJobs;
    struct RewardGroup { address[3] branches; uint256[3] consumedUsd; uint8 stage; }
    mapping(address => RewardGroup[]) private rewardGroups;
    mapping(address => mapping(address => bool)) public groupedBranch;
    event NetworkVolumeQueued(uint256 indexed job,address indexed source,uint256 usd);
    event NetworkVolumeProgress(uint256 indexed job,address nextAncestor);
    event RewardGroupCreated(address indexed user,uint256 indexed group,address[3] branches);
    event NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd);
    function _networkParent(address who) internal view virtual returns(address);
    function _capitalChanged(address who,uint256 beforeUsd,uint256 afterUsd) internal {
        address parent=_networkParent(who); if(parent==address(0)) return;
        if(beforeUsd<ACTIVE_DIRECT_USD && afterUsd>=ACTIVE_DIRECT_USD) qualifiedDirects[parent]++;
        if(beforeUsd>=ACTIVE_DIRECT_USD && afterUsd<ACTIVE_DIRECT_USD) qualifiedDirects[parent]--;
    }
    function volumeJobCount() external view returns(uint256) { return volumeJobs.length; }
    function _addNetworkVolume(address who,uint256 usd) internal {
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
            branchVolumeUsd[parent][child]+=v.usd;
            address[3] storage top=largestBranches[parent];
            bool found; for(uint256 j;j<3;j++) if(top[j]==child) found=true;
            if(!found && (top[2]==address(0)||branchVolumeUsd[parent][child]>branchVolumeUsd[parent][top[2]])) top[2]=child;
            for(uint256 j=2;j>0;j--) if(branchVolumeUsd[parent][top[j]]>branchVolumeUsd[parent][top[j-1]]) (top[j],top[j-1])=(top[j-1],top[j]);
            v.child=parent; v.ancestor=_networkParent(parent);
        }
        emit NetworkVolumeProgress(job,v.ancestor);
    }
    function _split(uint256 total) internal pure returns(uint256[3] memory n) {
        n[0]=total*70/100; n[1]=total*20/100; n[2]=total-n[0]-n[1];
    }
    function rankQualified(address who,uint256 directs,uint256 total) public view returns(bool) {
        if(total==0 || qualifiedDirects[who]<directs) return false;
        uint256[3] memory required=_split(total); address[3] storage top=largestBranches[who];
        for(uint256 i;i<3;i++) if(top[i]==address(0)||branchVolumeUsd[who][top[i]]<required[i]) return false;
        return true;
    }
    /// @notice Fixed disjoint groups prevent reusing a branch in another reward path.
    function createRewardGroup(address[3] calldata branches) external {
        for(uint256 i;i<3;i++) {
            address b=branches[i];
            if(b==address(0)||_networkParent(b)!=msg.sender||groupedBranch[msg.sender][b]) revert NetworkInvalid();
            groupedBranch[msg.sender][b]=true;
        }
        uint256 index=rewardGroups[msg.sender].length;
        rewardGroups[msg.sender].push(RewardGroup(branches,[uint256(0),0,0],0));
        emit RewardGroupCreated(msg.sender,index,branches);
    }
    function rewardGroupCount(address who) external view returns(uint256) { return rewardGroups[who].length; }
    function rewardGroup(address who,uint256 group) external view returns(RewardGroup memory) { return rewardGroups[who][group]; }
    function rewardStage(uint256 stage) public pure returns(uint256 volumeUsd,uint256 rewardUsd) {
        uint256[14] memory volumes=[uint256(500),1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];
        if(stage>=14) revert NetworkInvalid();
        volumeUsd=volumes[stage]*1 ether;
        rewardUsd=volumeUsd*(stage<8?5:stage<11?4:3)/100;
    }
    function rewardPreview(address who,uint256 group) public view returns(bool eligible,uint256 volumeUsd,uint256 rewardUsd,uint256[3] memory consume) {
        RewardGroup storage g=rewardGroups[who][group];
        if(g.stage>=14) return(false,0,0,consume);
        (volumeUsd,rewardUsd)=rewardStage(g.stage);
        uint256[3] memory remaining; uint256[3] memory order=[uint256(0),1,2];
        for(uint256 i;i<3;i++) remaining[i]=branchVolumeUsd[who][g.branches[i]]-g.consumedUsd[i];
        for(uint256 i;i<2;i++) for(uint256 j=i+1;j<3;j++) if(remaining[order[j]]>remaining[order[i]]) (order[i],order[j])=(order[j],order[i]);
        uint256[3] memory required=_split(volumeUsd); eligible=true;
        for(uint256 i;i<3;i++) { consume[order[i]]=required[i]; if(remaining[order[i]]<required[i]) eligible=false; }
    }
    function _consumeReward(address who,uint256 group) internal returns(uint256 rewardUsd) {
        (bool eligible,uint256 volume,uint256 reward,uint256[3] memory consume)=rewardPreview(who,group);
        if(!eligible) revert NetworkInsufficient();
        RewardGroup storage g=rewardGroups[who][group];
        for(uint256 i;i<3;i++) g.consumedUsd[i]+=consume[i];
        emit NetworkRewardEarned(who,group,g.stage,volume,reward); g.stage++;
        return reward;
    }
}
