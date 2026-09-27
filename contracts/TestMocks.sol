// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract MockToken is ERC20 {
    uint8 private immutable d;
    constructor(uint8 decimals_) ERC20("Test USDT","TUSDT") { d=decimals_; }
    function decimals() public view override returns(uint8) {return d;}
    function mint(address to,uint256 value) external { _mint(to,value); }
}
contract MockFeed {
    uint8 public constant decimals=8;
    int256 public answer;
    uint256 public updated;
    uint80 public round=1;
    uint80 public answered=1;
    constructor(int256 value) { answer=value; updated=block.timestamp; }
    function set(int256 value,uint256 timestamp,uint80 r,uint80 a) external { answer=value; updated=timestamp; round=r; answered=a; }
    function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80) { return(round,answer,updated,updated,answered); }
}
interface IVault {
    function deposit(address,uint256,address) external payable;
    function withdrawProfit(address,uint256) external;
}
contract ReentrantCustomer {
    IVault public vault;
    bool public attacked;
    bool public reentrySucceeded;
    constructor(address v) {vault=IVault(v);}
    function deposit() external payable {vault.deposit{value:msg.value}(address(0),msg.value,address(0));}
    function withdraw(uint256 amount) external {vault.withdrawProfit(address(0),amount);}
    receive() external payable {
        if(!attacked) {attacked=true; (reentrySucceeded,)=address(vault).call(abi.encodeCall(IVault.withdrawProfit,(address(0),uint256(1))));}
    }
}
contract RejectingOperationsWallet { receive() external payable { revert("reject"); } }
contract ReentrantOperationsWallet {
    bool public attempted;
    bool public succeeded;
    receive() external payable {
        attempted=true;
        (succeeded,)=msg.sender.call(abi.encodeCall(IVault.deposit,(address(0),uint256(1),address(0))));
    }
}
