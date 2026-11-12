import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,parseEther,zeroPadValue} from 'ethers';
import {parseHistoryRelayQuery,readHistoryRelaySnapshot,createHistoryRelay} from '../server/history-relay.mjs';
import {createVerifiedHistoryStore} from '../server/history-store.mjs';
import {createApiServer} from '../server/trades-api.mjs';
const vault='0x1111111111111111111111111111111111111111';
const wallet='0x2222222222222222222222222222222222222222';
const other='0x3333333333333333333333333333333333333333';
const token='0x4444444444444444444444444444444444444444';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const iface=new Interface([
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd)',
 'event Registered(address indexed user,address indexed referrer)'
]);
const vaultIface=new Interface(['function usdt() view returns(address)',
 'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)']);
const config={chainId:97,address:vault,rpcUrl:'https://rpc.example/private-secret',
 rpcUrls:[],confirmations:3};
function fixture(){
 const logs=[],calls=[];
 function event(name,args,block,index){
  const parts=iface.encodeEventLog(iface.getEvent(name),args);
  logs.push({...parts,address:vault,transactionHash:hash(400+index),
   blockHash:hash(block),blockNumber:block,index,removed:false});
 }
 event('Deposited',[wallet,token,0n,parseEther('100'),parseEther('100'),parseEther('10')],190,1);
 event('ProfitCredited',[wallet,token,parseEther('0.5'),hash(14)],191,2);
 event('NetworkRewardEarned',[wallet,0n,1,parseEther('100'),parseEther('7')],192,3);
 event('ProfitCredited',[other,token,parseEther('50'),hash(15)],193,4);
 event('Deposited',[wallet,ZeroAddress,1n,parseEther('1'),parseEther('200'),parseEther('0.1')],194,5);
 event('Registered',[other,wallet],195,6);
 const provider={
  async send(method){assert.equal(method,'eth_chainId');return '0x61';},
  async getCode(address){assert.equal(address.toLowerCase(),vault.toLowerCase());return '0x6000';},
  async getBlockNumber(){return 200;},
  async getBlock(number){return {number,hash:hash(number),timestamp:1700000000+number};},
  async getNetwork(){return {chainId:97n};},
  async call(transaction){const call=vaultIface.parseTransaction({data:transaction.data});
   if(call.name==='usdt')return vaultIface.encodeFunctionResult('usdt',[token]);
   if(call.name==='users')return vaultIface.encodeFunctionResult('users',[wallet,true,true,false,2n,parseEther('100'),parseEther('30')]);
   throw Error('Unexpected contract function');},
  async getLogs(filter){
   calls.push(filter);
   const topicMatch=(expected,actual)=>expected===null||(
    Array.isArray(expected)?expected.some(item=>item.toLowerCase()===actual?.toLowerCase()):
     expected.toLowerCase()===actual?.toLowerCase());
   return logs.filter(row=>row.blockNumber>=filter.fromBlock&&row.blockNumber<=filter.toBlock&&
    row.address.toLowerCase()===filter.address.toLowerCase()&&
    filter.topics.every((expected,index)=>topicMatch(expected,row.topics[index])));
  }
 };
 return {provider,calls};
}
const q=(query='wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196')=>
 parseHistoryRelayQuery(new URLSearchParams(query));

test('relay accepts only bounded contract event filters, never caller-supplied addresses or arbitrary RPC',()=>{
 for(const text of [
  'wallet=invalid&asset='+token+'&scope=wallet&kind=finance',
  'wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=10&to=500',
  'wallet='+wallet+'&asset='+token+'&scope=wallet&kind=reward&from=10&to=200',
  'wallet='+wallet+'&asset='+token+'&scope=global&kind=reward',
  'wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&method=eth_call',
  'wallet='+wallet+'&wallet='+other+'&asset='+token+'&scope=wallet&kind=finance'
 ])assert.throws(()=>q(text),/HISTORY_RELAY_BAD_REQUEST/);
 assert.equal(q().from,188);assert.equal(q().to,196);
 assert.equal(q('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance').from,undefined);
});

test('relay returns only confirmed matching wallet and asset events with verified timestamps',async()=>{
 const f=fixture(),result=await readHistoryRelaySnapshot({provider:f.provider,config,query:q()});
 assert.equal(result.confirmedHead,197);
 assert.deepEqual(result.logs.map(x=>x.blockNumber),[190,191]);
 assert.equal(result.logs[0].timestamp,1700000190);
 assert.equal(result.logs[1].index,2);
 assert.ok(f.calls.length>0&&f.calls.every(call=>call.toBlock-call.fromBlock<96));
 assert.ok(f.calls.every(call=>Array.isArray(call.topics[0])));
 assert.doesNotMatch(JSON.stringify(result),/private-secret/);
});

test('relay supports network milestones, BNB events and public global views without mixing wallet payouts',async()=>{
 const f=fixture();
 const network=await readHistoryRelaySnapshot({provider:f.provider,config,
  query:q('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=reward&from=188&to=196')});
 assert.equal(network.logs.length,1);
 assert.equal(network.logs[0].blockNumber,192);
 const native=await readHistoryRelaySnapshot({provider:f.provider,config,
  query:q('wallet='+wallet+'&asset='+ZeroAddress+'&scope=wallet&kind=finance&from=188&to=196')});
 assert.deepEqual(native.logs.map(x=>x.blockNumber),[194]);
 const global=await readHistoryRelaySnapshot({provider:f.provider,config,
  query:q('wallet='+wallet+'&asset='+token+'&scope=global&kind=finance&from=188&to=196')});
 assert.deepEqual(global.logs.map(x=>x.blockNumber),[190,191,193]);
});

