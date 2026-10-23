// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DropshippingVault} from "./DropshippingVault.sol";
import {ProfitWithdrawalQueue} from "./ProfitWithdrawalQueue.sol";
/// @notice Candidate new deployment: earned network rewards create liabilities even without available cash.
contract DeferredRewardsVault is DropshippingVault {
    uint256 public constant REWARD_ACCRUAL_VERSION=1;
    ProfitWithdrawalQueue public immutable withdrawalQueue;
    uint256 private accrualNonce;
    constructor(address owner,address token,address bnbFeed,address tokenFeed,uint256 age,address[] memory partners,address operations)
        DropshippingVault(owner,token,bnbFeed,tokenFeed,age,partners,operations){withdrawalQueue=new ProfitWithdrawalQueue();}
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
}
