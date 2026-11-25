// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GlobalV3PortfolioTestnet} from "./GlobalV3PortfolioTestnet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Combined testnet withdrawals with a per-request earnings cap for each capital tier.
contract GlobalV3PlanPortfolioTestnet is GlobalV3PortfolioTestnet {
    uint16[5] public planWithdrawalBps;

    event PlanWithdrawalBpsChanged(uint16[5] rates);

    constructor(address manager, address token, address fees)
        GlobalV3PortfolioTestnet(manager, token, fees)
    {
        for (uint256 tier; tier < planWithdrawalBps.length; ++tier) {
            planWithdrawalBps[tier] = uint16(PROFIT_WITHDRAWAL_CAP_BPS);
        }
    }

    /// @notice Changes the rates for future requests in ascending capital-tier order.
    function setPlanWithdrawalBps(uint16[5] calldata rates) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 tier; tier < rates.length; ++tier) {
            if (rates[tier] > BPS) revert Invalid();
        }
        planWithdrawalBps = rates;
        emit PlanWithdrawalBpsChanged(rates);
    }

    function profitWithdrawalCap(address who) public view override returns (uint256) {
        User storage member = users[who];
        return Math.mulDiv(member.originalDeposits + member.reinvestments, planWithdrawalBps[tierOf(who)], BPS);
    }
}
