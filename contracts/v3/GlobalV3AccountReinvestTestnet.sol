// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GlobalV3UplineRatesTestnet} from "./GlobalV3UplineRatesTestnet.sol";

/// @notice Manually add available earnings to the member's single testnet capital account.
contract GlobalV3AccountReinvestTestnet is GlobalV3UplineRatesTestnet {
    event AccountEarningsReinvested(address indexed user, uint256 indexed positionId,
        uint256 personal, uint256 referral, uint256 network, uint256 total);

    constructor(address manager, address token, address fees)
        GlobalV3UplineRatesTestnet(manager, token, fees) {}

    /// @notice Debit the signed amounts and create one new locked lot for their sum.
    /// @dev Available balances already exclude active withdrawal reservations.
    function reinvestAccountEarnings(ReinvestmentSource[] calldata pages, uint256 referral, uint256 network)
        external nonReentrant active
    {
        User storage member = users[msg.sender];
        if (!member.registered || member.suspended) revert NotEligible();
        if (referral > member.referralAvailable || network > networkAvailable[msg.sender]) revert Insufficient();
        if (pages.length > 16) revert Invalid();

        uint256 personal;
        uint256 span;
        uint256 pageEnd;
        for (uint256 i; i < pages.length; ++i) {
            ReinvestmentSource calldata page = pages[i];
            if (page.positionId != 0 || page.amount == 0 || page.limit == 0 || page.limit > 64 ||
                page.start < pageEnd || reinvestmentPositionPlusOne[msg.sender] != 1) revert Invalid();
            span += page.limit;
            if (span > 128) revert Invalid();
            pageEnd = page.start + page.limit;
            _consumeReinvestment(0, page.amount, page.start, page.limit, 1);
            personal += page.amount;
        }

        uint256 rewards = referral + network;
        uint256 total = personal + rewards;
        if (total == 0 || (!member.vipKyc && member.capital + total > 50_000 ether)) revert NotEligible();
        member.referralAvailable -= referral;
        networkAvailable[msg.sender] -= network;
        profitLiability -= rewards;
        uint256 positionId = _recordReinvestment(member, total);
        emit AccountEarningsReinvested(msg.sender, positionId, personal, referral, network, total);
    }
}
