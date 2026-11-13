// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {V3NetworkPlan} from "./V3NetworkPlan.sol";

/// @notice ISOLATED BNB TESTNET prototype; NOT DEPLOYED OR APPROVED FOR PRODUCTION.
/// @dev Accrual is a CONTRACTUAL TEST LIABILITY, not proof of business income,
/// backed USDT, available vault liquidity, insured principal or a guaranteed return.
/// An independently verified revenue source and financial/legal audits are mandatory
/// before any consideration of a real-money deployment.
contract GlobalV3DeferredTestnet is AccessControl, ReentrancyGuard, V3NetworkPlan {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant ONE_DAY = 1 days;
    uint256 public constant PRINCIPAL_LOCK = 90 days;
    uint256 public constant WITHDRAWAL_COOLDOWN = 72 hours;
    uint256 public constant PROFIT_FEE_BPS = 300;
    uint256 public constant PRINCIPAL_PENALTY_BPS = 3000;
    uint256 public constant PROFIT_WITHDRAWAL_CAP_BPS = 1000;
    uint256 public constant MIN_TEST_DEPOSIT = 10 ether;
    uint256 public constant DEPOSIT_FEE_EACH_BPS = 1000;
    // Preserve the existing V2 destinations. The remainder goes to operations.
    address public constant FEE_WALLET_1 = address(bytes20(hex"7037cc199499d7a3431285a01e435454eae51265"));
    address public constant FEE_WALLET_2 = address(bytes20(hex"5bc282a45a8a1d7d9b915f04fc1d4031156d7632"));
    address public constant OPERATIONS_WALLET = address(bytes20(hex"8c4ac9b009808a0b49ba77b58e3871e7cdba463c"));
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IERC20 public immutable asset;
    address public immutable feeReceiver;
    bool public paused;
    uint256 public principalLiability;
    uint256 public profitLiability;
    uint256 public reservedForPayout;
    uint256 public principalEscrowed; // principal obligation already earmarked for payout

    struct User {
        address referrer;
        bool registered;
        bool suspended;
        bool vipKyc;
        uint64 lastCheckIn;
        uint64 nextRequestAt;
        bool pendingRequest;
        uint256 capital;
        uint256 originalDeposits;
        uint256 reinvestments;
        uint256 referralAvailable;
        uint256 referralReserved;
        uint256 cumulativeReferral;
    }
    struct Position {
        uint256 principal;
        uint256 compoundedBasis; // outstanding position profits currently eligible for compounding
        uint256 availableProfit; // accrued claim, DOES NOT imply cash backing
        uint256 reservedProfit;
        uint256 reservedPrincipal;
        uint256 cumulativeDaily;
        uint256 cumulativeCompound;
        uint64 openedAt;
        uint64 lastAccruedAt;
        bool fromReinvestment;
    }
    // status: 0 Requested, 1 Approved, 2 CashEscrowed, 3 Paid, 4 Rejected, 5 Cancelled
    // kind: 0 position-profit, 1 principal, 2 referral-profit, 3 network reward
    struct Withdrawal {
        address beneficiary;
        uint256 positionId;
        uint256 gross;
        uint256 fee;
        uint64 requestedAt;
        uint8 status;
        uint8 kind;
    }

    mapping(address => User) public users;
    address[] private members; // enumerable on-chain index for a permissionless testnet accrual keeper
    mapping(address => Position[]) private positions;
    // Exact outstanding claim split: dashboard must not reconstruct this split
    // from cumulative totals after withdrawals/reinvestment.
    mapping(address => mapping(uint256 => uint256)) public claimableDaily;
    mapping(address => mapping(uint256 => uint256)) public claimableCompound;
    mapping(address => uint256) public networkAvailable;
    mapping(address => uint256) public networkReserved;
    mapping(address => uint256) public cumulativeNetwork;
    // Incremental bounded sums avoid looping over all direct branches during accrual.
    mapping(address => mapping(uint8 => uint256)) public qualifiedVolume;
    mapping(uint256 => uint256) public reservedDailyByRequest;
    mapping(uint256 => uint256) public reservedCompoundByRequest;
    Withdrawal[] private withdrawals;
    mapping(address => uint256[]) private userWithdrawalIds;

    event DepositRouted(address indexed user,uint256 indexed positionId,uint256 amount,uint256 fee1,uint256 fee2,uint256 operations);
    event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at);
    event ProfitClaimSplitReserved(uint256 indexed requestId,uint256 personal,uint256 compounded);
    event ProfitClaimSplitPaid(uint256 indexed requestId,uint256 personal,uint256 compounded);
    event ReferralClaimAccrued(address indexed upline,address indexed source,uint8 level,uint256 amount);
    event NetworkClaimAccrued(address indexed user,uint256 indexed group,uint256 amount,uint8 stages);
    event ProfitReinvested(address indexed user,uint256 indexed fromPosition,uint256 newPositionId,uint256 amount);
    event WithdrawalRequested(uint256 indexed id,address indexed user,uint8 kind,uint256 gross,uint256 fee);
    event WithdrawalApproved(uint256 indexed id,address indexed manager);
    event WithdrawalEscrowFunded(uint256 indexed id,address indexed funder,uint256 gross);
    event WithdrawalExistingCashReserved(uint256 indexed id,uint256 gross);
    event WithdrawalPaid(uint256 indexed id,address indexed beneficiary,uint256 net,uint256 fee);
    event WithdrawalReleased(uint256 indexed id,uint8 status);
    event CheckIn(address indexed user,uint256 at);
    event StatusChanged(address indexed user,bool suspended);
    event VaultPaused(bool paused);

    error WrongChain();
    error Invalid();
    error NotEligible();
    error WrongState();
    error Locked();
    error Insufficient();
    error FundingRequired();
    error ContractPaused();

    modifier active() {
        if(paused) revert ContractPaused();
        _;
    }

    constructor(address manager,address token,address fees) {
        if(block.chainid!=97) revert WrongChain();
        if(manager==address(0)||fees==address(0)||token.code.length==0||
           IERC20Metadata(token).decimals()!=18) revert Invalid();
        asset=IERC20(token);
        feeReceiver=fees;
        _grantRole(DEFAULT_ADMIN_ROLE,manager);
        _grantRole(MANAGER_ROLE,manager);
        _grantRole(FUNDER_ROLE,manager);
        _grantRole(GUARDIAN_ROLE,manager);
    }

    function setPaused(bool value) external onlyRole(GUARDIAN_ROLE) {
        paused=value;
        emit VaultPaused(value);
    }
    function setSuspended(address who,bool value) external onlyRole(GUARDIAN_ROLE) {
        if(!users[who].registered)revert Invalid();
        users[who].suspended=value;
        emit StatusChanged(who,value);
    }
    function setVipKyc(address who,bool value) external onlyRole(MANAGER_ROLE) {
        if(!users[who].registered)revert Invalid();
        users[who].vipKyc=value;
    }

    function memberCount() external view returns(uint256) {return members.length;}
    function memberAt(uint256 index) external view returns(address) {return members[index];}
    function positionCount(address who) external view returns(uint256) {return positions[who].length;}
    function positionOf(address who,uint256 id) external view returns(Position memory) {return positions[who][id];}
    function withdrawalCount() external view returns(uint256) {return withdrawals.length;}
    function withdrawalOf(uint256 id) external view returns(Withdrawal memory) {return withdrawals[id];}
    function userWithdrawalCount(address who) external view returns(uint256) {return userWithdrawalIds[who].length;}
    function userWithdrawalId(address who,uint256 i) external view returns(uint256) {return userWithdrawalIds[who][i];}

    function register(address referrer) external active {
        _register(msg.sender,referrer);
    }
    function _register(address who,address referrer) internal {
        if(users[who].registered||who==referrer||
           (referrer!=address(0)&&!users[referrer].registered))revert Invalid();
        users[who].registered=true;
        users[who].referrer=referrer;
        members.push(who);
    }
    function checkIn() external active {
        _checkIn(msg.sender);
    }
    /// @notice One signed activity transaction can also record every mature
    /// position in this explicitly bounded list; no privileged daily signer.
    function checkInAndAccrue(uint256[] calldata positionIds) external nonReentrant active {
        if(positionIds.length>20)revert Invalid();
        _checkIn(msg.sender);
        for(uint256 i=0;i<positionIds.length;i++){
            _accrueDaily(msg.sender,positionIds[i]);
        }
    }
    function _checkIn(address who) private {
        User storage u=users[who];
        if(!u.registered||u.suspended)revert NotEligible();
        if(u.lastCheckIn!=0&&block.timestamp<uint256(u.lastCheckIn)+1 hours)revert Locked();
        u.lastCheckIn=uint64(block.timestamp);
        emit CheckIn(who,block.timestamp);
    }
    function isEligible(address who) public view returns(bool) {
        User storage u=users[who];
        return u.registered&&!u.suspended&&u.capital>=MIN_TEST_DEPOSIT&&
               (u.capital<=50_000 ether||u.vipKyc)&&
               u.lastCheckIn!=0&&block.timestamp>=u.lastCheckIn&&
               block.timestamp-u.lastCheckIn<ONE_DAY;
    }

    function tierOf(address who) public view returns(uint8) {
        uint256 c=users[who].capital;
        if(c>50_000 ether)return 4;
        if(c>10_000 ether)return 3;
        if(c>2_500 ether)return 2;
        if(c>500 ether)return 1;
        return 0;
    }
    function dailyBps(uint8 tier) public pure returns(uint16) {
        if(tier==0)return 50;
        if(tier==1)return 70;
        if(tier==2)return 90;
        if(tier==3)return 110;
        if(tier==4)return 130;
        revert Invalid();
    }
    /// @notice Test-token values simulate USD 1:1; no real market price is asserted.
    function upgradeTerms(uint8 tier) public pure returns(uint256 target,uint256 directs,uint16 maximumBps) {
        if(tier==0)return (2_500 ether,4,100);
        if(tier==1)return (10_000 ether,6,120);
        if(tier==2)return (50_000 ether,8,150);
        if(tier==3)return (250_000 ether,10,180);
        if(tier==4)return (1_000_000 ether,12,200);
        revert Invalid();
    }
    function effectiveDailyBps(address who) public view returns(uint16) {
        uint8 tier=tierOf(who);
        (uint256 target,uint256 directs,uint16 maximum)=upgradeTerms(tier);
        if(qualifiedDirects[who]>=directs&&qualifiedVolume[who][tier]>=target)return maximum;
        return dailyBps(tier);
    }
    function _networkParent(address who) internal view override returns(address) {
        return users[who].referrer;
    }
    function _onBranchVolume(address who,uint256 beforeVolume,uint256 afterVolume) internal override {
        for(uint8 tier=0;tier<5;tier++){
            (uint256 target,,)=upgradeTerms(tier);
            uint256 cap=Math.mulDiv(target,branchCapBps(target),BPS);
            qualifiedVolume[who][tier]+=Math.min(afterVolume,cap)-Math.min(beforeVolume,cap);
        }
    }
    function referralBps(uint8 tier,uint8 level) public pure returns(uint16) {
        if(tier>4||level>3)revert Invalid();
        if(level==0)return [uint16(800),1000,1200,1400,1600][tier];
        if(level==1)return [uint16(400),500,600,700,800][tier];
        if(level==2)return [uint16(200),300,400,500,600][tier];
        return tier==4?400:0;
    }

    /// @notice Routes each TEST deposit to the original two 10% fee wallets and
    /// the original operations wallet. Gross principal is an unfunded claim,
    /// not cash retained by this vault. Any integer rounding goes to operations.
    function deposit(uint256 amount,address referrer) external nonReentrant active {
        if(amount<MIN_TEST_DEPOSIT)revert Insufficient();
        User storage u=users[msg.sender];
        if(!u.registered)_register(msg.sender,referrer);
        else if(u.referrer!=referrer)revert Invalid();
        if(u.suspended||(u.capital+amount>50_000 ether&&!u.vipKyc))revert NotEligible();
        _receiveExact(amount);
        _capitalChanged(msg.sender,u.capital,u.capital+amount);
        u.capital+=amount;
        u.originalDeposits+=amount;
        principalLiability+=amount;
        uint256 id=positions[msg.sender].length;
        positions[msg.sender].push(Position(amount,0,0,0,0,0,0,
            uint64(block.timestamp),uint64(block.timestamp),false));
        _addNetworkVolume(msg.sender,amount);
        uint256 fee=Math.mulDiv(amount,DEPOSIT_FEE_EACH_BPS,BPS);
        uint256 operations=amount-2*fee;
        asset.safeTransfer(FEE_WALLET_1,fee);
        asset.safeTransfer(FEE_WALLET_2,fee);
        asset.safeTransfer(OPERATIONS_WALLET,operations);
        emit DepositRouted(msg.sender,id,amount,fee,fee,operations);
    }

    function _receiveExact(uint256 amount) private {
        if(amount==0)revert Invalid();
        uint256 beforeBalance=asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender,address(this),amount);
        if(asset.balanceOf(address(this))-beforeBalance!=amount)revert Invalid();
    }

    /// @notice Accrues exactly ONE daily period on each qualifying call, never
    /// silently catches up after inactivity. A user signs check-in periodically;
    /// anyone may call this transaction when check-in and 24-hour interval pass.
    /// The resulting on-chain claim is recorded EVEN IF cash has not been funded.
    // Permissionless: neither the wallet operator nor MANAGER_ROLE approves
    // compounding. A gas-funded keeper or user may trigger this on schedule.
    // Existing daily-activity and 24-hour interval rules remain enforced.
    function accrueDaily(address who,uint256 positionId) external nonReentrant active {
        _accrueDaily(who,positionId);
    }
    function _accrueDaily(address who,uint256 positionId) private {
        if(!isEligible(who))revert NotEligible();
        Position storage p=positions[who][positionId];
        if(p.principal==0||block.timestamp<uint256(p.lastAccruedAt)+ONE_DAY)revert Locked();
        uint256 bps=effectiveDailyBps(who);
        uint256 personal=Math.mulDiv(p.principal,bps,BPS);
        uint256 compound=Math.mulDiv(p.compoundedBasis,bps,BPS);
        uint256 gross=personal+compound;
        if(gross==0)revert Insufficient();
        p.lastAccruedAt=uint64(block.timestamp);
        p.availableProfit+=gross;
        p.compoundedBasis+=gross;
        claimableDaily[who][positionId]+=personal;
        claimableCompound[who][positionId]+=compound;
        p.cumulativeDaily+=personal;
        p.cumulativeCompound+=compound;
        profitLiability+=gross;
        _creditReferrals(who,gross);
        emit DailyClaimAccrued(who,positionId,personal,compound,gross,block.timestamp);
    }

    function _creditReferrals(address who,uint256 gross) private {
        address parent=users[who].referrer;
        uint8 sourceTier=tierOf(who);
        for(uint8 i=0;i<4&&parent!=address(0);i++){
            uint256 amount=Math.mulDiv(gross,referralBps(sourceTier,i),BPS);
            User storage u=users[parent];
            if(amount>0&&isEligible(parent)&&(i!=3||tierOf(parent)==4)){
                u.referralAvailable+=amount;
                u.cumulativeReferral+=amount;
                profitLiability+=amount;
                emit ReferralClaimAccrued(parent,who,i+1,amount);
            }
            parent=u.referrer;
        }
    }

    function profitWithdrawalCap(address who) public view returns(uint256) {
        User storage u=users[who];
        return Math.mulDiv(u.originalDeposits+u.reinvestments,PROFIT_WITHDRAWAL_CAP_BPS,BPS);
    }

    /// @notice User-initiated reinvestment of an ACTUALLY recorded TEST claim,
    /// not a fake fund transfer; principal cash coverage is rechecked separately.
    function reinvest(uint256 positionId,uint256 amount) external nonReentrant active {
        User storage u=users[msg.sender];
        if(u.suspended||amount==0)revert NotEligible();
        Position storage p=positions[msg.sender][positionId];
        if(amount>p.availableProfit||amount>p.compoundedBasis)revert Insufficient();
        if(u.capital+amount>50_000 ether&&!u.vipKyc)revert NotEligible();
        p.availableProfit-=amount;
        p.compoundedBasis-=amount;
        uint256 personalUsed=Math.min(amount,claimableDaily[msg.sender][positionId]);
        claimableDaily[msg.sender][positionId]-=personalUsed;
        claimableCompound[msg.sender][positionId]-=(amount-personalUsed);
        profitLiability-=amount;
        principalLiability+=amount;
        _capitalChanged(msg.sender,u.capital,u.capital+amount);
        u.capital+=amount;
        u.reinvestments+=amount;
        uint256 id=positions[msg.sender].length;
        positions[msg.sender].push(Position(amount,0,0,0,0,0,0,
            uint64(block.timestamp),uint64(block.timestamp),true));
        _addNetworkVolume(msg.sender,amount);
        emit ProfitReinvested(msg.sender,positionId,id,amount);
    }

    /// @notice Prepare or claim the original 14 staged network rewards as
    /// unfunded MOCK-token liabilities. No cash or real USD is invented.
    function prepareNetworkReward(uint256 group,uint8 expectedStage,uint256 steps) external nonReentrant active {
        _checkRewardStage(msg.sender,group,expectedStage);
        _prepareReward(msg.sender,group,steps);
    }
    function claimNetworkRewards(uint256 group,uint8 expectedStage,uint8 count) external nonReentrant active {
        if(!isEligible(msg.sender)||count==0||uint256(expectedStage)+count>14)revert NotEligible();
        _checkRewardStage(msg.sender,group,expectedStage);
        uint256 total;
        for(uint256 i=0;i<count;i++)total+=_consumeReward(msg.sender,group);
        networkAvailable[msg.sender]+=total;
        cumulativeNetwork[msg.sender]+=total;
        profitLiability+=total;
        emit NetworkClaimAccrued(msg.sender,group,total,count);
    }

    function _beginRequest(address who) private {
        User storage u=users[who];
        if(!u.registered||u.suspended||u.pendingRequest||block.timestamp<u.nextRequestAt)
            revert Locked();
        u.pendingRequest=true;
        u.nextRequestAt=uint64(block.timestamp+WITHDRAWAL_COOLDOWN);
    }

    function requestProfit(uint256 positionId,uint256 amount) external nonReentrant active returns(uint256 id) {
        if(amount==0||amount>profitWithdrawalCap(msg.sender))revert Insufficient();
        Position storage p=positions[msg.sender][positionId];
        if(amount>p.availableProfit||amount>p.compoundedBasis)revert Insufficient();
        _beginRequest(msg.sender);
        p.availableProfit-=amount;
        p.compoundedBasis-=amount; // pending profit MUST NOT continue compounding
        uint256 personalPart=Math.min(amount,claimableDaily[msg.sender][positionId]);
        uint256 compoundPart=amount-personalPart;
        claimableDaily[msg.sender][positionId]-=personalPart;
        claimableCompound[msg.sender][positionId]-=compoundPart;
        p.reservedProfit+=amount;
        id=_addWithdrawal(msg.sender,positionId,amount,0,0);
        reservedDailyByRequest[id]=personalPart;
        reservedCompoundByRequest[id]=compoundPart;
        emit ProfitClaimSplitReserved(id,personalPart,compoundPart);
    }
    function requestReferral(uint256 amount) external nonReentrant active returns(uint256 id) {
        User storage u=users[msg.sender];
        if(amount==0||amount>u.referralAvailable||amount>profitWithdrawalCap(msg.sender))revert Insufficient();
        _beginRequest(msg.sender);
        u.referralAvailable-=amount;
        u.referralReserved+=amount;
        id=_addWithdrawal(msg.sender,0,amount,0,2);
    }
    function requestNetworkReward(uint256 amount) external nonReentrant active returns(uint256 id) {
        if(amount==0||amount>networkAvailable[msg.sender]||amount>profitWithdrawalCap(msg.sender))revert Insufficient();
        _beginRequest(msg.sender);
        networkAvailable[msg.sender]-=amount;
        networkReserved[msg.sender]+=amount;
        id=_addWithdrawal(msg.sender,0,amount,0,3);
    }
    function requestPrincipal(uint256 positionId,uint256 amount) external nonReentrant active returns(uint256 id) {
        Position storage p=positions[msg.sender][positionId];
        if(amount==0||block.timestamp<uint256(p.openedAt)+PRINCIPAL_LOCK||
           amount>p.principal-p.reservedPrincipal)revert Insufficient();
        _beginRequest(msg.sender);
        p.reservedPrincipal+=amount;
        id=_addWithdrawal(msg.sender,positionId,amount,PRINCIPAL_PENALTY_BPS,1);
    }
    function _addWithdrawal(address who,uint256 positionId,uint256 amount,uint256 feeBps,uint8 kind)
        private returns(uint256 id) {
        id=withdrawals.length;
        uint256 fee=Math.mulDiv(amount,kind==1?feeBps:PROFIT_FEE_BPS,BPS);
        if(fee>=amount)revert Insufficient();
        withdrawals.push(Withdrawal(who,positionId,amount,fee,uint64(block.timestamp),0,kind));
        userWithdrawalIds[who].push(id);
        emit WithdrawalRequested(id,who,kind,amount,fee);
    }

    function approveWithdrawal(uint256 id) external onlyRole(MANAGER_ROLE) {
        Withdrawal storage r=withdrawals[id];
        if(r.status!=0)revert WrongState();
        r.status=1;
        emit WithdrawalApproved(id,msg.sender);
    }

    /// @notice Exact per-request cash funding; no one-million up-front top-up.
    /// Funds are escrowed FOR THIS REQUEST and cannot pay another user.
    function fundWithdrawal(uint256 id) external nonReentrant onlyRole(FUNDER_ROLE) {
        Withdrawal storage r=withdrawals[id];
        if(r.status!=1)revert WrongState();
        _receiveExact(r.gross);
        _escrow(r);
        emit WithdrawalEscrowFunded(id,msg.sender,r.gross);
    }

    /// @notice If the test vault ALREADY has enough free, unescrowed cash,
    /// manager may reserve that cash at withdrawal time, without an
    /// unnecessary new transfer. For profit, ring-fence remaining principal.
    function reserveExistingCash(uint256 id) external nonReentrant onlyRole(MANAGER_ROLE) {
        Withdrawal storage r=withdrawals[id];
        if(r.status!=1)revert WrongState();
        uint256 cash=asset.balanceOf(address(this));
        if(cash<reservedForPayout)revert FundingRequired();
        uint256 freeCash=cash-reservedForPayout;
        if(freeCash<r.gross)revert FundingRequired();
        if(r.kind!=1){
            if(principalLiability<principalEscrowed)revert FundingRequired();
            uint256 outstandingPrincipal=principalLiability-principalEscrowed;
            if(freeCash<outstandingPrincipal||
               freeCash-outstandingPrincipal<r.gross)revert FundingRequired();
        }
        _escrow(r);
        emit WithdrawalExistingCashReserved(id,r.gross);
    }
    function _escrow(Withdrawal storage r) private {
        r.status=2;
        reservedForPayout+=r.gross;
        if(r.kind==1)principalEscrowed+=r.gross;
    }

    /// @notice Only an escrow-funded and approved request pays. No implicit
    /// wallet credit, no owner redirection, no replay and no source of invented cash.
    function payWithdrawal(uint256 id) external nonReentrant {
        Withdrawal storage r=withdrawals[id];
        if(r.status!=2)revert FundingRequired();
        r.status=3;
        reservedForPayout-=r.gross;
        if(r.kind==1)principalEscrowed-=r.gross;
        User storage u=users[r.beneficiary];
        u.pendingRequest=false;
        if(r.kind==1){
            Position storage p=positions[r.beneficiary][r.positionId];
            p.reservedPrincipal-=r.gross;
            p.principal-=r.gross;
            _capitalChanged(r.beneficiary,u.capital,u.capital-r.gross);
            u.capital-=r.gross;
            principalLiability-=r.gross;
        }else if(r.kind==0){
            Position storage p=positions[r.beneficiary][r.positionId];
            p.reservedProfit-=r.gross;
            profitLiability-=r.gross;
            emit ProfitClaimSplitPaid(id,reservedDailyByRequest[id],reservedCompoundByRequest[id]);
            delete reservedDailyByRequest[id];
            delete reservedCompoundByRequest[id];
        }else if(r.kind==2){
            u.referralReserved-=r.gross;
            profitLiability-=r.gross;
        }else{
            networkReserved[r.beneficiary]-=r.gross;
            profitLiability-=r.gross;
        }
        asset.safeTransfer(feeReceiver,r.fee);
        asset.safeTransfer(r.beneficiary,r.gross-r.fee);
        emit WithdrawalPaid(id,r.beneficiary,r.gross-r.fee,r.fee);
    }

    function rejectWithdrawal(uint256 id) external onlyRole(MANAGER_ROLE) {
        Withdrawal storage r=withdrawals[id];
        if(r.status!=0&&r.status!=1)revert WrongState();
        r.status=4;
        _release(id,r);
        emit WithdrawalReleased(id,4);
    }
    function cancelWithdrawal(uint256 id) external {
        Withdrawal storage r=withdrawals[id];
        if(msg.sender!=r.beneficiary||(r.status!=0&&r.status!=1)||
           block.timestamp<uint256(r.requestedAt)+WITHDRAWAL_COOLDOWN)revert Locked();
        r.status=5;
        _release(id,r);
        emit WithdrawalReleased(id,5);
    }
    function _release(uint256 id,Withdrawal storage r) private {
        User storage u=users[r.beneficiary];
        u.pendingRequest=false;
        if(r.kind==1){
            positions[r.beneficiary][r.positionId].reservedPrincipal-=r.gross;
        }else if(r.kind==0){
            Position storage p=positions[r.beneficiary][r.positionId];
            p.reservedProfit-=r.gross;
            p.availableProfit+=r.gross;
            p.compoundedBasis+=r.gross;
            claimableDaily[r.beneficiary][r.positionId]+=reservedDailyByRequest[id];
            claimableCompound[r.beneficiary][r.positionId]+=reservedCompoundByRequest[id];
            delete reservedDailyByRequest[id];
            delete reservedCompoundByRequest[id];
        }else if(r.kind==2){
            u.referralReserved-=r.gross;
            u.referralAvailable+=r.gross;
        }else{
            networkReserved[r.beneficiary]-=r.gross;
            networkAvailable[r.beneficiary]+=r.gross;
        }
    }

    function cashStatus() external view returns(uint256 cash,uint256 principal,uint256 accruedProfit,
        uint256 escrowedCash,uint256 totalCashShortfall) {
        cash=asset.balanceOf(address(this));
        principal=principalLiability;
        accruedProfit=profitLiability;
        escrowedCash=reservedForPayout;
        uint256 liabilities=principal+accruedProfit;
        totalCashShortfall=liabilities>cash?liabilities-cash:0;
    }
}
