// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IQueuedVault {
    function owner() external view returns(address);
    function settleQueuedWithdrawal(address user,address asset,uint256 gross,uint256 fee,uint256 position,bool principal,bool cancel) external;
}
/// @notice A 72-hour payment deadline, not a funding guarantee or a minimum waiting period.
contract ProfitWithdrawalQueue is ReentrancyGuard {
    address public immutable vault;
    uint256 public constant PAYMENT_WINDOW=72 hours;
    uint256 public constant APPROVAL_VERSION=1;
    struct Request {address user;address asset;uint256 gross;uint256 fee;uint256 dueAt;uint8 status;}
    Request[] public requests;
    struct Principal {bool exists;uint256 position;}
    mapping(uint256=>Principal) public principalRequests;
    mapping(address=>uint256[]) private userRequests;
    mapping(address=>uint256) public pending;
    mapping(address=>mapping(address=>bool)) public hasPending;
    error InvalidRequest();
    event Requested(uint256 indexed id,address indexed user,address indexed asset,uint256 gross,uint256 fee,uint256 dueAt);
    event Resolved(uint256 indexed id,uint8 status);
    event Approved(uint256 indexed id,address indexed administrator);
    constructor(){vault=msg.sender;}
    function requestCount() external view returns(uint256){return requests.length;}
    function userRequestCount(address user) external view returns(uint256){return userRequests[user].length;}
    function userRequestId(address user,uint256 index) external view returns(uint256){return userRequests[user][index];}
    function record(address user,address asset,uint256 gross,uint256 fee,uint256 position,bool principal) external {
        uint256 id=_record(user,asset,gross,fee,principal);
        if(principal)principalRequests[id]=Principal(true,position);
    }
    function _record(address user,address asset,uint256 gross,uint256 fee,bool principal) private returns(uint256 id) {
        if(msg.sender!=vault||gross==0||fee>gross||hasPending[user][asset])revert InvalidRequest();
        id=requests.length;uint256 due=block.timestamp+PAYMENT_WINDOW;
        requests.push(Request(user,asset,gross,fee,due,0));userRequests[user].push(id);if(!principal)pending[asset]+=gross;hasPending[user][asset]=true;
        emit Requested(id,user,asset,gross,fee,due);
    }
    /// @notice Only the current vault owner can approve an exact recorded request.
    function approve(uint256 id) public {
        if(msg.sender!=IQueuedVault(vault).owner()||requests[id].status!=0)revert InvalidRequest();
        requests[id].status=3;emit Approved(id,msg.sender);
    }
    function approveAndPay(uint256 id) external nonReentrant {approve(id);_resolve(id,false);}
    /// @notice After administrator approval anyone may execute the fixed payment. Failure preserves the approved debt.
    function pay(uint256 id) external nonReentrant {_resolve(id,false);}
    /// @notice After the deadline the user can restore the reserved profit, including for reinvestment.
    function cancel(uint256 id) external nonReentrant {_resolve(id,true);}
    function _resolve(uint256 id,bool cancelRequest) private {
        Request storage r=requests[id];
        if(cancelRequest){if((r.status!=0&&r.status!=3)||msg.sender!=r.user||block.timestamp<r.dueAt)revert InvalidRequest();}
        else if(r.status!=3)revert InvalidRequest();
        r.status=cancelRequest?2:1;if(!principalRequests[id].exists)pending[r.asset]-=r.gross;hasPending[r.user][r.asset]=false;
        Principal memory p=principalRequests[id];
        IQueuedVault(vault).settleQueuedWithdrawal(r.user,r.asset,r.gross,r.fee,p.position,p.exists,cancelRequest);
        emit Resolved(id,r.status);
    }
}
