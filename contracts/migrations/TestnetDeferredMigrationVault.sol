// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DropshippingVault} from "../DropshippingVault.sol";
import {ImportedWithdrawalQueue} from "./ImportedWithdrawalQueue.sol";
interface IDeferredMigrationSource {function withdrawalQueue() external view returns(address);function REWARD_ACCRUAL_VERSION() external view returns(uint256);}
/// @notice TESTNET ONLY state copy including the legacy profit queue. Legacy claims remain independent.
contract TestnetDeferredMigrationVault is DropshippingVault {
    event DeferredStateCopied(address indexed source,address indexed owner);
    address public immutable migrationSource;
    uint256 public immutable migrationBlock;
    uint256 public constant REWARD_ACCRUAL_VERSION=1;
    ImportedWithdrawalQueue public immutable withdrawalQueue;
    uint256 private accrualNonce;
    constructor(DropshippingVault source,address[] memory members,bytes32[] memory settlements,bytes32[] memory batches)
        DropshippingVault(source.owner(),source.usdt(),address(source.bnbUsdFeed()),address(source.usdtUsdFeed()),source.maxOracleAge(),_partners(source),source.dropshippingWallet()) {
        require(block.chainid==97,"TESTNET_ONLY");
        require(source.paused(),"PAUSE_SOURCE_FIRST");
        require(source.pendingOwner()==address(0),"PENDING_OWNER");
        require(IDeferredMigrationSource(address(source)).REWARD_ACCRUAL_VERSION()==1,"DEFERRED_SOURCE_REQUIRED");
        migrationSource=address(source);migrationBlock=block.number;
        withdrawalQueue=new ImportedWithdrawalQueue(IDeferredMigrationSource(address(source)).withdrawalQueue(),address(source),usdt);
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
        for(uint256 id;id<withdrawalQueue.requestCount();id++){
            (address user,,,,,)=withdrawalQueue.requests(id);require(users[user].registered,"MISSING_QUEUE_USER");
        }
        for(uint256 a;a<2;a++){
            address asset=a==0?address(0):usdt;
            (uint256 principal,uint256 profit,uint256 reserve,uint256 rewards)=source.ledgers(asset);
            require(principal==ledgers[asset].principal&&profit==ledgers[asset].profit,"INCOMPLETE_ACCOUNTS");
            require(source.assetBalance(asset)==0&&reserve==0&&rewards==0,"SETTLE_TREASURY_FIRST");
            ledgers[asset]=Ledger(principal,profit,0,0);
            ownerCapitalOutstanding[asset]=source.ownerCapitalOutstanding(asset);
            retainedPrincipalPenalties[asset]=source.retainedPrincipalPenalties(asset);
            require(accounted(asset)==source.accounted(asset),"INCOMPLETE_LIABILITIES");
        }
        uint256 jobs=source.volumeJobCount();
        for(uint256 i;i<jobs;i++){(address child,address ancestor,uint256 usd)=source.volumeJobs(i);volumeJobs.push(VolumeJob(child,ancestor,usd));}
        for(uint256 i;i<settlements.length;i++){require(source.usedSettlement(settlements[i]),"UNKNOWN_SETTLEMENT");usedSettlement[settlements[i]]=true;}
        for(uint256 i;i<batches.length;i++){require(source.usedRewardBatch(batches[i]),"UNKNOWN_BATCH");usedRewardBatch[batches[i]]=true;}
        // Owner reviews the copied state before activating the new testnet deployment.
        paused=true;
        emit DeferredStateCopied(address(source),owner());
    }
    function accounted(address asset) public view override returns(uint256){return super.accounted(asset)+withdrawalQueue.pending(asset);}
    function _claimNetworkReward(uint256 group) internal override {
        uint256 usd=_consumeReward(msg.sender,group);uint256 amount=quoteAsset(usdt,usd);
        if(amount==0)revert Insufficient();
        uint256 funded=ledgers[usdt].rewards;
        ledgers[usdt].rewards=funded>amount?funded-amount:0;
        _credit(msg.sender,usdt,amount,keccak256(abi.encode("NETWORK_ACCRUAL",msg.sender,group,accrualNonce++)));
    }
    /// @notice Unlock consecutive stages atomically; a shortfall in any selected stage reverts the whole batch.
    function claimNetworkRewards(uint256 group,uint8 expectedStage,uint8 count) external nonReentrant live {
        if(count==0||uint256(expectedStage)+count>14)revert Invalid();
        _checkRewardStage(msg.sender,group,expectedStage);
        for(uint256 i;i<count;i++)_claimNetworkReward(group);
    }
    /// @notice Reserve profit now; payment may occur at any time within 72 hours, or later if funding is late.
    function withdrawProfit(address asset,uint256 amount) external override nonReentrant {
        _takeProfit(msg.sender,asset,amount,true);
        withdrawalQueue.record(msg.sender,asset,amount,amount*profitFeeBps/BPS,0,false);
    }
    /// @notice Capital remains invested until the approved principal request is paid.
    function withdrawPrincipal(uint256 id,uint256 amount) external override nonReentrant {
        (address asset,uint256 fee)=_principalTerms(msg.sender,id,amount);
        withdrawalQueue.record(msg.sender,asset,amount,fee,id,true);
    }
    function settleQueuedWithdrawal(address user,address asset,uint256 gross,uint256 fee,uint256 id,bool principal,bool cancel) external nonReentrant {
        if(msg.sender!=address(withdrawalQueue))revert Unauthorized();
        if(principal){if(!cancel)_withdrawPrincipal(user,id,gross);}
        else if(cancel)_credit(user,asset,gross,keccak256(abi.encode("CANCEL",user,asset,accrualNonce++)));
        else{
            _requireLiquidity(asset,gross);
            _pay(asset,WITHDRAWAL_FEE_WALLET,fee);_pay(asset,user,gross-fee);emit Withdrawal(user,asset,gross,fee,false);
        }
    }
    function _copyMember(DropshippingVault source,address who) private {
            (address parent,bool registered,bool active,bool kyc,uint32 directs,uint256 capital,uint256 sales)=source.users(who);
            require(registered,"UNREGISTERED_MEMBER");
            users[who]=User(parent,registered,active,kyc,directs,capital,sales);
            // Imported accounts must be discoverable by the daily allocation index.
            emit Registered(who,parent);
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
