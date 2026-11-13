// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IGlobalV2PriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80);
}

/// @notice Isolated TESTNET PROTOTYPE. An off-chain business revenue claim cannot be verified
///         by a blockchain; the revenue funder must supply real cash for every new profit credit.
/// @dev Deposit routing preserves old economics (10%/10%/80%) but DOES NOT leave
///      principal cash backed in this contract. This must not be presented as insured principal.
contract GlobalV2Prototype is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_DEPOSIT_USD = 10 ether;
    uint256 public constant ACTIVE_WINDOW = 24 hours;
    uint256 public constant WITHDRAWAL_COOLDOWN = 72 hours;
    uint256 public constant PRINCIPAL_LOCK = 90 days;
    uint256 public constant PROFIT_FEE_BPS = 300;
    uint256 public constant PRINCIPAL_PENALTY_BPS = 3000;
    uint256 public constant PROFIT_WITHDRAWAL_CAP_BPS = 1000;
    uint256 public constant DEPOSIT_FEE_EACH_BPS = 1000;

    address public constant FEE_WALLET_1 = address(bytes20(hex"7037cc199499d7a3431285a01e435454eae51265"));
    address public constant FEE_WALLET_2 = address(bytes20(hex"5bc282a45a8a1d7d9b915f04fc1d4031156d7632"));
    address public constant WITHDRAWAL_FEE_WALLET = address(bytes20(hex"74015dedf36677485793f1714ec7bd4893907b26"));

    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");
    bytes32 public constant WITHDRAWAL_APPROVER_ROLE = keccak256("WITHDRAWAL_APPROVER_ROLE");
    bytes32 public constant REVENUE_FUNDER_ROLE = keccak256("REVENUE_FUNDER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    address public immutable usdt;
    address public immutable operationsWallet;
    IGlobalV2PriceFeed public immutable bnbFeed;
    IGlobalV2PriceFeed public immutable tokenFeed;
    uint8 public immutable tokenDecimals;
    uint32 public immutable oracleAge;

    struct User {
        address referrer;
        bool registered;
        bool vipKyc;
        bool suspended;
        uint64 lastCheckIn;
        uint256 capitalUsd;
    }
    struct Account {
        uint256 principal;
        uint256 profit;
        uint256 externalDeposited;
        uint256 reinvested;
        uint64 nextRequestAt;
        bool requestPending;
    }
    struct Position {
        address asset;
        uint256 principal;
        uint256 capitalUsd;
        uint64 openedAt;
        uint64 lastSettlementAt;
        uint256 reserved;
    }
    // status: 0 awaiting admin, 1 approved, 2 paid, 3 cancelled, 4 rejected
    struct Withdrawal {
        address user;
        address asset;
        uint256 gross;
        uint256 fee;
        uint256 positionId;
        uint64 requestedAt;
        uint8 status;
        bool principal;
    }

    mapping(address => User) public users;
    mapping(address => mapping(address => Account)) public accounts;
    mapping(address => Position[]) internal positions;
    mapping(address => uint256[]) internal userWithdrawalIds;
    address[] internal members;
    Withdrawal[] internal withdrawals;
    mapping(address => uint256) public principalLiability;
    mapping(address => uint256) public profitLiability;
    mapping(bytes32 => bool) public usedRevenueProof;
    bool public paused;

    error Invalid();
    error Forbidden();
    error Ineligible();
    error Locked();
    error Insufficient();
    error OracleInvalid();
    error InsufficientCash();
    error WrongState();
    error WrongChain();

    event Registered(address indexed user,address indexed referrer);
    event CheckIn(address indexed user,uint256 at);
    event UserSuspended(address indexed user,bool suspended);
    event VipKycChanged(address indexed user,bool verified,address indexed administrator);
    event DepositRouted(address indexed user,address indexed asset,uint256 gross,uint256 fee1,uint256 fee2,uint256 operations);
    event PositionOpened(address indexed user,address indexed asset,uint256 indexed id,uint256 principal,uint256 capitalUsd,bool reinvest);
    event PrincipalLiquidityFunded(address indexed sender,address indexed asset,uint256 amount);
    event EarningsFunded(bytes32 indexed proof,address indexed source,address indexed asset,uint256 position,uint256 gross,uint256 total,uint256 periodEnd);
    event PersonalProfitCredited(address indexed user,address indexed asset,bytes32 indexed proof,uint256 amount);
    event ReferralProfitCredited(address indexed upline,address indexed source,bytes32 indexed proof,uint8 level,uint256 rateBps,address asset,uint256 amount);
    event WithdrawalRequested(uint256 indexed id,address indexed user,address indexed asset,bool principal,uint256 gross,uint256 fee);
    event WithdrawalApproved(uint256 indexed id,address indexed administrator);
    event WithdrawalResolved(uint256 indexed id,uint8 status,bytes32 reason);
    event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 newPosition);

    modifier running() {if (paused) revert Locked(); _;}

    constructor(address admin,address token,address feedBnb,address feedToken,uint32 maxPriceAge,address operations) {
        if (block.chainid != 97) revert WrongChain();
        if (admin == address(0) || operations == address(0) || token.code.length == 0 ||
            feedBnb.code.length == 0 || feedToken.code.length == 0 || maxPriceAge == 0) revert Invalid();
        usdt = token;
        operationsWallet = operations;
        bnbFeed = IGlobalV2PriceFeed(feedBnb);
        tokenFeed = IGlobalV2PriceFeed(feedToken);
        oracleAge = maxPriceAge;
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals > 18 || bnbFeed.decimals() > 18 || tokenFeed.decimals() > 18) revert Invalid();
        tokenDecimals = decimals;
        _grantRole(DEFAULT_ADMIN_ROLE,admin);
        _grantRole(KYC_ADMIN_ROLE,admin);
        _grantRole(WITHDRAWAL_APPROVER_ROLE,admin);
        _grantRole(GUARDIAN_ROLE,admin);
        _grantRole(REVENUE_FUNDER_ROLE,admin);
    }

    function memberCount() external view returns(uint256) {return members.length;}
    function memberAt(uint256 index) external view returns(address) {return members[index];}
    function positionCount(address who) external view returns(uint256) {return positions[who].length;}
    function positionOf(address who,uint256 id) external view returns(Position memory) {return positions[who][id];}
    function withdrawalCount() external view returns(uint256) {return withdrawals.length;}
    function withdrawalOf(uint256 id) external view returns(Withdrawal memory) {return withdrawals[id];}
    function userWithdrawalCount(address who) external view returns(uint256) {return userWithdrawalIds[who].length;}
    function userWithdrawalId(address who,uint256 index) external view returns(uint256) {return userWithdrawalIds[who][index];}

    function setPaused(bool value) external onlyRole(GUARDIAN_ROLE) {paused=value;}
    function setSuspended(address who,bool value) external onlyRole(GUARDIAN_ROLE) {
        if (!users[who].registered) revert Invalid();
        users[who].suspended=value;
        emit UserSuspended(who,value);
    }
    function setVipKyc(address who,bool verified) external onlyRole(KYC_ADMIN_ROLE) {
        if (!users[who].registered) revert Invalid();
        users[who].vipKyc=verified;
        emit VipKycChanged(who,verified,msg.sender);
    }

    function register(address referrer) external running {
        _register(msg.sender,referrer);
    }
    function _register(address who,address referrer) private {
        if (users[who].registered || who == referrer || (referrer != address(0) && !users[referrer].registered)) revert Invalid();
        users[who].registered=true;
        users[who].referrer=referrer;
        members.push(who);
        emit Registered(who,referrer);
    }
    function checkIn() external running {
        User storage user=users[msg.sender];
        if (!user.registered || user.suspended) revert Ineligible();
        if (user.lastCheckIn!=0 && block.timestamp < uint256(user.lastCheckIn)+1 hours) revert Locked();
        user.lastCheckIn=uint64(block.timestamp);
        emit CheckIn(msg.sender,block.timestamp);
    }
    function isEligible(address who) public view returns(bool) {
        User storage u=users[who];
        return u.registered && !u.suspended && u.capitalUsd>=MIN_DEPOSIT_USD &&
            u.lastCheckIn!=0 && block.timestamp>=u.lastCheckIn && block.timestamp-u.lastCheckIn<ACTIVE_WINDOW;
    }

    function _asset(address asset) private view {
        if (asset!=address(0) && asset!=usdt) revert Invalid();
    }
    function assetBalance(address asset) public view returns(uint256) {
        _asset(asset);
        return asset==address(0)?address(this).balance:IERC20(asset).balanceOf(address(this));
    }
    function _price(IGlobalV2PriceFeed feed) private view returns(uint256) {
        (uint80 round,int256 value,,uint256 updated,uint80 answered)=feed.latestRoundData();
        if (round==0 || answered<round || value<=0 || updated==0 ||
            updated>block.timestamp || block.timestamp-updated>oracleAge) revert OracleInvalid();
        return uint256(value)*10**(18-feed.decimals());
    }
    function quoteUsd(address asset,uint256 amount) public view returns(uint256) {
        _asset(asset);
        return Math.mulDiv(amount,_price(asset==address(0)?bnbFeed:tokenFeed),
            10**(asset==address(0)?18:tokenDecimals));
    }
    function _receiveAsset(address asset,uint256 amount) private {
        if (amount==0) revert Invalid();
        if (asset==address(0)) {
            if (msg.value!=amount) revert Invalid();
        } else {
            if (msg.value!=0) revert Invalid();
            IERC20 token=IERC20(asset);
            uint256 beforeBalance=token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender,address(this),amount);
            if (token.balanceOf(address(this))-beforeBalance!=amount) revert Invalid();
        }
    }
    function _pay(address asset,address to,uint256 amount) private {
        if (amount==0) return;
        if (asset==address(0)) {
            (bool ok,)=payable(to).call{value:amount}("");
            if (!ok) revert InsufficientCash();
        } else IERC20(asset).safeTransfer(to,amount);
    }

    function deposit(address asset,uint256 amount,address referrer) external payable nonReentrant running {
        _asset(asset);
        uint256 usd=quoteUsd(asset,amount);
        if (usd<MIN_DEPOSIT_USD) revert Insufficient();
        User storage u=users[msg.sender];
        if (!u.registered) _register(msg.sender,referrer);
        else if (u.referrer!=referrer) revert Invalid();
        _receiveAsset(asset,amount);
        uint256 fee=amount/10;
        uint256 operations=amount-2*fee;
        Account storage a=accounts[msg.sender][asset];
        a.principal+=amount;
        a.externalDeposited+=amount;
        principalLiability[asset]+=amount;
        u.capitalUsd+=usd;
        _open(msg.sender,asset,amount,usd,false);
        _pay(asset,FEE_WALLET_1,fee);
        _pay(asset,FEE_WALLET_2,fee);
        _pay(asset,operationsWallet,operations);
        emit DepositRouted(msg.sender,asset,amount,fee,fee,operations);
    }
    function _open(address who,address asset,uint256 amount,uint256 usd,bool reinvested) private returns(uint256 id) {
        id=positions[who].length;
        positions[who].push(Position(asset,amount,usd,uint64(block.timestamp),uint64(block.timestamp),0));
        emit PositionOpened(who,asset,id,amount,usd,reinvested);
    }
    function reinvest(address asset,uint256 amount) external nonReentrant running {
        _asset(asset);
        Account storage a=accounts[msg.sender][asset];
        if (amount==0 || a.profit<amount) revert Insufficient();
        uint256 usd=quoteUsd(asset,amount);
        if (usd==0) revert Insufficient();
        a.profit-=amount;
        profitLiability[asset]-=amount;
        a.principal+=amount;
        a.reinvested+=amount;
        principalLiability[asset]+=amount;
        users[msg.sender].capitalUsd+=usd;
        uint256 id=_open(msg.sender,asset,amount,usd,true);
        emit Reinvested(msg.sender,asset,amount,id);
    }

    function tierOf(address who) public view returns(uint8) {
        uint256 capital=users[who].capitalUsd;
        if (capital>50_000 ether) return 4;
        if (capital>10_000 ether) return 3;
        if (capital>2_500 ether) return 2;
        if (capital>500 ether) return 1;
        return 0;
    }
    function baseDailyBps(uint8 tier) public pure returns(uint16) {
        if (tier==0) return 50;
        if (tier==1) return 70;
        if (tier==2) return 90;
        if (tier==3) return 110;
        if (tier==4) return 130;
        revert Invalid();
    }
    function referralBps(uint8 tier,uint8 level) public pure returns(uint16) {
        if (tier>4 || level>=4) revert Invalid();
        if (level==0) return [uint16(800),1000,1200,1400,1600][tier];
        if (level==1) return [uint16(400),500,600,700,800][tier];
        if (level==2) return [uint16(200),300,400,500,600][tier];
        return tier==4?400:0;
    }

    /// @notice Settlement is ONE funded atomic operation: source income and all eligible
    ///         referral shares are accounted together. No ability to mint an unfunded reward.
    /// @dev A funder's proof of off-chain revenue is still an external trust assumption.
    ///      One settlement per position per >=24h, at most the base DAILY rate for the tier.
    function settleFundedEarnings(address source,uint256 positionId,uint256 gross,bytes32 proof)
        external payable nonReentrant running onlyRole(REVENUE_FUNDER_ROLE) {
        if (gross==0 || proof==bytes32(0) || usedRevenueProof[proof] || !isEligible(source)) revert Ineligible();
        Position storage p=positions[source][positionId];
        if (p.principal==0 || block.timestamp<uint256(p.lastSettlementAt)+1 days) revert Locked();
        if (gross>Math.mulDiv(p.principal,baseDailyBps(tierOf(source)),BPS)) revert Insufficient();
        address asset=p.asset;
        uint8 sourceTier=tierOf(source);
        address parent=users[source].referrer;
        address[4] memory recipients;
        uint256[4] memory amounts;
        uint256 total=gross;
        for(uint8 i=0;i<4 && parent!=address(0);i++) {
            uint8 recipientTier=tierOf(parent);
            uint256 reward=Math.mulDiv(gross,referralBps(sourceTier,i),BPS);
            if (reward>0 && isEligible(parent) && (recipientTier!=4 || users[parent].vipKyc) &&
               (i!=3 || (recipientTier==4 && users[parent].vipKyc))) {
                recipients[i]=parent;
                amounts[i]=reward;
                total+=reward;
            }
            parent=users[parent].referrer;
        }
        usedRevenueProof[proof]=true;
        p.lastSettlementAt=uint64(block.timestamp);
        _receiveAsset(asset,total);
        accounts[source][asset].profit+=gross;
        for(uint8 i=0;i<4;i++) {
            if (amounts[i]==0) continue;
            accounts[recipients[i]][asset].profit+=amounts[i];
            emit ReferralProfitCredited(recipients[i],source,proof,i+1,referralBps(sourceTier,i),asset,amounts[i]);
        }
        profitLiability[asset]+=total;
        emit EarningsFunded(proof,source,asset,positionId,gross,total,block.timestamp);
        emit PersonalProfitCredited(source,asset,proof,gross);
    }

    /// @notice The old 20/80 routing creates a potentially UNFUNDED principal
    ///         obligation. Operations must explicitly replenish actual cash.
    function fundPrincipalLiquidity(address asset,uint256 amount) external payable nonReentrant {
        _asset(asset);
        _receiveAsset(asset,amount);
        emit PrincipalLiquidityFunded(msg.sender,asset,amount);
    }
    function availablePrincipalCash(address asset) public view returns(uint256) {
        uint256 cash=assetBalance(asset);uint256 reservedProfit=profitLiability[asset];
        return cash>reservedProfit?cash-reservedProfit:0;
    }
    function unfundedPrincipal(address asset) external view returns(uint256) {
        uint256 free=availablePrincipalCash(asset),debt=principalLiability[asset];
        return debt>free?debt-free:0;
    }
    function profitWithdrawalCap(address who,address asset) public view returns(uint256) {
        Account storage a=accounts[who][asset];
        return Math.mulDiv(a.externalDeposited+a.reinvested,PROFIT_WITHDRAWAL_CAP_BPS,BPS);
    }

    function requestWithdrawal(address asset,uint256 amount,bool principal,uint256 positionId)
        external nonReentrant {
        _asset(asset);
        Account storage a=accounts[msg.sender][asset];
        if (!users[msg.sender].registered || amount==0 || a.requestPending ||
            block.timestamp<a.nextRequestAt) revert Locked();
        uint256 fee;
        if (principal) {
            Position storage p=positions[msg.sender][positionId];
            if (p.asset!=asset || p.openedAt+PRINCIPAL_LOCK>block.timestamp ||
                amount>p.principal-p.reserved) revert Insufficient();
            p.reserved+=amount;
            fee=Math.mulDiv(amount,PRINCIPAL_PENALTY_BPS,BPS);
        } else {
            if (a.profit<amount || amount>profitWithdrawalCap(msg.sender,asset)) revert Insufficient();
            a.profit-=amount; // liability remains until paid, cancelled or rejected
            fee=Math.mulDiv(amount,PROFIT_FEE_BPS,BPS);
        }
        a.requestPending=true;
        a.nextRequestAt=uint64(block.timestamp+WITHDRAWAL_COOLDOWN);
        uint256 id=withdrawals.length;
        withdrawals.push(Withdrawal(msg.sender,asset,amount,fee,positionId,uint64(block.timestamp),0,principal));
        userWithdrawalIds[msg.sender].push(id);
        emit WithdrawalRequested(id,msg.sender,asset,principal,amount,fee);
    }

    function approveWithdrawal(uint256 id) external onlyRole(WITHDRAWAL_APPROVER_ROLE) {
        Withdrawal storage r=withdrawals[id];
        if (r.status!=0) revert WrongState();
        r.status=1;
        emit WithdrawalApproved(id,msg.sender);
    }
    function _release(Withdrawal storage r) private {
        if (r.principal) positions[r.user][r.positionId].reserved-=r.gross;
        else accounts[r.user][r.asset].profit+=r.gross;
        accounts[r.user][r.asset].requestPending=false;
    }
    function rejectWithdrawal(uint256 id,bytes32 reason) external onlyRole(WITHDRAWAL_APPROVER_ROLE) {
        if (reason==bytes32(0)) revert Invalid();
        Withdrawal storage r=withdrawals[id];
        if (r.status!=0 && r.status!=1) revert WrongState();
        r.status=4;
        _release(r);
        emit WithdrawalResolved(id,4,reason);
    }
    function cancelWithdrawal(uint256 id) external {
        Withdrawal storage r=withdrawals[id];
        if (msg.sender!=r.user || (r.status!=0 && r.status!=1) ||
            block.timestamp<uint256(r.requestedAt)+72 hours) revert Forbidden();
        r.status=3;
        _release(r);
        emit WithdrawalResolved(id,3,bytes32(0));
    }

    /// @notice Any caller may execute an ALREADY approved, funded request.
    ///         Never pays the executor; the beneficiary is immutable.
    function payWithdrawal(uint256 id) external nonReentrant {
        Withdrawal storage r=withdrawals[id];
        if (r.status!=1) revert WrongState();
        if (r.principal) {
            if (availablePrincipalCash(r.asset)<r.gross) revert InsufficientCash();
        } else if (assetBalance(r.asset)<profitLiability[r.asset]) revert InsufficientCash();
        r.status=2;
        Account storage a=accounts[r.user][r.asset];
        a.requestPending=false;
        if (r.principal) {
            Position storage p=positions[r.user][r.positionId];
            uint256 usd=r.gross==p.principal?p.capitalUsd:Math.mulDiv(p.capitalUsd,r.gross,p.principal);
            p.reserved-=r.gross;
            p.principal-=r.gross;
            p.capitalUsd-=usd;
            a.principal-=r.gross;
            users[r.user].capitalUsd-=usd;
            principalLiability[r.asset]-=r.gross;
        } else {
            profitLiability[r.asset]-=r.gross;
        }
        _pay(r.asset,WITHDRAWAL_FEE_WALLET,r.fee);
        _pay(r.asset,r.user,r.gross-r.fee);
        emit WithdrawalResolved(id,2,bytes32(0));
    }
}
