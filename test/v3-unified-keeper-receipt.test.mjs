import assert from 'node:assert/strict';
import test from 'node:test';
import {Interface,getAddress} from 'ethers';
import {verifyUnifiedAccrualReceipt} from '../scripts/execute-v3-unified-keeper.mjs';

const addr=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const abi=new Interface(['event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)']);
function fixture(overrides={}){
 const vault=addr(1),member=addr(2),operator=addr(3),txHash=hash(10),blockHash=hash(11),nonce=7,data='0x12345678';
 const event=abi.encodeEventLog(abi.getEvent('DailyClaimAccrued'),[member,4,2,3,5,1000]);
 const log={address:vault,topics:event.topics,data:event.data};
 const receipt={hash:txHash,status:1,blockNumber:100,blockHash,logs:[log]};
 const raw={transactionHash:txHash,status:'0x1',blockNumber:'0x64',blockHash,logs:[log]};
 const tx={hash:overrides.wrongTransactionHash?hash(98):txHash,from:operator,to:vault,chainId:97n,nonce,value:0n,data,gasLimit:100000n,gasPrice:3n};
 let blockReads=0,receiptReads=0,heightReads=0,chainReads=0;
 const provider={getTransaction:async()=>tx,send:async method=>{
  if(method==='eth_getBlockByNumber'){
   blockReads++;
   return {number:overrides.badBlockNumber&&blockReads===1?'0x65':'0x64',
    hash:overrides.reorgAfterEvent&&blockReads>1?hash(99):blockHash};
  }
  if(method==='eth_getTransactionReceipt'){
   receiptReads++;
   return {...raw,blockNumber:(overrides.badReceiptNumber&&receiptReads===1)||
    (overrides.badFinalReceiptNumber&&receiptReads>1)?'0x65':raw.blockNumber,
    logs:overrides.lostFinalEvent&&receiptReads>1?[]:raw.logs};
  }
  if(method==='eth_blockNumber'){heightReads++;return overrides.lostConfirmations&&heightReads>1?'0x64':'0x65';}
  if(method==='eth_chainId'){chainReads++;return overrides.chainChanged&&chainReads>1?'0x38':'0x61';}
  throw Error('UNEXPECTED_RPC');
 }};
 return {provider,receipt,hash:txHash,simulation:{vault,member,positionId:4,gasLimit:100000n,gasPrice:3n},operator,nonce,data};
}

test('receipt verification checks the canonical block and event twice',async()=>{
 assert.equal(await verifyUnifiedAccrualReceipt(fixture()),true);
});
test('receipt verification rejects inconsistent block numbers and a reorganization after event inspection',async()=>{
 for(const option of ['wrongTransactionHash','badBlockNumber','badReceiptNumber','badFinalReceiptNumber','reorgAfterEvent','lostFinalEvent','lostConfirmations','chainChanged']){
  await assert.rejects(verifyUnifiedAccrualReceipt(fixture({[option]:true})),/CANONICALITY_MISMATCH/,option);
 }
});
