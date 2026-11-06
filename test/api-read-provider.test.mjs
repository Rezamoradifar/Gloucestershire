import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Contract,Interface,ZeroAddress} from 'ethers';
import {createApiReadProvider} from '../server/trades-api.mjs';

const address='0x1111111111111111111111111111111111111111';
const owner='0x2222222222222222222222222222222222222222';
const wallet='0x3333333333333333333333333333333333333333';
const blockHash='0x'+'ab'.repeat(32);
const abi=['function owner() view returns(address)','function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)'];
const iface=new Interface(abi);
const block={number:'0x64',hash:blockHash,parentHash:'0x'+'cd'.repeat(32),timestamp:'0x6553f100',nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x100000',gasUsed:'0x0',miner:ZeroAddress,extraData:'0x',transactions:[]};

async function rpcFixture(options={}){
 const state={chainId:97,code:'0x60006000',error:false,stalled:false,nullBlock:false,requests:[],...options};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  const request=JSON.parse(body);state.requests.push({...request,observedChain:state.chainId});
  if(state.stalled)return;
  let result,error;
  try{
   if(state.error)throw Error('Private upstream credential: rpc-secret-token');
   if(request.method==='eth_chainId')result='0x'+state.chainId.toString(16);
   else if(request.method==='eth_getCode')result=state.code;
   else if(request.method==='eth_blockNumber')result='0x64';
   else if(request.method==='eth_getBlockByNumber')result=state.nullBlock?null:block;
   else if(request.method==='eth_call'){
    assert.equal(request.params[0].to.toLowerCase(),address.toLowerCase());
    const call=iface.parseTransaction({data:request.params[0].data});
    if(call.name==='owner')result=iface.encodeFunctionResult('owner',[owner]);
    else{assert.equal(call.name,'users');assert.equal(call.args[0],wallet);result=iface.encodeFunctionResult('users',[ZeroAddress,true,true,false,2,123456789012345678901n,99n]);}
   }else throw Error('Unexpected RPC method');
  }catch(cause){error={code:-32000,message:cause.message};}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,...(error?{error}:{result})}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {state,url:`http://127.0.0.1:${server.address().port}/rpc-secret-token`,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function providerFor(fixtures,options){return createApiReadProvider({chainId:97,address,rpcUrls:fixtures.map(value=>value.url)},options);}
async function withFixtures(options,run){
 const fixtures=await Promise.all(options.map(value=>rpcFixture(value)));let provider;
 try{provider=providerFor(fixtures);await run(provider,fixtures);}finally{provider?.destroy();await Promise.all(fixtures.map(value=>value.close()));}
}

test('read-only runner rejects a wrong-chain primary and supports actual ethers Contract reads through the backup',async()=>{
 await withFixtures([{chainId:56},{}],async(provider,[wrong,healthy])=>{
  assert.equal(provider.provider,provider);assert.ok(Object.isFrozen(provider));
  for(const method of ['send','getSigner','signMessage','sendTransaction','broadcastTransaction'])assert.equal(provider[method],undefined);
  assert.equal((await provider.getNetwork()).chainId,97n);
  assert.equal(await provider.getBlockNumber(),100);
  const confirmedBlock=await provider.getBlock(100);assert.equal(confirmedBlock.hash,blockHash);
  assert.equal(confirmedBlock.provider,provider);assert.equal(confirmedBlock.provider.send,undefined);
  assert.equal(await provider.getCode(address),'0x60006000');
  assert.equal(await provider.resolveName(wallet),wallet);
  await assert.rejects(provider.resolveName('wallet.eth'),{code:'API_READ_UNAVAILABLE'});
  const vault=new Contract(address,abi,provider);
  assert.equal(await vault.owner(),owner);
  const user=await vault.users(wallet,{blockTag:100});
  assert.equal(user.registered,true);assert.equal(user.activeDirect,2n);assert.equal(user.capitalUsd,123456789012345678901n);
  assert.equal(wrong.state.requests.some(value=>value.method==='eth_call'),false);
  const userCall=healthy.state.requests.filter(value=>value.method==='eth_call').at(-1);
  assert.equal(userCall.params[1],'0x64');
 });
});

test('a missing configured vault or missing block cannot win against a valid backup',async()=>{
 await withFixtures([{code:'0x'},{}],async(provider,[empty])=>{
  assert.equal(await new Contract(address,abi,provider).owner(),owner);
  assert.equal(empty.state.requests.some(value=>value.method==='eth_call'),false);
  empty.state.code='0x60006000';empty.state.nullBlock=true;
  assert.equal((await provider.getBlock(100)).hash,blockHash);
 });
});

test('each read checks the current chain and a repaired endpoint can be used again',async()=>{
 await withFixtures([{}, {chainId:56}],async(provider,[first,second])=>{
  assert.equal((await provider.getNetwork()).chainId,97n);
  first.state.chainId=56;second.state.chainId=97;
  assert.equal(await new Contract(address,abi,provider).owner(),owner);
  assert.equal(first.state.requests.some(value=>value.method==='eth_call'),false);
  first.state.chainId=97;second.state.chainId=56;
  assert.equal(await new Contract(address,abi,provider).owner(),owner);
  assert.ok(first.state.requests.some(value=>value.method==='eth_call'));
  for(const fixture of [first,second])assert.equal(fixture.state.requests.some(value=>value.method==='eth_call'&&value.observedChain!==97),false);
 });
});

test('construction is lazy and a total RPC failure fails closed without returning upstream details',async()=>{
 await withFixtures([{error:true},{error:true}],async(provider,fixtures)=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(fixtures.every(value=>value.state.requests.length===0));
  await assert.rejects(provider.getNetwork(),error=>{
   assert.equal(error.code,'API_READ_UNAVAILABLE');assert.equal(error.message,'API read unavailable');
   assert.equal(error.cause,undefined);assert.equal(error.errors,undefined);
   assert.ok(!String(error.stack).includes('rpc-secret-token'));return true;
  });
  assert.equal(fixtures.some(value=>value.state.requests.some(request=>request.method==='eth_call')),false);
 });
});

test('a stalled candidate does not delay the healthy backup and all stalled reads have a bounded deadline',async()=>{
 const fixtures=await Promise.all([rpcFixture({stalled:true}),rpcFixture({})]);
 let provider=providerFor(fixtures,{timeoutMs:500});
 try{
  assert.equal(await new Contract(address,abi,provider).owner(),owner);
  provider.destroy();fixtures[1].state.stalled=true;
  provider=providerFor(fixtures,{timeoutMs:75});
  const started=Date.now();await assert.rejects(provider.getBlockNumber(),{code:'API_READ_UNAVAILABLE'});
  assert.ok(Date.now()-started<1000);
  const pending=provider.getNetwork();provider.destroy();
  await assert.rejects(pending,{code:'API_READ_UNAVAILABLE'});
  await assert.rejects(provider.getNetwork(),{code:'API_READ_UNAVAILABLE'});
 }finally{provider.destroy();await Promise.all(fixtures.map(value=>value.close()));}
});
