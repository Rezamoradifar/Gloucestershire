// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeferredRewardsVault} from "./DeferredRewardsVault.sol";
import {DropshippingVault} from "./DropshippingVault.sol";
/// @notice TESTNET ONLY state copy. Legacy claims remain callable; this is not a debt extinguishment mechanism.
/// @dev Constructor-only import adds no migration authority or mutable importer to the deployed vault.
contract TestnetMigratedRewardsVault is DeferredRewardsVault {
    constructor(DropshippingVault source,address[] memory members,bytes32[] memory settlements,bytes32[] memory batches)
        DeferredRewardsVault(source.owner(),source.usdt(),address(source.bnbUsdFeed()),address(source.usdtUsdFeed()),source.maxOracleAge(),_partners(source),source.dropshippingWallet()) {
        require(block.chainid==97,"TESTNET_ONLY");
        require(source.paused(),"PAUSE_SOURCE_FIRST");
        // Pending withdrawal queues require a different migration format.
        (bool deferred,)=address(source).staticcall(abi.encodeWithSignature("REWARD_ACCRUAL_VERSION()"));
        require(!deferred,"LEGACY_SOURCE_ONLY");
        require(source.pendingOwner()==address(0),"PENDING_OWNER");
        minDepositUsd=source.minDepositUsd();profitFeeBps=source.profitFeeBps();principalPenaltyBps=source.principalPenaltyBps();
        lockDuration=source.lockDuration();withdrawalCooldown=source.withdrawalCooldown();partnerVotesRequired=source.partnerVotesRequired();
        for(uint256 i;i<5;i++)tiers[i]=source.tierConfig(i);
        address previous;
        for(uint256 i;i<members.length;i++){
            address who=members[i];require(uint160(who)>uint160(previous),"SORT_UNIQUE_MEMBERS");previous=who;
            _copyMember(source,who);
        }
        for(uint256 i;i<members.length;i++){
            address parent=users[members[i]].referrer;require(parent==address(0)||users[parent].registered,"MISSING_PARENT");
        }
        for(uint256 a;a<2;a++){
            address asset=a==0?address(0):usdt;
            (uint256 principal,uint256 profit,uint256 reserve,uint256 rewards)=source.ledgers(asset);
            require(principal==ledgers[asset].principal&&profit==ledgers[asset].profit,"INCOMPLETE_ACCOUNTS");
            // Cash and funded budgets are NOT transferred by copying state.
            require(source.assetBalance(asset)==0&&reserve==0&&rewards==0,"SETTLE_TREASURY_FIRST");
            ledgers[asset]=Ledger(principal,profit,0,0);
            ownerCapitalOutstanding[asset]=source.ownerCapitalOutstanding(asset);
            retainedPrincipalPenalties[asset]=source.retainedPrincipalPenalties(asset);
        }
        uint256 jobs=source.volumeJobCount();
        for(uint256 i;i<jobs;i++){(address child,address ancestor,uint256 usd)=source.volumeJobs(i);volumeJobs.push(VolumeJob(child,ancestor,usd));}
        for(uint256 i;i<settlements.length;i++){require(source.usedSettlement(settlements[i]),"UNKNOWN_SETTLEMENT");usedSettlement[settlements[i]]=true;}
        for(uint256 i;i<batches.length;i++){require(source.usedRewardBatch(batches[i]),"UNKNOWN_BATCH");usedRewardBatch[batches[i]]=true;}
        // Owner must inspect the result and explicitly activate the new deployment.
        paused=true;
    }
    function _copyMember(DropshippingVault source,address who) private {
            (address parent,bool registered,bool active,bool kyc,uint32 directs,uint256 capital,uint256 sales)=source.users(who);
            require(registered,"UNREGISTERED_MEMBER");
            users[who]=User(parent,registered,active,kyc,directs,capital,sales);
            qualifiedDirects[who]=source.qualifiedDirects(who);
            for(uint256 a;a<2;a++){
                address asset=a==0?address(0):usdt;
                (uint256 principal,uint256 profit,uint256 externalDeposited,uint256 nextWithdrawal)=source.accounts(who,asset);
                accounts[who][asset]=Account(principal,profit,externalDeposited,nextWithdrawal);
                cumulativeReinvested[who][asset]=source.cumulativeReinvested(who,asset);
                ledgers[asset].principal+=principal;ledgers[asset].profit+=profit;
            }
            _copyPositions(source,who);
            _copyNetwork(source,who);
    }
    function _copyPositions(DropshippingVault source,address who) private {
            uint256 n=source.positionCount(who);uint256[2] memory positionSum;uint256 capitalSum;
            for(uint256 j;j<n;j++){
                Position memory position=source.positionOf(who,j);_asset(position.asset);
                positions[who].push(position);positionSum[position.asset==address(0)?0:1]+=position.principal;capitalSum+=position.capitalUsd;
            }
            require(positionSum[0]==accounts[who][address(0)].principal&&positionSum[1]==accounts[who][usdt].principal&&capitalSum==users[who].capitalUsd,"POSITION_MISMATCH");
    }
    function _copyNetwork(DropshippingVault source,address who) private {
            uint256 n=source.networkBranchCount(who);
            for(uint256 j;j<n;j++){
                address branch=source.networkBranch(who,j);networkBranches[who].push(branch);
                branchVolumeUsd[who][branch]=source.branchVolumeUsd(who,branch);
                groupedBranch[who][branch]=source.groupedBranch(who,branch);
            }
            n=source.rewardGroupCount(who);
            for(uint256 j;j<n;j++){
                RewardGroup memory g=source.rewardGroup(who,j);rewardGroups[who].push(g);
                for(uint256 k;k<g.branches.length;k++){
                    (address branch,uint256 consumed,uint256 reserved)=source.rewardBranch(who,j,k);
                    require(branch==g.branches[k]&&consumed==g.consumedUsd[k],"GROUP_MISMATCH");
                    reservedUsd[who][j][g.stage][k]=reserved;
                    groupedBranch[who][branch]=true;
                }
            }
    }
    function _partners(DropshippingVault source) private view returns(address[] memory result){result=new address[](7);for(uint256 i;i<7;i++)result[i]=source.partnerWallets(i);}
}
