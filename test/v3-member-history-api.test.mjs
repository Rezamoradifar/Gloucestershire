import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Interface,ZeroAddress,toBeHex} from 'ethers';
import {createV3MemberHistory} from '../server/v3-member-history.mjs';
import {createApiServer} from '../server/trades-api.mjs';
import {PORTFOLIO_PROFILE,UNIFIED_TOKEN} from '../scripts/v3-unified-release-pins.mjs';

const vault=toBeHex(16,20),wallet=toBeHex(20,20),other=toBeHex(21,20),network=toBeHex(22,20);
const proof={chainId:97,status:PORTFOLIO_PROFILE.status,token:UNIFIED_TOKEN,vault,network,
  deploymentBlock:100,deploymentTx:toBeHex(42,32)};
const block=n=>({number:n,hash:toBeHex(n,32),timestamp:1000+n});
const abi=new Interface(['event CheckIn(address indexed user,uint256 at)',
  'event WithdrawalApproved(uint256 indexed id,address indexed manager)']);
const record=(name,values,n,index=0)=>{
  const data=abi.encodeEventLog(name,values);
  return {address:vault,...data,blockNumber:n,blockHash:block(n).hash,index,transactionHash:toBeHex(n+1000,32)};
};
const entries=[record('CheckIn',[wallet,1100],105),record('CheckIn',[other,1100],106),
  record('WithdrawalApproved',[9,other],108),record('WithdrawalApproved',[10,other],109)];
const q=(values={})=>new URLSearchParams({wallet,vault,...values});
const anchored={anchor:'120',hash:block(120).hash};
function fixture(options={}) {
  let logReads=0,identityReads=0,receiptReads=0;
  const provider={
    send:async()=> '0x61',getBlock:async n=>block(n),getBlockNumber:async()=>123,
    getTransactionReceipt:async tx=>{
      receiptReads++;
      if(tx===proof.deploymentTx)return {blockHash:block(100).hash};
      const row=entries.find(l=>l.transactionHash===tx);
      return row?{hash:tx,blockNumber:row.blockNumber,blockHash:row.blockHash}:null;
    },
    getLogs:async({address,topics,fromBlock,toBlock})=>{
      logReads++;
      if(options.limit && toBlock-fromBlock+1>options.limit)throw Object.assign(Error('block range limit'),{code:-32005});
      return entries.filter(l=>l.address===address && l.blockNumber>=fromBlock && l.blockNumber<=toBlock &&
        topics.every((topic,i)=>topic===null || (Array.isArray(topic)?topic.includes(l.topics[i]):l.topics[i]===topic)));
    },...options.provider,
  };
  const stubVault={userWithdrawalCount:async()=>1n,userWithdrawalId:async()=>9n,
    withdrawalOf:async id=>({beneficiary:id===9n?wallet:other,kind:4n,status:1n,gross:10000n,fee:200n,requestedAt:1107n,positionId:0n}),
    withdrawalAllocation:async()=>({personal:5000n,referral:3000n,network:2000n,principal:0n}),...options.vault};
  const reader=createV3MemberHistory({proofs:[proof],providers:[provider],
    verifyRelease:async()=>{identityReads++;return {proof};},makeVault:()=>stubVault});
  return {reader,provider,stubVault,calls:()=>({logReads,identityReads,receiptReads})};
}

test('bootstrap, transaction and UTC search ranges are anchored to the verified vault deployment',async()=>{
  const {reader,calls}=fixture();
  const scope=await reader.get(q());
  assert.deepEqual(scope.anchor,{firstBlock:100,block:120,hash:block(120).hash});
  assert.deepEqual(scope.range,{from:100,to:120});assert.deepEqual(scope.logs,[]);
  assert.deepEqual((await reader.get(q({...anchored,tx:entries[0].transactionHash}))).range,{from:105,to:105});
  assert.deepEqual((await reader.get(q({...anchored,tx:toBeHex(555,32)}))).range,{from:100,to:120});
  assert.deepEqual((await reader.get(q({...anchored,start:'1107',end:'1110'}))).range,{from:107,to:109});
  assert.deepEqual((await reader.get(q({...anchored,start:'1300'}))).range,{from:121,to:120});
  assert.equal(calls().identityReads,1);
});

