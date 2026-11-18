// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {UnifiedReinvestmentBook} from "../../contracts/v3/UnifiedReinvestmentBook.sol";

/// @dev Local-EVM fixture only. Seeded credits are synthetic and there are no tokens.
/// This is not the existing V3 vault or a deployable migration implementation.
contract UnifiedVaultHarness {
    address public immutable tester;
    UnifiedReinvestmentBook public immutable book;
    mapping(address => mapping(uint256 => uint256)) public sourceClaim;
    uint256 public principalLiability;
    uint256 public profitLiability;

    constructor(){tester=msg.sender;book=new UnifiedReinvestmentBook(address(this));}
    function seed(address who,uint256 source,uint256 amount) external {
        require(msg.sender==tester&&who!=address(0)&&amount>0);
        sourceClaim[who][source]+=amount;profitLiability+=amount;
    }
    function reinvestSource(uint256 source,uint256 amount) external {
        require(amount>0&&sourceClaim[msg.sender][source]>=amount);
        sourceClaim[msg.sender][source]-=amount;
        profitLiability-=amount;principalLiability+=amount;
        book.record(msg.sender,amount);
    }
    function accrue(uint256 start,uint256 limit) external {
        (uint256 daily,uint256 compound,,)=book.accruePage(msg.sender,start,limit,70);
        profitLiability+=daily+compound;
    }
    function reinvestGroup(uint256 amount,uint256 start,uint256 limit) external {
        book.reinvestProfitPage(msg.sender,amount,start,limit);
        profitLiability-=amount;principalLiability+=amount;
    }
}
