import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress} from 'ethers';
import {parseAdminUsersQuery,readAdminUsers,createAdminUsers} from '../server/admin-users.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const vault='0x1111111111111111111111111111111111111111';
const member='0x2222222222222222222222222222222222222222';
const parent='0x3333333333333333333333333333333333333333';
const token='0x4444444444444444444444444444444444444444';
const queue='0x5555555555555555555555555555555555555555';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const iface=new Interface([
 'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)',
 'function accounts(address,address) view returns(uint256 principal,uint256 profit,uint256 externalDeposited,uint256 nextWithdrawal)',
 'function positionCount(address) view returns(uint256)',
 'function positionOf(address,uint256) view returns((address asset,uint256 principal,uint256 capitalUsd,uint256 unlockAt,uint16 penaltyBps))',
 'function tierOf(address) view returns(uint8)',
 'function dailyTargetBps(address) view returns(uint16)',
 'function networkBranchCount(address) view returns(uint256)',
 'function qualifiedDirects(address) view returns(uint256)',
 'function usdt() view returns(address)',
 'function tokenDecimals() view returns(uint8)',
 'function profitWithdrawalCap(address,address) view returns(uint256)',
 'function cumulativeReinvested(address,address) view returns(uint256)',
 'function withdrawalQueue() view returns(address)',
 'function vault() view returns(address)',
 'function userRequestCount(address) view returns(uint256)',
 'function userRequestId(address,uint256) view returns(uint256)',
 'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)'
]);
const registered=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const config={chainId:97,address:vault,rpcUrl:'https://private.invalid/key',rpcUrls:[],confirmations:3,startBlock:100};
const q=(path,text='')=>parseAdminUsersQuery(path,new URLSearchParams(text));
function fake(){
 const events=[{wallet:member,referrer:parent,block:190,idx:2}].map(entry=>({
  ...registered.encodeEventLog(registered.getEvent('Registered'),[entry.wallet,entry.referrer]),
  transactionHash:hash(500+entry.idx),blockHash:hash(entry.block),blockNumber:entry.block,
  index:entry.idx,address:vault,removed:false
 }));
 const calls={logs:0,call:0};
 const provider={
  send:async method=>method==='eth_chainId'?'0x61':null,
  getCode:async()=> '0x600160',
  getBlockNumber:async()=>200,
  getBlock:async number=>({number,hash:hash(number),timestamp:1700000000+number}),
  getNetwork:async()=>({chainId:97n}),
  getLogs:async filter=>{
   calls.logs++;
   return events.filter(log=>log.blockNumber>=filter.fromBlock&&log.blockNumber<=filter.toBlock&&
    filter.topics.every((topic,i)=>topic===null||String(topic).toLowerCase()===log.topics[i]?.toLowerCase()));
  },
  call:async tx=>{
   calls.call++;
   const v=iface.parseTransaction({data:tx.data});
   assert.ok(v,'Expected known view selector');
   const asset=v.args[1];
   const out={
    users:[parent,true,false,false,0n,136866341000000000000n,0n],
    accounts:asset===ZeroAddress?[100n,50n,200n,0n]:[200n,75n,400n,0n],
    positionCount:[2n],
    positionOf:[[token,200n,15000000000000000000n,1700003200n,200n]],
    tierOf:[1n],dailyTargetBps:[150n],networkBranchCount:[5n],
    qualifiedDirects:[1n],usdt:[token],tokenDecimals:[18n],
    profitWithdrawalCap:[20n],cumulativeReinvested:[10n],withdrawalQueue:[queue],
    vault:[vault],userRequestCount:[1n],userRequestId:[7n],
    requests:[member,token,400n,0n,1700000500n,3n]
   }[v.name];
   assert.ok(out,'Unexpected method '+v.name);
   return iface.encodeFunctionResult(v.name,out);
  }
 };
 return {provider,calls};
}
test('administrator directory query parser enforces bounded windows and pinned block hashes',()=>{
 assert.equal(q('head').kind,'head');
 assert.equal(q('registrations','head=197&hash='+hash(197)+'&from=180&to=197').kind,'registrations');
 assert.equal(q('user','head=197&hash='+hash(197)+'&wallet='+member).offset,0);
 for(const invalid of [
  ['head','wallet='+member],
  ['user','wallet='+member],
  ['user','head=197&hash='+hash(197)+'&wallet=INVALID'],
  ['registrations','head=197&hash='+hash(197)+'&from=198&to=197'],
  ['registrations','head=2000&hash='+hash(197)+'&from=0&to=1100'],
  ['registrations','head=197&hash='+hash(197)+'&from=180&to=197&from=175'],
  ['withdrawals','head=197&hash='+hash(197)+'&wallet='+member+'&page=-1'],
  ['user','head=197&hash='+hash(197)+'&wallet='+member+'&rpc=https://private.invalid']
 ])assert.throws(()=>q(...invalid),/ADMIN_USERS_BAD_REQUEST/);
});
test('read-only owner registry reports precise canonical coverage, not a fabricated full member total',async()=>{
 const f=fake();
 const header=await readAdminUsers({provider:f.provider,config,query:q('head')});
 assert.equal(header.confirmedHead,197);assert.equal(header.deploymentBlock,100);
 const page=await readAdminUsers({provider:f.provider,config,
  query:q('registrations','head=197&hash='+hash(197)+'&from=180&to=197')});
 assert.equal(page.events.length,1);assert.equal(page.events[0].wallet,member);
 assert.equal(page.complete,false);assert.equal(page.source,'verified_contract_logs');
 assert.ok(f.calls.logs>0);
 const done=await readAdminUsers({provider:f.provider,config,
  query:q('registrations','head=197&hash='+hash(197)+'&from=100&to=197')});
 assert.equal(done.complete,true);
 await assert.rejects(readAdminUsers({provider:f.provider,config,
  query:q('registrations','head=197&hash='+hash(197)+'&from=0&to=197')}),/ADMIN_USERS_BAD_REQUEST/);
 const changed={...f.provider,getBlock:async n=>({number:n,hash:hash(n+1)})};
 await assert.rejects(readAdminUsers({provider:changed,config,
  query:q('registrations','head=197&hash='+hash(197)+'&from=180&to=197')}),/CHECKPOINT_MISMATCH/);
});
test('admin profile includes exact two-asset contract accounting with no private KYC documents',async()=>{
 const f=fake();
 const result=await readAdminUsers({provider:f.provider,config,
  query:q('user','head=197&hash='+hash(197)+'&wallet='+member)});
 assert.equal(result.profile.active,false);
 assert.equal(result.profile.registeredDirect,'5');
 assert.equal(result.profile.activeDirect,'0');
 assert.equal(result.profile.capitalUsd,'136866341000000000000');
 assert.equal(result.assets.length,2);
 assert.equal(result.assets[1].profit,'75');
 assert.equal(result.positionCount,2);
 assert.equal(result.positions.length,2);
 assert.equal(result.positions[0].symbol,'USDT');
 assert.doesNotMatch(JSON.stringify(result),/private\.invalid|secret|password|idDocument/);
});
test('contract queue state is distinguished from verified payout',async()=>{
 const f=fake(),result=await readAdminUsers({provider:f.provider,config,
  query:q('withdrawals','head=197&hash='+hash(197)+'&wallet='+member+'&page=0')});
 assert.equal(result.supported,true);
 assert.equal(result.total,1);
 assert.equal(result.requests[0].status,3);
 assert.match(result.note,/not a transaction receipt/);
});
test('admin user API refuses unsigned or non-owner session and returns sanitized failures',async()=>{
 const f=fake();
 const service=createAdminUsers(config,{providers:[f.provider]});
 const community=Object.assign(async()=>false,{authorizeOwner:async req=>{
  if(req.headers.authorization!=='Bearer owner-token')throw Object.assign(Error('secret'),{status:401});
 }});
 const feed={configured:true,publicConfig:{version:1,chainId:97,vaultAddress:vault},get:async()=>({status:'live',trades:[]})};
 const server=createApiServer(feed,{community,adminUsers:service});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(root+'/api/admin-users/head')).status,401);
  const auth={Authorization:'Bearer owner-token'};
  const ok=await fetch(root+'/api/admin-users/head',{headers:auth});
  assert.equal(ok.status,200);assert.equal((await ok.json()).confirmedHead,197);
  const p=await fetch(root+'/api/admin-users/user?head=197&hash='+hash(197)+'&wallet='+member,{headers:auth});
  assert.equal(p.status,200);assert.equal((await p.json()).profile.activeDirect,'0');
  assert.equal((await fetch(root+'/api/admin-users/user?head=INVALID&wallet='+member,{headers:auth})).status,400);
  const failed={...f.provider,getBlock:async()=>{throw Error('private RPC password');}};
  const broken=createAdminUsers(config,{providers:[failed]});
  service.get=broken.get;
  const error=await fetch(root+'/api/admin-users/head',{headers:auth});
  assert.equal(error.status,503);
  assert.doesNotMatch(JSON.stringify(await error.json()),/private RPC password/);
 }finally{await new Promise(resolve=>server.close(resolve));service.close();}
});
