// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IQueuedVault {
    function settleQueuedProfit(address user,address asset,uint256 gross,uint256 fee,bool cancel) external;
}
/// @notice A 72-hour payment deadline, not a funding guarantee or a minimum waiting period.
contract ProfitWithdrawalQueue is ReentrancyGuard {
    address public immutable vault;
    uint256 public constant PAYMENT_WINDOW=72 hours;
    struct Request {address user;address asset;uint256 gross;uint256 fee;uint256 dueAt;uint8 status;}
    Request[] public requests;
    mapping(address=>uint256[]) private userRequests;
    mapping(address=>uint256) public pending;
    mapping(address=>mapping(address=>bool)) public hasPending;
    error InvalidRequest();
    event Requested(uint256 indexed id,address indexed user,address indexed asset,uint256 gross,uint256 fee,uint256 dueAt);
    event Resolved(uint256 indexed id,uint8 status);
    constructor(){vault=msg.sender;}
    function requestCount() external view returns(uint256){return requests.length;}
    function userRequestCount(address user) external view returns(uint256){return userRequests[user].length;}
    function userRequestId(address user,uint256 index) external view returns(uint256){return userRequests[user][index];}
    function record(address user,address asset,uint256 gross,uint256 fee) external {
        if(msg.sender!=vault||gross==0||fee>gross||hasPending[user][asset])revert InvalidRequest();
        uint256 id=requests.length;uint256 due=block.timestamp+PAYMENT_WINDOW;
        requests.push(Request(user,asset,gross,fee,due,0));userRequests[user].push(id);pending[asset]+=gross;hasPending[user][asset]=true;
        emit Requested(id,user,asset,gross,fee,due);
    }
    /// @notice Anyone may trigger payment; recipient and fee cannot be substituted. Unfunded payment leaves the request pending.
    function pay(uint256 id) external nonReentrant {_resolve(id,false);}
    /// @notice After the deadline the user can restore the reserved profit, including for reinvestment.
    function cancel(uint256 id) external nonReentrant {_resolve(id,true);}
    function _resolve(uint256 id,bool cancelRequest) private {
        Request storage r=requests[id];
        if(r.status!=0||(cancelRequest&&(msg.sender!=r.user||block.timestamp<r.dueAt)))revert InvalidRequest();
        r.status=cancelRequest?2:1;pending[r.asset]-=r.gross;hasPending[r.user][r.asset]=false;
        IQueuedVault(vault).settleQueuedProfit(r.user,r.asset,r.gross,r.fee,cancelRequest);
        emit Resolved(id,r.status);
    }
}
