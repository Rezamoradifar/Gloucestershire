// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GlobalV3SingleCapitalTestnet} from "./GlobalV3SingleCapitalTestnet.sol";

/// @notice Hourly testnet account with referral rates based on each recipient's principal.
contract GlobalV3UplineRatesTestnet is GlobalV3SingleCapitalTestnet {
    constructor(address manager, address token, address fees)
        GlobalV3SingleCapitalTestnet(manager, token, fees) {}

    /// @dev level is zero-based here, as in the existing referral rate table.
    function _uplineRate(address earner, address recipient, uint8 level)
        internal view override returns (uint16)
    {
        if (!isEligible(recipient)) return 0;
        if (level == 3 && tierOf(earner) != 4) return 0;
        return referralBps(tierOf(recipient), level);
    }

    /// @notice Effective rate in basis points if eligible personal profit were posted now.
    /// @param depth One for the direct referrer, up to four for the fourth ancestor.
    function currentReferralBps(address earner, uint8 depth) external view returns (uint16) {
        if (depth == 0 || depth > 4) revert Invalid();
        if (paused || !isEligible(earner)) return 0;
        address recipient = earner;
        for (uint8 i = 0; i < depth; ++i) {
            recipient = users[recipient].referrer;
            if (recipient == address(0)) return 0;
        }
        return _uplineRate(earner, recipient, depth - 1);
    }
}
