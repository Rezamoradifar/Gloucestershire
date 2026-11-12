import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,parseEther,zeroPadValue} from 'ethers';
import {readAccountHistoryPage,createAccountHistory,parseHistoryQuery} from '../server/account-history.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const vault='0x1111111111111111111111111111111111111111';
const wallet='0x2222222222222222222222222222222222222222';
const other='0x3333333333333333333333333333333333333333';
const token='0x4444444444444444444444444444444444444444';
const queue='0x5555555555555555555555555555555555555555';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const block=n=>({number:n,hash:hash(n),timestamp:1700000000+n});
const vaultInterface=new Interface([
 'event Registered(address indexed user,address indexed referrer)',
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)',
 'event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)'
]);
const queueInterface=new Interface([
 'event Requested(uint256 indexed id,address indexed user,address indexed asset,uint256 gross,uint256 fee,uint256 dueAt)'
]);
const config={rpcUrl:'https://rpc.example/private-secret',rpcUrls:[],chainId:97,address:vault,startBlock:100,confirmations:3};

function fixture(){
 const logs=[];
 function add(contract,iface,name,args,height,index){
  const log=iface.encodeEventLog(iface.getEvent(name),args);
  logs.push({...log,address:contract,transactionHash:hash(500+index),
   index,blockNumber:height,blockHash:hash(height),removed:false});
 }
 add(vault,vaultInterface,'Registered',[wallet,ZeroAddress],102,0);
 add(vault,vaultInterface,'Deposited',[wallet,token,0n,parseEther('100'),parseEther('100'),parseEther('10')],103,1);
 add(vault,vaultInterface,'ProfitCredited',[wallet,token,parseEther('0.5'),hash(7)],104,2);
 add(queue,queueInterface,'Requested',[0n,wallet,token,parseEther('0.5'),parseEther('0.025'),1700000000+105+259200],105,3);
 add(vault,vaultInterface,'Withdrawal',[wallet,token,parseEther('0.5'),parseEther('0.025'),false],107,4);
 add(vault,vaultInterface,'ProfitCredited',[other,token,parseEther('25'),hash(9)],108,5);
 add(vault,vaultInterface,'ProfitCredited',[wallet,token,parseEther('999'),hash(11)],110,6); // unconfirmed
 const requests=[];
 const provider={
  async send(method){if(method==='eth_chainId')return '0x61';throw Error('unexpected network method');},
  async getCode(addr){return [vault,queue].some(x=>x.toLowerCase()===addr.toLowerCase())?'0x6000':'0x';},
  async getBlockNumber(){return 112;},
  async getBlock(number){return block(number);},
  async getLogs(filter){
   requests.push(filter);
   const matches=(expected,value)=>expected===null||
     (Array.isArray(expected)?expected.some(item=>item.toLowerCase()===value?.toLowerCase()):
       expected.toLowerCase()===value?.toLowerCase());
   return logs.filter(row=>row.address.toLowerCase()===filter.address.toLowerCase()&&
    row.blockNumber>=filter.fromBlock&&row.blockNumber<=filter.toBlock&&
    filter.topics.every((value,index)=>matches(value,row.topics[index])));
  }
 };
 const metadata={token,decimals:18,queueAddress:queue,
  queueRequest:async()=>({user:wallet,asset:token,status:3n})};
 return {provider,metadata,logs,requests,add};
}
test('wallet history includes confirmed deposits, credits, paid withdrawals and queue requests, excluding other wallets',async()=>{
 const f=fixture();
 const page=await readAccountHistoryPage({provider:f.provider,metadata:f.metadata,config,wallet});
 assert.equal(page.confirmedThrough,109);
 assert.equal(page.items.length,5);
 assert.deepEqual(page.items.map(row=>row.label),['Profit paid','Withdrawal requested','Profit credited','Deposit recorded','Account registered']);
 assert.equal(page.items[1].queueStatus,'approved');
 assert.equal(page.items[2].amount,'0.5');
 assert.match(page.items[2].detail,/not a payment/);
 assert.equal(page.items[3].amount,'100.0');
 assert.equal(page.items[3].fee,'20.0');
 assert.equal(page.items[0].fee,'0.025');
 assert.equal(page.items[0].confirmed,true);
 assert.equal(page.nextCursor,null);
 assert.ok(f.requests.every(x=>x.toBlock<=109));
 assert.ok(f.requests.some(x=>Array.isArray(x.topics[0])&&x.topics[0].length>1));
 assert.ok(!JSON.stringify(page).includes('private-secret'));
});
test('cursor respects log index, never duplicates dense blocks and scans older on demand',async()=>{
 const f=fixture();
 for(let i=0;i<5;i++)f.add(vault,vaultInterface,'ProfitCredited',[wallet,token,parseEther('0.1'),hash(i+100)],108,i+20);
 let before=null,seen=new Set(),count=0,pages=0;
 for(;;){
  const page=await readAccountHistoryPage({provider:f.provider,metadata:f.metadata,config,wallet,limit:2,before});
  for(const item of page.items){
   assert.equal(seen.has(item.id),false,item.id);
   seen.add(item.id);count++;
  }
  pages++;
  if(!page.nextCursor)break;
  before=page.nextCursor;
  assert.ok(pages<20,'cursor must advance');
 }
 assert.equal(count,10);
 assert.ok(pages>=5);
});
test('strict input validation, chain identity and orphaned logs fail closed',async()=>{
 for(const query of ['wallet=invalid','wallet='+wallet+'&limit=0','wallet='+wallet+'&limit=100',
  'wallet='+wallet+'&limit=2&limit=2','wallet='+wallet+'&unknown=1',
  'wallet='+wallet+'&before=not-a-cursor'])assert.throws(()=>parseHistoryQuery(new URLSearchParams(query)),/BAD_REQUEST/);
 const f=fixture();
 await assert.rejects(readAccountHistoryPage({provider:f.provider,metadata:f.metadata,config,wallet,before:'999:1'}),/CURSOR_INVALID/);
 f.provider.send=async()=> '0x38';
 await assert.rejects(readAccountHistoryPage({provider:f.provider,metadata:f.metadata,config,wallet}),/WRONG_CHAIN/);
 f.provider.send=async()=> '0x61';
 f.logs[0].removed=true;
 await assert.rejects(readAccountHistoryPage({provider:f.provider,metadata:f.metadata,config,wallet}),/COMPLETE_LOG_RESPONSE_INVALID/);
});
test('HTTP history endpoint has sanitized errors and no server-secret leakage',async()=>{
 const f=fixture(),history=createAccountHistory(config,{providers:[f.provider],metadata:f.metadata});
 const feed={configured:true,publicConfig:{version:1,chainId:97,vaultAddress:vault},get:async()=>({status:'live',trades:[]})};
 const server=createApiServer(feed,{accountHistory:history});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/api/account-history?wallet='+wallet);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.items.length,5);
  assert.equal((await fetch(base+'/api/account-history?wallet=not-wallet')).status,400);
  assert.equal((await fetch(base+'/api/account-history?wallet='+wallet,{method:'POST'})).status,405);
  const configResponse=await fetch(base+'/api/config');
  assert.equal(configResponse.status,200);
  assert.ok(!JSON.stringify(data).includes('private-secret'));
  f.provider.getLogs=async()=>{throw Error('rpc token secret');};
  const bad=await fetch(base+'/api/account-history?wallet='+wallet);
  assert.equal(bad.status,503);
  assert.ok(!JSON.stringify(await bad.json()).includes('secret'));
 }finally{history.close();await new Promise(resolve=>server.close(resolve));}
});


test('history scans bounded block windows and reaches old deposits without large RPC queries',async()=>{
 const f=fixture();
 f.provider.getBlockNumber=async()=>7000;
 const scan=f.provider.getLogs;
 f.provider.getLogs=async filter=>{
  assert.ok(filter.toBlock-filter.fromBlock+1<=500,'history must keep RPC log ranges bounded');
  return scan(filter);
 };
 const seen=new Set();let cursor=null,pages=0;
 do{
  const page=await readAccountHistoryPage({provider:f.provider,metadata:f.metadata,config,wallet,before:cursor});
  assert.ok(page.scannedTo-page.scannedFrom<1000);
  for(const item of page.items){
   assert.equal(seen.has(item.id),false,'a historical event was duplicated');
   seen.add(item.id);
  }
  cursor=page.nextCursor;pages++;
  assert.ok(pages<=12,'history cursor did not reach the deployed contract start');
 }while(cursor!==null);
 assert.equal(seen.size,6,'oldest records and newer confirmed credits must remain accessible');
 assert.ok(pages>2,'sparse windows must page rather than invent an empty full history');
});
