import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,zeroPadValue,ZeroAddress} from 'ethers';
import {parseTeamQuery,readTeamSnapshot,createTeamRelay} from '../server/team-relay.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const vault='0x1111111111111111111111111111111111111111';
const parent='0x2222222222222222222222222222222222222222';
const child='0x3333333333333333333333333333333333333333';
const unrelated='0x4444444444444444444444444444444444444444';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const iface=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const users=new Interface(['function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)']);
const config={chainId:97,address:vault,rpcUrl:'https://private.invalid/secret',rpcUrls:[],confirmations:3};
const q=text=>parseTeamQuery(new URLSearchParams(text));
function fixture(){
 const data=[
  {user:child,referrer:parent,block:190,index:1},
  {user:unrelated,referrer:child,block:191,index:2}
 ].map(row=>({...iface.encodeEventLog(iface.getEvent('Registered'),[row.user,row.referrer]),
  blockNumber:row.block,index:row.index,blockHash:hash(row.block),
  transactionHash:hash(row.index+100),address:vault,removed:false}));
 const calls=[];
 const provider={
  send:async()=> '0x61',getCode:async()=> '0x6000',
  getBlockNumber:async()=>200,
  getBlock:async n=>({number:n,hash:hash(n),timestamp:1700000000+n}),
  getLogs:async filter=>{
   calls.push(filter);
   return data.filter(row=>row.blockNumber>=filter.fromBlock&&row.blockNumber<=filter.toBlock&&
    filter.topics.every((topic,i)=>topic===null||topic.toLowerCase()===row.topics[i]?.toLowerCase()));
  },
  getNetwork:async()=>({chainId:97n}),
  call:async request=>{
   const action=users.parseTransaction({data:request.data});
   assert.equal(action.name,'users');
   return users.encodeFunctionResult('users',[parent,true,true,false,3n,800n,1200n]);
  }
 };
 return {provider,calls};
}

test('team query is bounded and rejects arbitrary RPC, duplicate fields, and invalid wallets',()=>{
 assert.equal(q('parent='+parent).kind,'registrations');
 assert.equal(q('parent='+parent+'&from=188&to=196').to,196);
 for(const query of ['parent=not-an-address','parent='+parent+'&from=0&to=500',
  'parent='+parent+'&parent='+child,'parent='+parent+'&wallet='+child,
  'wallet='+child+'&block=abc','wallet='+child+'&block=123&from=100',
  'parent='+ZeroAddress,'wallet='+ZeroAddress+'&block=100',
  'parent='+parent+'&rpc=https://private.invalid']){
  assert.throws(()=>q(query),/TEAM_RELAY_BAD_REQUEST/);
 }
});

test('server relays only confirmed referral edges for the requested direct parent',async()=>{
 const f=fixture();
 const result=await readTeamSnapshot({provider:f.provider,config,query:q('parent='+parent+'&from=188&to=196')});
 assert.equal(result.confirmedHead,197);
 assert.deepEqual(result.members.map(x=>x.address),[child]);
 assert.equal(result.members[0].block,190);
 assert.ok(f.calls.every(x=>x.toBlock-x.fromBlock<96));
 assert.doesNotMatch(JSON.stringify(result),/private.invalid|secret/);
 const head=await readTeamSnapshot({provider:f.provider,config,query:q('parent='+parent)});
 assert.equal(head.confirmedHead,197);
 assert.equal(head.members.length,0);
});

test('member details read the same verified contract at a confirmed block without wallet RPC',async()=>{
 const f=fixture();
 const result=await readTeamSnapshot({provider:f.provider,config,query:q('wallet='+child+'&block=195')});
 assert.deepEqual(result.profile,{referrer:parent,registered:true,active:true,kyc:false,
  activeDirect:'3',capitalUsd:'800',salesUsd:'1200'});
 const latest=await readTeamSnapshot({provider:f.provider,config,query:q('wallet='+child)});
 assert.equal(latest.block,197);assert.equal(latest.profile.registered,true);
 const modified={...f.provider,send:async()=> '0x38'};
 await assert.rejects(readTeamSnapshot({provider:modified,config,query:q('wallet='+child+'&block=195')}),/WRONG_CHAIN/);
 await assert.rejects(readTeamSnapshot({provider:f.provider,config,query:q('wallet='+child+'&block=198')}),/NOT_CONFIRMED/);
});

test('volume endpoint reads verified contract branches, never invents earnings',async()=>{
 const f=fixture();
 const volumeAbi=new Interface([
  'function volumeJobCount() view returns(uint256)',
  'function volumeJobs(uint256) view returns(address child,address ancestor,uint256 usd)',
  'function networkBranchCount(address) view returns(uint256)',
  'function networkBranch(address,uint256) view returns(address)',
  'function branchVolumeUsd(address,address) view returns(uint256)'
 ]);
 const original=f.provider.call;
 f.provider.call=async tx=>{
  const a=volumeAbi.parseTransaction({data:tx.data});
  if(!a)return original(tx);
  if(a.name==='volumeJobCount'||a.name==='networkBranchCount')
   return volumeAbi.encodeFunctionResult(a.name,[0n]);
  throw Error('Unexpected contract query '+a.name);
 };
 const result=await readTeamSnapshot({provider:f.provider,config,query:q('wallet='+parent+'&mode=volume')});
 assert.equal(result.kind,'volume');assert.equal(result.block,197);
 assert.deepEqual(result.levels,[{level:1,members:0,volume:'0'},{level:2,members:0,volume:'0'},{level:3,members:0,volume:'0'}]);
 const wrong={...f.provider,send:async()=> '0x38'};
 await assert.rejects(readTeamSnapshot({provider:wrong,config,query:q('wallet='+parent+'&mode=volume')}),/WRONG_CHAIN/);
});

test('API serves team data, sanitizes errors, and preserves other API paths',async()=>{
 const f=fixture(),teamRelay=createTeamRelay(config,{providers:[f.provider]});
 const feed={configured:true,publicConfig:{version:1,chainId:97,vaultAddress:vault},get:async()=>({status:'live',trades:[]})};
 const server=createApiServer(feed,{teamRelay});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const res=await fetch(base+'/api/team/registrations?parent='+parent+'&from=188&to=196');
  assert.equal(res.status,200);
  assert.equal((await res.json()).members.length,1);
  const member=await fetch(base+'/api/team/member?wallet='+child+'&block=195');
  assert.equal(member.status,200);assert.equal((await member.json()).profile.activeDirect,'3');
  assert.equal((await fetch(base+'/api/team/registrations?parent=invalid')).status,400);
  assert.equal((await fetch(base+'/api/config')).status,200);
  f.provider.getLogs=async()=>{throw Error('secret private RPC key');};
  const failed=await fetch(base+'/api/team/registrations?parent='+parent+'&from=188&to=196');
  assert.equal(failed.status,503);
  assert.doesNotMatch(JSON.stringify(await failed.json()),/secret|private RPC key/);
 }finally{teamRelay.close();await new Promise(resolve=>server.close(resolve));}
});