test('pages verify wallet and manager actions, transactions, time, adaptive bounds and shared immutable cache',async()=>{
  const {reader,calls}=fixture({limit:8});
  const params=q({...anchored,from:'100',to:'110'});
  const [a,b]=await Promise.all([reader.get(params),reader.get(params)]);
  assert.deepEqual(a,b);assert.deepEqual(a.range,{from:105,to:110});
  assert.deepEqual(a.logs.map(x=>x.blockNumber),[108,105]);assert.deepEqual(a.requestIds,[toBeHex(9,32)]);
  assert.equal(a.logs[0].timestamp,1108);const initial=calls().logReads;
  assert.deepEqual(await reader.get(params),a);assert.equal(calls().logReads,initial);
  const after=await reader.get(q({...anchored,from:'100',to:'104'}));assert.deepEqual(after.logs,[]);
  const large=fixture({vault:{userWithdrawalCount:async()=>1000n}});
  const rows=await large.reader.get(q({...anchored,from:'103',to:'110',category:'withdrawals'}));
  assert.deepEqual(rows.logs.map(x=>x.transactionHash),[entries[2].transactionHash]);assert.deepEqual(rows.requestIds,[toBeHex(9,32)]);
});

test('an unverified or changed page fails even if the old page was previously cached',async()=>{
  const {reader,provider}=fixture();
  const scope=q({...anchored,from:'101',to:'110'});await reader.get(scope);
  provider.getBlock=async n=>n===120?{...block(n),hash:toBeHex(333,32)}:block(n);
  await assert.rejects(reader.get(scope),{historyStatus:409});
  const corrupted=fixture({provider:{getLogs:async()=>[entries[1]]}});
  await assert.rejects(corrupted.reader.get(scope),{historyStatus:503});
  const missing=fixture({provider:{getLogs:async()=>{throw Error('historical logs unavailable');}}});
  await assert.rejects(missing.reader.get(scope),{historyStatus:503});
});

test('sources, profile, query range, amounts and per-wallet withdrawal results are checked',async()=>{
  const {reader}=fixture();
  for(const values of [{url:'https://unused.example/'},{wallet:ZeroAddress},{from:100,to:101},
    {...anchored,from:'99',to:'101'}, {vault:'xxx'}, {page:2}, {to:7}, {start:110,end:109}]){
    await assert.rejects(reader.get(q(values)),{historyStatus:400});
  }
  await assert.rejects(reader.get(q({vault:other})),{historyStatus:503});
  const value=await reader.get(q({page:0}), 'withdrawals');
  assert.equal(value.total,1);assert.equal(value.items[0].beneficiary,wallet);
  assert.equal(value.items[0].gross,'10000');assert.deepEqual(value.items[0].allocation,
    {personal:'5000',referral:'3000',network:'2000',principal:'0'});
  await assert.rejects(reader.get(q({page:1}),'withdrawals'),{historyStatus:400});
  const corrupt=fixture({vault:{withdrawalAllocation:async()=>({personal:0n,referral:0n,network:0n,principal:0n})}});
  await assert.rejects(corrupt.reader.get(q(),'withdrawals'),{historyStatus:503});
  for (const patch of [{kind:0n}, {requestedAt:0n}]) {
    const row = await fixture().stubVault.withdrawalOf(9n);
    const invalid = fixture({vault:{withdrawalOf:async()=>({...row,...patch})}});
    await assert.rejects(invalid.reader.get(q(),'withdrawals'),{historyStatus:503});
  }
  const wrong=fixture({provider:{send:async()=> '0x38'}});
  await assert.rejects(wrong.reader.get(q()),{historyStatus:503});
});

test('both member history routes are served over the actual API with clean failures and GET-only access',async()=>{
  const {reader}=fixture();const server=createApiServer({publicConfig:{}},{memberHistory:reader});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    for(const suffix of ['member-history','member-withdrawals']){
      const url='http://127.0.0.1:'+server.address().port+'/api/v3/'+suffix;
      const success=await fetch(url+'?'+q());assert.equal(success.status,200);
      const body=await success.json();assert.equal(body.wallet,wallet);assert.equal(body.chainId,97);
      assert.equal((await fetch(url,{method:'POST'})).status,405);
      const bad=await fetch(url);assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{error:'Invalid member history request.'});
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
