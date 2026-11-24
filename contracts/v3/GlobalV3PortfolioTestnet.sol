// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GlobalV3AccountReinvestTestnet} from "./GlobalV3AccountReinvestTestnet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Single-account testnet plan with atomic, itemized withdrawals.
contract GlobalV3PortfolioTestnet is GlobalV3AccountReinvestTestnet {
    using SafeERC20 for IERC20;

    struct Allocation {
        uint256 personal;
        uint256 referral;
        uint256 network;
        uint256 principal;
    }
    mapping(uint256 => Allocation) public withdrawalAllocation;
    event AccountWithdrawalAllocated(uint256 indexed id, address indexed user,
        uint256 personal, uint256 referral, uint256 network, uint256 principal);

    constructor(address manager, address token, address fees)
        GlobalV3AccountReinvestTestnet(manager, token, fees) {}

    function requestAccountWithdrawal(Allocation calldata parts, uint256 profitStart, uint256 principalStart)
        external nonReentrant active returns (uint256 id)
    {
        User storage u = users[msg.sender];
        if (!u.registered || u.suspended || u.pendingRequest || block.timestamp < u.nextRequestAt) revert Locked();
        uint256 earnings = parts.personal + parts.referral + parts.network;
        uint256 gross = earnings + parts.principal;
        if (gross == 0 || earnings > profitWithdrawalCap(msg.sender) ||
            parts.referral > u.referralAvailable || parts.network > networkAvailable[msg.sender]) revert Insufficient();

        id = withdrawals.length;
        uint256 fee = Math.mulDiv(earnings, PROFIT_FEE_BPS, BPS) + Math.mulDiv(parts.principal, PRINCIPAL_PENALTY_BPS, BPS);
        if (parts.personal != 0 || parts.principal != 0) {
            if (reinvestmentPositionPlusOne[msg.sender] != 1) revert Insufficient();
            Position storage p = positions[msg.sender][0];
            if (parts.personal != 0) {
                (uint256 daily, uint256 compound) = reinvestmentBook.reserveProfit(msg.sender, id, parts.personal, profitStart, 64);
                p.availableProfit -= parts.personal;
                p.compoundedBasis -= parts.personal;
                p.reservedProfit += parts.personal;
                claimableDaily[msg.sender][0] -= daily;
                claimableCompound[msg.sender][0] -= compound;
                reservedDailyByRequest[id] = daily;
                reservedCompoundByRequest[id] = compound;
                emit ProfitClaimSplitReserved(id, daily, compound);
            }
            if (parts.principal != 0) {
                reinvestmentBook.reservePrincipal(msg.sender, id, parts.principal, principalStart, 64);
                p.reservedPrincipal += parts.principal;
            }
        }
        u.referralAvailable -= parts.referral;
        u.referralReserved += parts.referral;
        networkAvailable[msg.sender] -= parts.network;
        networkReserved[msg.sender] += parts.network;
        u.pendingRequest = true;
        u.nextRequestAt = uint64(block.timestamp + WITHDRAWAL_COOLDOWN);
        withdrawalAllocation[id] = parts;
        withdrawals.push(Withdrawal(msg.sender, 0, gross, fee, uint64(block.timestamp), 0, 4));
        userWithdrawalIds[msg.sender].push(id);
        emit WithdrawalRequested(id, msg.sender, 4, gross, fee);
        emit AccountWithdrawalAllocated(id, msg.sender, parts.personal, parts.referral, parts.network, parts.principal);
    }

    function approveWithdrawal(uint256 id) external onlyRole(MANAGER_ROLE) {
        Withdrawal storage r = withdrawals[id];
        if (r.status != 0) revert WrongState();
        r.status = 1;
        emit WithdrawalApproved(id, msg.sender);
    }
    function fundWithdrawal(uint256 id) external nonReentrant onlyRole(FUNDER_ROLE) {
        Withdrawal storage r = withdrawals[id];
        if (r.status != 1) revert WrongState();
        _receiveExact(r.gross);
        _escrow(r, withdrawalAllocation[id].principal);
        emit WithdrawalEscrowFunded(id, msg.sender, r.gross);
    }
    function reserveExistingCash(uint256 id) external nonReentrant onlyRole(MANAGER_ROLE) {
        Withdrawal storage r = withdrawals[id];
        if (r.status != 1) revert WrongState();
        uint256 principal = withdrawalAllocation[id].principal;
        uint256 earnings = r.gross - principal;
        uint256 cash = asset.balanceOf(address(this));
        if (cash < reservedForPayout + r.gross) revert FundingRequired();
        if (earnings != 0 && cash - reservedForPayout < principalLiability - principalEscrowed + earnings) revert FundingRequired();
        _escrow(r, principal);
        emit WithdrawalExistingCashReserved(id, r.gross);
    }
    function _escrow(Withdrawal storage r, uint256 principal) private {
        r.status = 2;
        reservedForPayout += r.gross;
        principalEscrowed += principal;
    }
    function payWithdrawal(uint256 id) external nonReentrant {
        Withdrawal storage r = withdrawals[id];
        if (r.status != 2) revert FundingRequired();
        r.status = 3;
        reservedForPayout -= r.gross;
        principalEscrowed -= withdrawalAllocation[id].principal;
        _close(id, r, true);
        asset.safeTransfer(feeReceiver, r.fee);
        asset.safeTransfer(r.beneficiary, r.gross - r.fee);
        emit WithdrawalPaid(id, r.beneficiary, r.gross - r.fee, r.fee);
    }
    function rejectWithdrawal(uint256 id) external onlyRole(MANAGER_ROLE) {
        Withdrawal storage r = withdrawals[id];
        if (r.status > 1) revert WrongState();
        r.status = 4;
        _close(id, r, false);
        emit WithdrawalReleased(id, 4);
    }
    function cancelWithdrawal(uint256 id) external {
        Withdrawal storage r = withdrawals[id];
        if (msg.sender != r.beneficiary || r.status > 1 || block.timestamp < uint256(r.requestedAt) + WITHDRAWAL_COOLDOWN) revert Locked();
        r.status = 5;
        _close(id, r, false);
        emit WithdrawalReleased(id, 5);
    }
    function _close(uint256 id, Withdrawal storage r, bool paid) private {
        address who = r.beneficiary;
        Allocation storage parts = withdrawalAllocation[id];
        User storage u = users[who];
        u.pendingRequest = false;
        u.referralReserved -= parts.referral;
        networkReserved[who] -= parts.network;
        if (paid) profitLiability -= r.gross - parts.principal;
        else {
            u.referralAvailable += parts.referral;
            networkAvailable[who] += parts.network;
        }
        if (parts.personal != 0) {
            Position storage p = positions[who][0];
            p.reservedProfit -= parts.personal;
            uint256 daily = reservedDailyByRequest[id];
            uint256 compound = reservedCompoundByRequest[id];
            delete reservedDailyByRequest[id];
            delete reservedCompoundByRequest[id];
            if (paid) {
                reinvestmentBook.settleProfit(id);
                emit ProfitClaimSplitPaid(id, daily, compound);
            } else {
                reinvestmentBook.releaseProfit(id);
                p.availableProfit += parts.personal;
                p.compoundedBasis += parts.personal;
                claimableDaily[who][0] += daily;
                claimableCompound[who][0] += compound;
            }
        }
        if (parts.principal != 0) {
            Position storage p = positions[who][0];
            p.reservedPrincipal -= parts.principal;
            if (paid) {
                reinvestmentBook.settlePrincipal(id);
                p.principal -= parts.principal;
                networkPlan.capitalChanged(who, u.capital, u.capital - parts.principal);
                u.capital -= parts.principal;
                principalLiability -= parts.principal;
            } else reinvestmentBook.releasePrincipal(id);
        }
    }
}
