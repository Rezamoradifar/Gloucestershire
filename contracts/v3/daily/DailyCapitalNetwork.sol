// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UnifiedNetworkPlan} from "../UnifiedNetworkPlan.sol";

/// @notice Uses the established branch membership, volume and disjoint groups.
/// The daily vault calls the cycle methods. The historical staged plan is never credited.
contract DailyCapitalNetwork is UnifiedNetworkPlan {
    uint256 public constant CYCLE_VOLUME = 500 ether;
    uint256 public constant CYCLE_REWARD = 35 ether;
    uint256 private constant BRANCH_CAP = 300 ether;

    struct Activity {
        uint64 since;
        uint64 until;
    }
    struct Rate {
        uint64 at;
        uint16 bps;
        uint8 tier;
    }
    struct BranchPreparation {
        uint256 cycle;
        uint256 used;
    }

    mapping(address => Activity[]) private activity;
    mapping(address => Rate[]) private rates;
    mapping(address => mapping(uint256 => uint256)) public completedCycles;
    mapping(address => mapping(uint256 => mapping(uint256 => BranchPreparation))) private preparations;

    event CyclePrepared(address indexed user,uint256 indexed group,uint256 cycle,uint256 preparedUsd,uint256 cursor);
    event CycleEarned(address indexed user,uint256 indexed group,uint256 cycle,uint256 volumeUsd,uint256 rewardUsd);

    constructor(address parent) UnifiedNetworkPlan(parent) {}

    function resetActivity(address who) external onlyVault {
        Activity[] storage windows=activity[who];
        if(windows.length!=0 && windows[windows.length-1].until>block.timestamp)
            windows[windows.length-1].until=uint64(block.timestamp);
    }

    function recordActivity(address who,uint16 bps,uint8 tier) external onlyVault {
        Activity[] storage windows=activity[who];
        uint64 until=uint64(block.timestamp+1 days);
        if(windows.length==0 || windows[windows.length-1].until<block.timestamp)
            windows.push(Activity(uint64(block.timestamp),until));
        else
            windows[windows.length-1].until=until;
        Rate[] storage history=rates[who];
        if(history.length==0 || history[history.length-1].bps!=bps || history[history.length-1].tier!=tier)
            history.push(Rate(uint64(block.timestamp),bps,tier));
    }

    function _firstEndingAfter(Activity[] storage windows,uint256 at) private view returns(uint256 index) {
        uint256 end=windows.length;
        while(index<end) {
            uint256 mid=index+(end-index)/2;
            if(windows[mid].until<=at) index=mid+1; else end=mid;
        }
    }

    function _termsAt(address who,uint256 at) private view returns(uint16 bps,uint8 tier) {
        Rate[] storage history=rates[who];
        uint256 lo;
        uint256 hi=history.length;
        while(lo<hi) {
            uint256 mid=lo+(hi-lo)/2;
            if(history[mid].at<=at) lo=mid+1; else hi=mid;
        }
        if(lo!=0) {
            Rate storage rate=history[lo-1];
            return (rate.bps,rate.tier);
        }
    }

    /// @dev A delayed settlement keeps the deposit's original daily clock. Missed
    /// activity windows cannot be restored by signing another check-in.
    function nextAccrual(address who,uint256 last) external view returns(uint256 due,uint16 bps,uint8 tier) {
        Activity[] storage windows=activity[who];
        due=last+1 days;
        for(uint256 i=_firstEndingAfter(windows,due);i<windows.length;i++) {
            Activity storage window=windows[i];
            if(due<window.since) due+=Math.ceilDiv(window.since-due,1 days)*1 days;
            if(due>=window.until) continue;
            if(due>block.timestamp) return (due,0,0);
            (bps,tier)=_termsAt(who,due);
            return (due,bps,tier);
        }
        if(due<block.timestamp) due+=Math.ceilDiv(block.timestamp-due,1 days)*1 days;
    }

    function activeAtMaturity(address who,uint256 due,bool vipRequired) external view returns(bool) {
        Activity[] storage windows=activity[who];
        uint256 i=_firstEndingAfter(windows,due);
        if(i==windows.length || windows[i].since>due) return false;
        if(!vipRequired) return true;
        (,uint8 tier)=_termsAt(who,due);
        return tier==4;
    }

    function cycleProgress(address who,uint256 group) external view returns(uint256 stage,uint256 preparedUsd,uint256 cursor,uint256 branches) {
        RewardGroup storage g=rewardGroups[who][group];
        return (completedCycles[who][group],g.preparedUsd,g.cursor,g.branches.length);
    }

    function availableFrom(address who,uint256 group,uint256 i,uint256 cycle) private view returns(uint256) {
        RewardGroup storage g=rewardGroups[who][group];
        BranchPreparation storage p=preparations[who][group][i];
        uint256 used=p.cycle==cycle?p.used:0;
        return Math.min(branchVolumeUsd[who][g.branches[i]]-g.consumedUsd[i],BRANCH_CAP-used);
    }

    function cyclePreview(address who,uint256 group) external view returns(bool eligible,uint256 volumeUsd,uint256 rewardUsd,uint256[] memory consume) {
        RewardGroup storage g=rewardGroups[who][group];
        uint256 cycle=completedCycles[who][group];
        uint256 remaining=CYCLE_VOLUME-g.preparedUsd;
        consume=new uint256[](g.branches.length);
        for(uint256 j=0;j<consume.length;j++) {
            uint256 i=(g.cursor+j)%consume.length;
            BranchPreparation storage p=preparations[who][group][i];
            uint256 take=Math.min(remaining,availableFrom(who,group,i,cycle));
            consume[i]=(p.cycle==cycle?p.used:0)+take;
            remaining-=take;
        }
        return (remaining==0,CYCLE_VOLUME,CYCLE_REWARD,consume);
    }

    function _prepare(address who,uint256 group,uint256 cycle,uint256 steps) private {
        if(steps==0 || steps>NETWORK_BATCH_LIMIT || completedCycles[who][group]!=cycle) revert NetworkInvalid();
        RewardGroup storage g=rewardGroups[who][group];
        uint256 count=Math.min(steps,g.branches.length);
        for(uint256 j=0;j<count && g.preparedUsd<CYCLE_VOLUME;j++) {
            uint256 i=g.cursor;
            uint256 take=Math.min(CYCLE_VOLUME-g.preparedUsd,availableFrom(who,group,i,cycle));
            if(take!=0) {
                BranchPreparation storage p=preparations[who][group][i];
                p.used=(p.cycle==cycle?p.used:0)+take;
                p.cycle=cycle;
                g.consumedUsd[i]+=take;
                g.preparedUsd+=take;
            }
            g.cursor=(i+1)%g.branches.length;
        }
        emit CyclePrepared(who,group,cycle,g.preparedUsd,g.cursor);
    }

    function prepareCycleFor(address who,uint256 group,uint256 cycle,uint256 steps) external onlyVault {
        _prepare(who,group,cycle,steps);
    }

    function consumeCyclesFor(address who,uint256 group,uint256 cycle,uint8 count) external onlyVault returns(uint256) {
        if(count==0 || count>14) revert NetworkInvalid();
        RewardGroup storage g=rewardGroups[who][group];
        for(uint256 i=0;i<count;i++) {
            _prepare(who,group,cycle+i,NETWORK_BATCH_LIMIT);
            if(g.preparedUsd!=CYCLE_VOLUME) revert NetworkInsufficient();
            emit CycleEarned(who,group,cycle+i,CYCLE_VOLUME,CYCLE_REWARD);
            completedCycles[who][group]=cycle+i+1;
            g.preparedUsd=0;
        }
        return CYCLE_REWARD*count;
    }
}
