// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IDailyTerms {
    function nextAccrual(address user,uint256 last) external view returns(uint256 due,uint16 bps,uint8 tier);
}

/// @notice One position with independently locked additions on BNB Testnet.
contract DailyCapitalBook {
    uint256 public constant PERIOD = 1 days;
    uint256 public constant PRINCIPAL_LOCK = 90 days;
    uint256 public constant PAGE_LIMIT = 64;
    uint256 private constant BPS = 10_000;
    address public immutable vault;

    struct Lot {
        uint256 principal;
        uint256 reservedPrincipal;
        uint256 daily;
        uint256 compound;
        uint256 basis;
        uint256 reservedProfit;
        uint64 openedAt;
        uint64 lastAccruedAt;
    }
    struct Position {
        uint256 principal;
        uint256 reservedPrincipal;
        uint256 daily;
        uint256 compound;
        uint256 basis;
        uint256 reservedProfit;
        uint256 cumulativeDaily;
        uint256 cumulativeCompound;
        Lot[] lots;
    }
    struct Reservation {
        address user;
        uint256 amount;
        uint8 status; // 0 unused, 1 reserved, 2 settled, 3 released
        uint8 kind; // 1 principal, 2 profit
        uint256[] lotIds;
        uint256[] amounts;
        bool[] compoundParts;
    }
    mapping(address => Position) private positions;
    mapping(uint256 => Reservation) private reservations;

    error WrongChain(); error Unauthorized(); error Invalid();
    error Insufficient(); error WrongState();

    event CapitalAdditionRecorded(address indexed user,uint256 indexed lot,uint256 amount,uint256 at);
    event LotAccrued(address indexed user,uint256 indexed lot,uint256 daily,uint256 compound,uint256 at);
    event PrincipalReserved(uint256 indexed requestId,address indexed user,uint256 amount);
    event PrincipalSettled(uint256 indexed requestId,address indexed user,uint256 amount);
    event PrincipalReleased(uint256 indexed requestId,address indexed user,uint256 amount);
    event ProfitReserved(uint256 indexed requestId,address indexed user,uint256 amount);
    event ProfitSettled(uint256 indexed requestId,address indexed user,uint256 amount);
    event ProfitReleased(uint256 indexed requestId,address indexed user,uint256 amount);

    modifier onlyVault() { if(msg.sender!=vault)revert Unauthorized(); _; }

    constructor(address vault_) {
        if(block.chainid!=97)revert WrongChain();
        if(vault_==address(0))revert Invalid();
        vault=vault_;
    }

    /// @notice At most one logical reinvestment position exists per wallet.
    function positionCount(address user) external view returns(uint256) {
        return positions[user].lots.length==0?0:1;
    }
    function position(address user) external view returns(uint256 principal,uint256 reservedPrincipal,
        uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint256 cumulativeDaily,uint256 cumulativeCompound,uint256 lots) {
        Position storage p=positions[user];
        return(p.principal,p.reservedPrincipal,p.daily,p.compound,p.basis,p.reservedProfit,p.cumulativeDaily,p.cumulativeCompound,p.lots.length);
    }
    function lot(address user,uint256 id) external view returns(Lot memory) {return positions[user].lots[id];}
    function reservation(uint256 requestId) external view returns(address user,uint256 amount,uint8 status,uint8 kind,uint256 parts) {
        Reservation storage r=reservations[requestId];return(r.user,r.amount,r.status,r.kind,r.lotIds.length);
    }

    function _end(uint256 count,uint256 start,uint256 limit) private pure returns(uint256) {
        if(start>count||limit==0||limit>PAGE_LIMIT)revert Invalid();
        return start+Math.min(limit,count-start);
    }
    function _record(address user,uint256 amount) private returns(uint256 id) {
        if(user==address(0)||amount==0||block.timestamp>type(uint64).max)revert Invalid();
        Position storage p=positions[user];id=p.lots.length;
        p.principal+=amount;
        p.lots.push(Lot(amount,0,0,0,0,0,uint64(block.timestamp),uint64(block.timestamp)));
        emit CapitalAdditionRecorded(user,id,amount,block.timestamp);
    }
    /// @dev Parent must atomically receive a test deposit or debit a verified claim.
    function record(address user,uint256 amount) external onlyVault returns(uint256 lotId) {
        return _record(user,amount);
    }

    struct EarnedDay {
        uint256 base;
        uint256 due;
        uint8 tier;
    }

    /// @notice Settle one eligible day per lot. Repeated calls advance arrears one
    /// day at a time using the rate recorded at maturity. Unchecked days are skipped.
    function accruePage(address user,uint256 start,uint256 limit)
        external onlyVault returns(uint256 daily,uint256 compound,EarnedDay[] memory daysEarned) {
        Position storage p=positions[user];
        uint256 end=_end(p.lots.length,start,limit);
        daysEarned=new EarnedDay[](end-start);
        for(uint256 i=start;i<end;i++) {
            Lot storage l=p.lots[i];
            if(l.principal==0 || block.timestamp<uint256(l.lastAccruedAt)+PERIOD) continue;
            (uint256 due,uint16 bps,uint8 tier)=IDailyTerms(vault).nextAccrual(user,l.lastAccruedAt);
            if(bps==0) continue;
            uint256 d=Math.mulDiv(l.principal,bps,BPS);
            uint256 c=Math.mulDiv(l.basis,bps,BPS);
            l.lastAccruedAt=uint64(due);
            l.daily+=d;
            l.compound+=c;
            l.basis+=d+c;
            daily+=d;
            compound+=c;
            daysEarned[i-start]=EarnedDay(d,due,tier);
            emit LotAccrued(user,i,d,c,due);
        }
        p.daily+=daily;
        p.compound+=compound;
        p.basis+=daily+compound;
        p.cumulativeDaily+=daily;
        p.cumulativeCompound+=compound;
    }

    /// @notice Move recorded group profit to another lot in the SAME position.
    /// @dev A parent must atomically update global profit/principal liabilities.
    /// Only the selected bounded page is used; insufficient page profit reverts.
    function reinvestProfitPage(address user,uint256 amount,uint256 start,uint256 limit)
        external onlyVault returns(uint256 lotId,uint256 dailyUsed,uint256 compoundUsed) {
        (dailyUsed,compoundUsed)=_consumeProfitPage(user,amount,start,limit);
        lotId=_record(user,amount);
    }
    /// @dev The vault must atomically record the combined replacement lot and
    /// update liabilities after consuming all selected source pages.
    function consumeProfitPage(address user,uint256 amount,uint256 start,uint256 limit)
        external onlyVault returns(uint256 dailyUsed,uint256 compoundUsed) {
        return _consumeProfitPage(user,amount,start,limit);
    }
    function _consumeProfitPage(address user,uint256 amount,uint256 start,uint256 limit)
        private returns(uint256 dailyUsed,uint256 compoundUsed) {
        if(amount==0)revert Invalid();
        Position storage p=positions[user];uint256 end=_end(p.lots.length,start,limit);uint256 left=amount;
        // Match V3's daily-before-compound split for the selected page.
        for(uint256 i=start;i<end&&left>0;i++) {
            Lot storage l=p.lots[i];uint256 used=Math.min(l.daily,left);
            l.daily-=used;l.basis-=used;dailyUsed+=used;left-=used;
        }
        for(uint256 i=start;i<end&&left>0;i++) {
            Lot storage l=p.lots[i];uint256 used=Math.min(l.compound,left);
            l.compound-=used;l.basis-=used;compoundUsed+=used;left-=used;
        }
        if(left!=0)revert Insufficient();
        p.daily-=dailyUsed;p.compound-=compoundUsed;p.basis-=amount;
    }

    /// @notice View matured, unreserved principal in a bounded page.
    function maturedPrincipalPage(address user,uint256 start,uint256 limit)
        external view returns(uint256 available,uint256 next) {
        Position storage p=positions[user];uint256 end=_end(p.lots.length,start,limit);
        for(next=start;next<end;next++) {
            Lot storage l=p.lots[next];
            if(block.timestamp>=uint256(l.openedAt)+PRINCIPAL_LOCK)
                available+=l.principal-l.reservedPrincipal;
        }
    }

    /// @dev Parent must enforce the 72h cooldown and one pending request.
    /// Reserve does not stop accrual, matching the current V3 principal rule.
    function reservePrincipal(address user,uint256 requestId,uint256 amount,uint256 start,uint256 limit)
        external onlyVault {
        if(user==address(0)||amount==0)revert Invalid();
        Reservation storage r=reservations[requestId];if(r.status!=0)revert WrongState();
        Position storage p=positions[user];uint256 end=_end(p.lots.length,start,limit);uint256 left=amount;
        for(uint256 i=start;i<end&&left>0;i++) {
            Lot storage l=p.lots[i];
            if(block.timestamp<uint256(l.openedAt)+PRINCIPAL_LOCK)continue;
            uint256 take=Math.min(l.principal-l.reservedPrincipal,left);
            if(take>0){l.reservedPrincipal+=take;r.lotIds.push(i);r.amounts.push(take);left-=take;}
        }
        if(left!=0)revert Insufficient();
        p.reservedPrincipal+=amount;r.user=user;r.amount=amount;r.status=1;r.kind=1;
        emit PrincipalReserved(requestId,user,amount);
    }
    /// @dev Parent must enforce approval/funding and transfer tokens separately.
    function settlePrincipal(uint256 requestId) external onlyVault {
        Reservation storage r=reservations[requestId];if(r.status!=1||r.kind!=1)revert WrongState();
        Position storage p=positions[r.user];r.status=2;
        for(uint256 i;i<r.lotIds.length;i++) {
            Lot storage l=p.lots[r.lotIds[i]];l.reservedPrincipal-=r.amounts[i];l.principal-=r.amounts[i];
        }
        p.reservedPrincipal-=r.amount;p.principal-=r.amount;
        emit PrincipalSettled(requestId,r.user,r.amount);
    }
    function releasePrincipal(uint256 requestId) external onlyVault {
        Reservation storage r=reservations[requestId];if(r.status!=1||r.kind!=1)revert WrongState();
        Position storage p=positions[r.user];r.status=3;
        for(uint256 i;i<r.lotIds.length;i++)p.lots[r.lotIds[i]].reservedPrincipal-=r.amounts[i];
        p.reservedPrincipal-=r.amount;
        emit PrincipalReleased(requestId,r.user,r.amount);
    }

    /// @dev Parent must enforce the profit cap, cooldown and pending-request rule.
    /// Reserved profit stops compounding until cancellation/rejection restores it.
    function reserveProfit(address user,uint256 requestId,uint256 amount,uint256 start,uint256 limit)
        external onlyVault returns(uint256 dailyUsed,uint256 compoundUsed) {
        if(user==address(0)||amount==0)revert Invalid();
        Reservation storage r=reservations[requestId];if(r.status!=0)revert WrongState();
        Position storage p=positions[user];uint256 end=_end(p.lots.length,start,limit);uint256 left=amount;
        for(uint256 i=start;i<end&&left>0;i++) {
            Lot storage l=p.lots[i];uint256 used=Math.min(l.daily,left);
            if(used>0){l.daily-=used;l.basis-=used;l.reservedProfit+=used;
                r.lotIds.push(i);r.amounts.push(used);r.compoundParts.push(false);dailyUsed+=used;left-=used;}
        }
        for(uint256 i=start;i<end&&left>0;i++) {
            Lot storage l=p.lots[i];uint256 used=Math.min(l.compound,left);
            if(used>0){l.compound-=used;l.basis-=used;l.reservedProfit+=used;
                r.lotIds.push(i);r.amounts.push(used);r.compoundParts.push(true);compoundUsed+=used;left-=used;}
        }
        if(left!=0)revert Insufficient();
        p.daily-=dailyUsed;p.compound-=compoundUsed;p.basis-=amount;p.reservedProfit+=amount;
        r.user=user;r.amount=amount;r.status=1;r.kind=2;
        emit ProfitReserved(requestId,user,amount);
    }
    /// @dev Parent must verify approval and funding before invoking settlement.
    function settleProfit(uint256 requestId) external onlyVault {
        Reservation storage r=reservations[requestId];if(r.status!=1||r.kind!=2)revert WrongState();
        Position storage p=positions[r.user];r.status=2;
        for(uint256 i;i<r.lotIds.length;i++)p.lots[r.lotIds[i]].reservedProfit-=r.amounts[i];
        p.reservedProfit-=r.amount;
        emit ProfitSettled(requestId,r.user,r.amount);
    }
    function releaseProfit(uint256 requestId) external onlyVault {
        Reservation storage r=reservations[requestId];if(r.status!=1||r.kind!=2)revert WrongState();
        Position storage p=positions[r.user];uint256 daily;uint256 compound;r.status=3;
        for(uint256 i;i<r.lotIds.length;i++) {
            Lot storage l=p.lots[r.lotIds[i]];uint256 amount=r.amounts[i];
            l.reservedProfit-=amount;l.basis+=amount;
            if(r.compoundParts[i]){l.compound+=amount;compound+=amount;}else{l.daily+=amount;daily+=amount;}
        }
        p.daily+=daily;p.compound+=compound;p.basis+=r.amount;p.reservedProfit-=r.amount;
        emit ProfitReleased(requestId,r.user,r.amount);
    }
}
