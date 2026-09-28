// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ThreeLinePlan} from "./ThreeLinePlan.sol";

interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80);
}

/// @notice Non-upgradeable owner-managed treasury. Balances are claims, not guaranteed liquid backing. No automatic daily yield.
/// @dev USD values use 18 decimals. address(0) is native BNB. Sales evidence is an off-chain trust boundary.
contract DropshippingVault is Ownable2Step, ReentrancyGuard, ThreeLinePlan {
    using SafeERC20 for IERC20;
    uint256 public constant BPS = 10_000;
    uint256 public constant CONFIG_DELAY = 2 days;
    address public constant FEE_WALLET_1 = address(bytes20(hex"7037cc199499d7a3431285a01e435454eae51265"));
    address public constant FEE_WALLET_2 = address(bytes20(hex"5bc282a45a8a1d7d9b915f04fc1d4031156d7632"));
    address public constant WITHDRAWAL_FEE_WALLET = address(bytes20(hex"74015dedf36677485793f1714ec7bd4893907b26"));
    mapping(address => uint256) public ownerCapitalOutstanding;
    address public immutable usdt;
    address public immutable dropshippingWallet;
    mapping(address => uint256) public retainedPrincipalPenalties; // cumulative retained fees; not a protected balance
    uint8 public immutable tokenDecimals;
    IPriceFeed public immutable bnbUsdFeed;
    IPriceFeed public immutable usdtUsdFeed;
    uint256 public immutable maxOracleAge;
    uint256 public minDepositUsd = 10 ether;
    uint16 public profitFeeBps = 500;
    uint16 public principalPenaltyBps = 3000;
    uint32 public lockDuration = 90 days;
    uint32 public withdrawalCooldown = 72 hours;
    bool public paused;
    mapping(address => bool) public reporters;
    mapping(bytes32 => uint256) public queuedConfig;

    struct Ledger { uint256 principal; uint256 profit; uint256 feeReserve; uint256 rewards; }
    mapping(address => Ledger) public ledgers;
    struct Account { uint256 principal; uint256 profit; uint256 externalDeposited; uint256 nextWithdrawal; }
    mapping(address => mapping(address => Account)) public accounts; // user => asset
    mapping(address => mapping(address => uint256)) public cumulativeReinvested; // user => asset; consumed profit only
    struct User { address referrer; bool registered; bool active; bool vipKyc; uint32 activeDirect; uint256 capitalUsd; uint256 salesUsd; }
    mapping(address => User) public users;
    struct Position { address asset; uint256 principal; uint256 capitalUsd; uint256 unlockAt; uint16 penaltyBps; }
    mapping(address => Position[]) private positions;
    struct Tier { uint256 minUsd; uint16 baseDailyBps; uint16 maxDailyBps; uint32 requiredDirect; uint256 requiredSalesUsd; uint16[4] referrals; }
    Tier[5] private tiers;
    mapping(bytes32 => bool) public usedSettlement;
    mapping(bytes32 => bool) public usedRewardBatch;
    mapping(address => bool) public isPartner;
    uint8 public constant partnerCount = 7;
    address[7] public partnerWallets;
    uint8 public partnerVotesRequired;
    mapping(bytes32 => uint256) public configRound;
    mapping(bytes32 => uint8) public configVotes;
    mapping(bytes32 => uint8) public configVotesRequired;
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) public hasConfigVoted;

    error Invalid(); error Unauthorized(); error Insufficient(); error Locked(); error StalePrice(); error Unsupported(); error InsufficientLiquidity();
    event OwnerCapitalWithdrawn(address indexed owner,address indexed asset,address indexed recipient,uint256 amount);
    event DepositRouted(address indexed user,address indexed asset,address indexed recipient,uint256 amount);
    event PrincipalPenaltyRetained(address indexed user,address indexed asset,uint256 amount);
    event CapitalReturned(address indexed sender,address indexed asset,uint256 amount,uint256 outstandingReduced);
    event Registered(address indexed user,address indexed referrer);
    event Funded(address indexed sender,address indexed asset,uint256 amount,bool feeReserve);
    event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach);
    event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id);
    event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash);
    event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal);
    event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position);
    event CustomerStatus(address indexed user,bool active,bool vipKyc);
    event ConfigurationQueued(bytes32 indexed hash,uint256 executeAfter);
    event ConfigurationApplied(bytes32 indexed hash);
    event PauseChanged(bool paused);
    event ConfigurationVoted(bytes32 indexed hash,uint256 indexed round,address indexed partner);
    event ConfigurationCancelled(bytes32 indexed hash,uint256 indexed round);

    modifier live() { if(paused) revert Locked(); _; }
    modifier reporter() { if(!reporters[msg.sender]) revert Unauthorized(); _; }
    modifier delayed() {
        bytes32 h=keccak256(msg.data); uint256 eta=queuedConfig[h];
        if(eta==0 || block.timestamp<eta || configVotes[h]<configVotesRequired[h]) revert Locked();
        delete queuedConfig[h]; delete configVotes[h]; delete configVotesRequired[h]; _; emit ConfigurationApplied(h);
    }
    constructor(address initialOwner,address token,address bnbFeed,address tokenFeed,uint256 oracleAge,address[] memory partners,address operationsWallet)
        Ownable(initialOwner) {
        if(token.code.length==0 || bnbFeed.code.length==0 || tokenFeed.code.length==0 || oracleAge==0 || oracleAge>7 days || partners.length!=7) revert Invalid();
        if(operationsWallet==address(0)||operationsWallet==address(this)||operationsWallet==FEE_WALLET_1||operationsWallet==FEE_WALLET_2||operationsWallet==WITHDRAWAL_FEE_WALLET) revert Invalid();
        dropshippingWallet=operationsWallet;
        usdt=token; tokenDecimals=IERC20Metadata(token).decimals(); if(tokenDecimals>18) revert Invalid();
        bnbUsdFeed=IPriceFeed(bnbFeed); usdtUsdFeed=IPriceFeed(tokenFeed); maxOracleAge=oracleAge;
        if(IPriceFeed(bnbFeed).decimals()>18 || IPriceFeed(tokenFeed).decimals()>18) revert Invalid();
        for(uint256 i;i<partners.length;i++) { address p=partners[i]; if(p==address(0)||isPartner[p]) revert Invalid(); isPartner[p]=true; partnerWallets[i]=p; }
        partnerVotesRequired=2; reporters[initialOwner]=true;
        tiers[0]=Tier(10 ether,50,100,4,2500 ether,[uint16(600),300,150,50]);
        tiers[1]=Tier(500 ether+1,70,120,6,10000 ether,[uint16(800),400,200,100]);
        tiers[2]=Tier(2500 ether+1,90,150,8,50000 ether,[uint16(1000),500,200,100]);
        tiers[3]=Tier(10000 ether+1,110,180,10,250000 ether,[uint16(1200),600,300,100]);
        tiers[4]=Tier(50000 ether+1,130,200,12,1000000 ether,[uint16(1400),700,300,100]);
    }
    // Unclassified native transfers are surplus, never principal or profit.
    receive() external payable {}
    function renounceOwnership() public override onlyOwner { revert Unsupported(); }
    /// @notice Owner proposes exact calldata hash; a fresh round needs partner votes and the delay.
    function queueConfiguration(bytes32 h) external onlyOwner {
        if(h==bytes32(0)||queuedConfig[h]!=0) revert Invalid();
        configRound[h]++; configVotes[h]=0; configVotesRequired[h]=partnerVotesRequired;
        queuedConfig[h]=block.timestamp+CONFIG_DELAY;
        emit ConfigurationQueued(h,queuedConfig[h]);
    }
    function voteConfiguration(bytes32 h) external {
        if(!isPartner[msg.sender]) revert Unauthorized();
        uint256 round=configRound[h];
        if(queuedConfig[h]==0||hasConfigVoted[h][round][msg.sender]) revert Invalid();
        hasConfigVoted[h][round][msg.sender]=true; configVotes[h]++;
        emit ConfigurationVoted(h,round,msg.sender);
    }
    function cancelConfiguration(bytes32 h) external onlyOwner {
        if(queuedConfig[h]==0) revert Invalid();
        delete queuedConfig[h]; delete configVotes[h]; delete configVotesRequired[h];
        emit ConfigurationCancelled(h,configRound[h]);
    }
    function setPaused(bool value) external onlyOwner { paused=value; emit PauseChanged(value); }
    function setReporter(address who,bool enabled) external onlyOwner delayed { if(who==address(0)) revert Invalid(); reporters[who]=enabled; }
    function setFees(uint16 profit,uint16 penalty) external onlyOwner delayed {
        if(profit>1000 || penalty>5000) revert Invalid(); profitFeeBps=profit; principalPenaltyBps=penalty;
    }
    function setWithdrawalRules(uint32 duration,uint32 cooldown) external onlyOwner delayed {
        if(duration>3650 days || cooldown>30 days) revert Invalid(); lockDuration=duration; withdrawalCooldown=cooldown;
    }
    function setMinDeposit(uint256 usd) external onlyOwner delayed { if(usd==0) revert Invalid(); minDepositUsd=usd; }
    function setPartnerVoteRequired(uint8 required) external onlyOwner delayed { if(required<2 || required>partnerCount) revert Invalid(); partnerVotesRequired=required; }
    function setTierConfig(uint8 index,Tier calldata config) external onlyOwner delayed {
        if(index>=5 || config.minUsd==0 || config.requiredSalesUsd==0 || config.requiredDirect<3 || config.baseDailyBps>config.maxDailyBps || config.maxDailyBps>1000) revert Invalid();
        if(index>0 && config.minUsd<=tiers[index-1].minUsd) revert Invalid();
        if(index<4 && config.minUsd>=tiers[index+1].minUsd) revert Invalid();
        uint256 sum; for(uint256 j;j<4;j++) { sum+=config.referrals[j]; if(j>0 && config.referrals[j]>config.referrals[j-1]) revert Invalid(); }
        if(sum>2500) revert Invalid(); tiers[index]=config;
    }
    function tierConfig(uint256 index) external view returns(Tier memory) { return tiers[index]; }
    function tierOf(address who) public view returns(uint8 t) { for(uint8 i=1;i<5;i++) { if(users[who].capitalUsd>=tiers[i].minUsd) t=i; } }
    function dailyTargetBps(address who) external view returns(uint16) {
        Tier storage t=tiers[tierOf(who)]; User storage u=users[who];
        if(u.capitalUsd<tiers[0].minUsd) return 0;
        return rankQualified(who,t.requiredDirect,t.requiredSalesUsd) ? t.maxDailyBps:t.baseDailyBps;
    }
    function _networkParent(address who) internal view override returns(address) { return users[who].referrer; }
    function register(address referrer) external live { _register(msg.sender,referrer); }
    function _register(address who,address parent) internal {
        if(users[who].registered || who==parent || (parent!=address(0)&&!users[parent].registered)) revert Invalid();
        users[who].registered=true; users[who].referrer=parent; emit Registered(who,parent);
    }
    function setCustomerStatus(address who,bool active,bool kyc) external reporter {
        User storage u=users[who]; if(!u.registered) revert Invalid();
        if(active!=u.active && u.referrer!=address(0)) { if(active) users[u.referrer].activeDirect++; else users[u.referrer].activeDirect--; }
        u.active=active; u.vipKyc=kyc; emit CustomerStatus(who,active,kyc);
    }
    function _asset(address asset) internal view { if(asset!=address(0)&&asset!=usdt) revert Unsupported(); }
    function _price(address asset) internal view returns(uint256) {
        _asset(asset); IPriceFeed f=asset==address(0)?bnbUsdFeed:usdtUsdFeed;
        (uint80 round,int256 answer,,uint256 updated,uint80 answered)=f.latestRoundData();
        if(round==0 || answer<=0 || updated==0 || updated>block.timestamp || block.timestamp-updated>maxOracleAge || answered<round) revert StalePrice();
        return uint256(answer)*10**(18-f.decimals());
    }
    function quoteUsd(address asset,uint256 amount) public view returns(uint256) { return Math.mulDiv(amount,_price(asset),10**(asset==address(0)?18:tokenDecimals)); }
    function quoteAsset(address asset,uint256 usd) public view returns(uint256) { return Math.mulDiv(usd,10**(asset==address(0)?18:tokenDecimals),_price(asset)); }
    function assetBalance(address asset) public view returns(uint256) { _asset(asset); return asset==address(0)?address(this).balance:IERC20(asset).balanceOf(address(this)); }
    function accounted(address asset) public view returns(uint256) { Ledger storage l=ledgers[asset]; return l.principal+l.profit+l.feeReserve+l.rewards; }
    function surplus(address asset) public view returns(uint256) { uint256 balance=assetBalance(asset); uint256 debt=accounted(asset); return balance>debt?balance-debt:0; }
    /// @notice Owner can use ALL liquid BNB/USDT, including amounts assigned to user claims and reserves.
    /// @dev No partner approval, delay, strategy restriction or on-chain profitability guarantee.
    function ownerWithdrawCapital(address asset,address recipient,uint256 amount) external onlyOwner nonReentrant {
        _asset(asset);
        if(recipient==address(0)||recipient==address(this)||amount==0) revert Invalid();
        if(amount>assetBalance(asset)) revert InsufficientLiquidity();
        ownerCapitalOutstanding[asset]+=amount;
        _pay(asset,recipient,amount);
        emit OwnerCapitalWithdrawn(msg.sender,asset,recipient,amount);
    }
    /// @notice Restore liquidity without creating deposits, profit, reserve credit or fees.
    function returnCapital(address asset,uint256 amount) external payable nonReentrant {
        _pull(asset,amount);
        uint256 reduced=Math.min(amount,ownerCapitalOutstanding[asset]);
        ownerCapitalOutstanding[asset]-=reduced;
        emit CapitalReturned(msg.sender,asset,amount,reduced);
    }
    function liquidityShortfall(address asset) external view returns(uint256) {
        uint256 cash=assetBalance(asset); uint256 claims=accounted(asset);
        return claims>cash?claims-cash:0;
    }
    function _requireLiquidity(address asset,uint256 amount) internal view {
        if(assetBalance(asset)<amount) revert InsufficientLiquidity();
    }
    function _pull(address asset,uint256 amount) internal {
        _asset(asset); if(amount==0) revert Invalid();
        if(asset==address(0)) { if(msg.value!=amount) revert Invalid(); }
        else { if(msg.value!=0) revert Invalid(); uint256 beforeBalance=assetBalance(asset); IERC20(asset).safeTransferFrom(msg.sender,address(this),amount); if(assetBalance(asset)-beforeBalance!=amount) revert Unsupported(); }
    }
    function _pay(address asset,address to,uint256 amount) internal {
        if(amount==0) return;
        if(asset==address(0)) { (bool ok,)=to.call{value:amount}(""); if(!ok) revert Invalid(); }
        else IERC20(asset).safeTransfer(to,amount);
    }
    function fundFeeReserve(address asset,uint256 amount) external payable nonReentrant { _pull(asset,amount); ledgers[asset].feeReserve+=amount; emit Funded(msg.sender,asset,amount,true); }
    function fundRewards(address asset,uint256 amount) external payable nonReentrant { _pull(asset,amount); ledgers[asset].rewards+=amount; emit Funded(msg.sender,asset,amount,false); }
    function positionCount(address who) external view returns(uint256) { return positions[who].length; }
    function positionOf(address who,uint256 index) external view returns(Position memory) { return positions[who][index]; }
    function _open(address who,address asset,uint256 amount,uint256 usd) internal returns(uint256 id) {
        if(users[who].capitalUsd+usd>=tiers[4].minUsd && !users[who].vipKyc) revert Unauthorized();
        id=positions[who].length; positions[who].push(Position(asset,amount,usd,block.timestamp+lockDuration,principalPenaltyBps));
        _capitalChanged(who,users[who].capitalUsd,users[who].capitalUsd+usd);
        _addNetworkVolume(who,usd);
        accounts[who][asset].principal+=amount; ledgers[asset].principal+=amount; users[who].capitalUsd+=usd;
    }
    function deposit(address asset,uint256 amount,address referrer) external payable nonReentrant live {
        if(!users[msg.sender].registered) _register(msg.sender,referrer);
        else if(referrer!=users[msg.sender].referrer) revert Invalid();
        uint256 usd=quoteUsd(asset,amount); if(usd<minDepositUsd) revert Insufficient();
        uint256 fee=amount/10;
        uint256 operationsAmount=amount-fee*2; // rounding remainder goes to operations; no dust left behind
        _pull(asset,amount);
        uint256 id=_open(msg.sender,asset,amount,usd); accounts[msg.sender][asset].externalDeposited+=amount;
        ownerCapitalOutstanding[asset]+=operationsAmount;
        _pay(asset,FEE_WALLET_1,fee); _pay(asset,FEE_WALLET_2,fee);
        _pay(asset,dropshippingWallet,operationsAmount);
        emit DepositRouted(msg.sender,asset,dropshippingWallet,operationsAmount);
        emit Deposited(msg.sender,asset,id,amount,usd,fee);
    }
    function _credit(address who,address asset,uint256 amount,bytes32 id) internal {
        accounts[who][asset].profit+=amount; ledgers[asset].profit+=amount; emit ProfitCredited(who,asset,amount,id);
    }
    /// @notice Each item is gross REAL sales profit; referrals are carved out of it, not minted on top.
    function settleSalesProfit(bytes32 id,address asset,address seller,uint256 gross,uint256 salesUsd,bytes32 evidenceHash)
        external payable reporter nonReentrant live {
        if(id==bytes32(0)||usedSettlement[id]||!users[seller].registered||salesUsd==0||evidenceHash==bytes32(0)) revert Invalid();
        usedSettlement[id]=true; _pull(asset,gross); users[seller].salesUsd+=salesUsd; _addNetworkVolume(seller,salesUsd);
        Tier storage t=tiers[tierOf(seller)]; uint256 commissions; address parent=users[seller].referrer;
        for(uint256 level;level<4 && parent!=address(0);level++) {
            User storage u=users[parent];
            if(u.active && (tierOf(parent)!=4||u.vipKyc) && (level!=3||tierOf(parent)==4)) {
                uint256 reward=Math.mulDiv(gross,t.referrals[level],BPS); commissions+=reward; _credit(parent,asset,reward,id);
            }
            parent=u.referrer;
        }
        _credit(seller,asset,gross-commissions,id); emit SaleSettled(id,seller,asset,gross,salesUsd,evidenceHash);
    }
    /// @notice Funded leaderboard/performance allocations, never referral rewards on deposits.
    function batchProfit(bytes32 id,address asset,address[] calldata recipients,uint256[] calldata amounts) external reporter nonReentrant live {
        _asset(asset); if(id==bytes32(0)||usedRewardBatch[id]||recipients.length==0||recipients.length>100||recipients.length!=amounts.length) revert Invalid();
        usedRewardBatch[id]=true; uint256 total;
        for(uint256 i;i<recipients.length;i++) { if(!users[recipients[i]].registered||amounts[i]==0) revert Invalid(); total+=amounts[i]; }
        if(ledgers[asset].rewards<total) revert Insufficient(); ledgers[asset].rewards-=total;
        for(uint256 i;i<recipients.length;i++) _credit(recipients[i],asset,amounts[i],id);
    }
    /// @notice Gross per-withdrawal ceiling from lifetime deposits plus completed reinvestments of the same asset.
    function profitWithdrawalCap(address who,address asset) public view returns(uint256) {
        return (accounts[who][asset].externalDeposited+cumulativeReinvested[who][asset])/10;
    }
    function _takeProfit(address who,address asset,uint256 amount,bool cooldown) internal {
        _asset(asset); Account storage a=accounts[who][asset]; if(amount==0||a.profit<amount) revert Insufficient();
        if(cooldown) { if(block.timestamp<a.nextWithdrawal) revert Locked(); if(amount>profitWithdrawalCap(who,asset)) revert Insufficient(); a.nextWithdrawal=block.timestamp+withdrawalCooldown; }
        a.profit-=amount; ledgers[asset].profit-=amount;
    }
    function withdrawProfit(address asset,uint256 amount) external nonReentrant {
        _requireLiquidity(asset,amount); _takeProfit(msg.sender,asset,amount,true); uint256 fee=Math.mulDiv(amount,profitFeeBps,BPS);
        _pay(asset,WITHDRAWAL_FEE_WALLET,fee); _pay(asset,msg.sender,amount-fee); emit Withdrawal(msg.sender,asset,amount,fee,false);
    }
    function withdrawPrincipal(uint256 id,uint256 amount) external nonReentrant {
        Position storage p=positions[msg.sender][id]; Account storage a=accounts[msg.sender][p.asset];
        if(amount==0||amount>p.principal) revert Insufficient(); if(block.timestamp<p.unlockAt||block.timestamp<a.nextWithdrawal) revert Locked();
        uint256 fee=Math.mulDiv(amount,p.penaltyBps,BPS);
        _requireLiquidity(p.asset,amount); // require gross cash so the penalty remains physically in the vault
        uint256 usd=amount==p.principal?p.capitalUsd:Math.mulDiv(p.capitalUsd,amount,p.principal);
        _capitalChanged(msg.sender,users[msg.sender].capitalUsd,users[msg.sender].capitalUsd-usd);
        p.principal-=amount; p.capitalUsd-=usd; users[msg.sender].capitalUsd-=usd; a.principal-=amount; ledgers[p.asset].principal-=amount;
        a.nextWithdrawal=block.timestamp+withdrawalCooldown;
        retainedPrincipalPenalties[p.asset]+=fee;
        emit PrincipalPenaltyRetained(msg.sender,p.asset,fee); _pay(p.asset,msg.sender,amount-fee); emit Withdrawal(msg.sender,p.asset,amount,fee,true);
    }
    function reinvest(address asset,uint256 amount) external nonReentrant live {
        uint256 usd=quoteUsd(asset,amount); if(usd<minDepositUsd) revert Insufficient(); _takeProfit(msg.sender,asset,amount,false);
        uint256 id=_open(msg.sender,asset,amount,usd); cumulativeReinvested[msg.sender][asset]+=amount; emit Reinvested(msg.sender,asset,amount,id);
    }
    /// @notice Credit earned USD reward as USDT profit from a separately funded reward budget.
    /// @dev Standard profit withdrawal fee, cap and cooldown apply. No principal is minted.
    function claimNetworkReward(uint256 group) external nonReentrant live {
        uint256 usd=_consumeReward(msg.sender,group);
        uint256 amount=quoteAsset(usdt,usd);
        if(amount==0 || ledgers[usdt].rewards<amount) revert Insufficient();
        _requireLiquidity(usdt,amount);
        ledgers[usdt].rewards-=amount;
        _credit(msg.sender,usdt,amount,keccak256(abi.encode("NETWORK",msg.sender,group,rewardGroupStageNonce++)));
    }
    uint256 private rewardGroupStageNonce;
    // Member-to-member internal balance transfers are intentionally unsupported.
}