test('relay rejects unconfirmed scans and wrong-chain or RPC-failed providers without forged empty history',async()=>{
 const f=fixture();
 await assert.rejects(readHistoryRelaySnapshot({provider:f.provider,config,
  query:q('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=190&to=198')}),/NOT_CONFIRMED/);
 const bad={...f.provider,send:async()=> '0x38'};
 await assert.rejects(readHistoryRelaySnapshot({provider:bad,config,query:q()}),/WRONG_CHAIN/);
 const failing={...f.provider,getLogs:async()=>{throw Error('private RPC credential https://key.invalid');}};
 const relay=createHistoryRelay(config,{providers:[failing,f.provider]});
 try{assert.equal((await relay.get(new URLSearchParams('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196'))).logs.length,2);}
 finally{relay.close();}
 const unavailable=createHistoryRelay(config,{providers:[failing]});
 await assert.rejects(unavailable.get(new URLSearchParams('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196')),/HISTORY_RELAY_RPC_UNAVAILABLE/);
 unavailable.close();
});

test('API exposes bounded history relay, returns sanitized failures and keeps other routes unchanged',async()=>{
 const f=fixture(),relay=createHistoryRelay(config,{providers:[f.provider]});
 const feed={configured:true,publicConfig:{version:1,chainId:97,vaultAddress:vault},get:async()=>({status:'live',trades:[]})};
 const server=createApiServer(feed,{historyRelay:relay});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/api/event-history/window?wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196');
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.logs.length,2);
  assert.equal((await fetch(base+'/api/event-history/window?wallet=invalid')).status,400);
  assert.equal((await fetch(base+'/api/config')).status,200);
  assert.equal((await fetch(base+'/api/event-history/window',{method:'POST'})).status,405);
  f.provider.getLogs=async()=>{throw Error('RPC secret token private');};
  const failed=await fetch(base+'/api/event-history/window?wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196');
  assert.equal(failed.status,503);
  assert.doesNotMatch(JSON.stringify(await failed.json()),/private|secret|token/);
 }finally{relay.close();await new Promise(resolve=>server.close(resolve));}
});

test('server RPC loads only the verified direct team under the indexed referrer',async()=>{
 const f=fixture();
 const query=q('wallet='+wallet+'&asset='+ZeroAddress+'&scope=wallet&kind=team&from=188&to=196');
 const page=await readHistoryRelaySnapshot({provider:f.provider,config,query});
 assert.equal(page.logs.length,1);
 assert.equal(page.logs[0].blockNumber,195);
 assert.equal(page.source,'rpc');
 assert.equal(page.windowHash,hash(196));
 const relay=createHistoryRelay(config,{providers:[f.provider]});
 try{
  const profile=await relay.member(new URLSearchParams('wallet='+other));
  assert.equal(profile.source,'contract+rpc');
  assert.equal(profile.wallet,other);
  assert.equal(profile.referrer,wallet);
  assert.equal(profile.blockNumber,197);
  assert.equal(profile.activeDirect,'2');
  assert.equal(profile.capitalUsd,parseEther('100').toString());
  await assert.rejects(relay.member(new URLSearchParams('wallet=invalid')),/BAD_REQUEST/);
 }finally{relay.close();}
 assert.throws(()=>q('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=team'),/BAD_REQUEST/);
 assert.throws(()=>q('wallet='+wallet+'&asset='+ZeroAddress+'&scope=global&kind=team'),/BAD_REQUEST/);
});

test('SQLite stores verified windows and canonical RPC revalidates every database hit',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'global-history-db-'));
 const file=path.join(dir,'verified.sqlite');
 const f=fixture(),query='wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196';
 try{
  let store=createVerifiedHistoryStore(file);
  const relay=createHistoryRelay(config,{providers:[f.provider],store});
  const first=await relay.get(new URLSearchParams(query));
  assert.equal(first.source,'rpc');
  assert.equal(first.logs.length,2);
  const scans=f.calls.length;
  const second=await relay.get(new URLSearchParams(query));
  assert.equal(second.source,'database+rpc');
  assert.equal(f.calls.length,scans,'cached verified pages avoid repeated expensive log scans');
  assert.deepEqual(second.logs,first.logs);
  assert.equal(fs.statSync(file).mode&0o077,0,'cache file is private');
  relay.close();
  store=createVerifiedHistoryStore(file);
  assert.equal(store.get(config,q(query)).logs.length,2,'pages survive restarts');
  const wrong={...config,chainId:56};
  assert.equal(store.get(wrong,q(query)),null,'do not cross chains or contracts');
  store.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('corrupted or stale DB pages must not replace an RPC failure with false zero activity',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'global-history-reorg-'));
 const store=createVerifiedHistoryStore(path.join(dir,'verified.sqlite'));
 const f=fixture(),params=new URLSearchParams('wallet='+wallet+'&asset='+token+'&scope=wallet&kind=finance&from=188&to=196');
 try{
  const relay=createHistoryRelay(config,{providers:[f.provider],store});
  await relay.get(params);
  const savedScans=f.calls.length;
  const oldBlock=f.provider.getBlock;
  f.provider.getBlock=async number=>number===196?{number,hash:hash(9999),timestamp:1700000196}:oldBlock(number);
  const rechecked=await relay.get(params);
  assert.equal(rechecked.source,'rpc','reorg invalidates the cached window');
  assert.ok(f.calls.length>savedScans,'re-scan RPC after a changed canonical block');
  f.provider.getLogs=async()=>{throw Error('Private RPC URL secret');};
  f.provider.getBlock=async()=>{throw Error('Unavailable RPC');};
  await assert.rejects(relay.get(params),/HISTORY_RELAY_RPC_UNAVAILABLE/);
  relay.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
