import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Interface,ZeroAddress,parseEther,keccak256,toUtf8Bytes} from 'ethers';
import {readConfig,createTradeFeed,createApiServer} from '../server/trades-api.mjs';
const address='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222',hash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
const iface=new Interface(['event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)']);
const config=()=>readConfig({TRADES_RPC_URL:'https://rpc.invalid/private-token',TRADES_VAULT_ADDRESS:address,TRADES_CHAIN_ID:'97',TRADES_LOOKBACK_BLOCKS:'10',TRADES_LOG_PAGE_SIZE:'5'});
const log=(asset=token,profit=parseEther('10'))=>({...iface.encodeEventLog(iface.getEvent('SaleSettled'),[hash,address,asset,profit,parseEther('100'),hash]),address,transactionHash:hash,blockHash,blockNumber:95,index:0,removed:false});
function fixture(logs=[log()]){let calls=0;const provider={getNetwork:async()=>({chainId:97n}),getCode:async()=> '0x1234',getBlockNumber:async()=>100,getLogs:async({fromBlock,toBlock})=>{calls++;return logs.filter(l=>l.blockNumber>=fromBlock&&l.blockNumber<=toBlock);},getBlock:async()=>({hash:blockHash,timestamp:1700000000})};return {provider,metadata:async()=>[token,18],get calls(){return calls;}};}
test('API validates network, address, bounded pagination and never defaults to a public live contract',async()=>{
 assert.equal(createTradeFeed(readConfig({})).configured,false);
 for(const env of [{TRADES_CHAIN_ID:'1'},{TRADES_VAULT_ADDRESS:ZeroAddress},{TRADES_LOOKBACK_BLOCKS:'999999'},{TRADES_CONFIRMATIONS:'0'},{TRADES_RPC_URL:'file:///etc/passwd'},{TRADES_PORT:'80'}])assert.throws(()=>readConfig(env));
 const data=await createTradeFeed(readConfig({})).get();assert.equal(data.status,'not_configured');assert.deepEqual(data.trades,[]);
});
test('API returns only confirmed matching events with exact amounts and deduplicates overlapping logs',async()=>{
 const f=fixture([log(),log(),{...log(),blockNumber:99},{...log(),address:token,index:1},{...log(),removed:true,index:2}]);
 const feed=createTradeFeed(config(),f),data=await feed.get();assert.equal(data.status,'live');assert.equal(data.trades.length,1);assert.equal(data.trades[0].grossProfit,'10.0');assert.equal(data.trades[0].salesUsd,'100.0');assert.equal(data.trades[0].confirmations,5);assert.equal(data.testnet,true);assert.match(data.trades[0].explorerUrl,/testnet.bscscan.com/);assert.equal(data.confirmedThrough,97);assert.equal(data.windowStart,88);assert.ok(!JSON.stringify(data).includes('private-token'));
});
test('API handles six-decimal tokens and native BNB without floating point',async()=>{
 const native={...log(ZeroAddress,parseEther('0.123456789012345678')),index:1};const f=fixture([log(token,1234567n),native]);f.metadata=async()=>[token,6];const data=await createTradeFeed(config(),f).get();assert.equal(data.trades[0].grossProfit,'0.123456789012345678');assert.equal(data.trades[1].grossProfit,'1.234567');
});
test('API caches concurrent polls, labels an outage stale, and removes orphaned records after recovery',async()=>{
 let now=0;const f=fixture();const feed=createTradeFeed(config(),{...f,now:()=>now,ttlMs:10});const results=await Promise.all([feed.get(),feed.get(),feed.get()]);assert.equal(f.calls,2);assert.equal(results[0].status,'live');
 const get=f.provider.getLogs;f.provider.getLogs=async()=>{throw Error('secret RPC credential');};now=11;const stale=await feed.get();assert.equal(stale.status,'stale');assert.equal(stale.trades.length,1);assert.ok(!JSON.stringify(stale).includes('secret'));
 f.provider.getLogs=async()=>[];now=22;const recovered=await feed.get();assert.equal(recovered.status,'live');assert.equal(recovered.trades.length,0);f.provider.getLogs=get;
});
test('API refuses wrong chain, missing code, unknown assets and reorg-inconsistent blocks',async()=>{
 for(const kind of ['chain','code','asset','block']){const f=fixture(kind==='asset'?[log('0x3333333333333333333333333333333333333333')]:undefined);if(kind==='chain')f.provider.getNetwork=async()=>({chainId:56n});if(kind==='code')f.provider.getCode=async()=> '0x';if(kind==='block')f.provider.getBlock=async()=>({hash,timestamp:1});const data=await createTradeFeed(config(),f).get();assert.equal(data.status,'unavailable');assert.deepEqual(data.trades,[]);}
});
test('HTTP API is read-only, validates limits, returns configuration status and never serves fabricated trades',async()=>{
 const feed=createTradeFeed(readConfig({})),server=createApiServer(feed);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 try{assert.equal((await fetch(url+'/api/health')).status,200);assert.equal((await fetch(url+'/api/trades')).status,503);assert.equal((await fetch(url+'/api/trades?limit=101')).status,400);assert.equal((await fetch(url+'/api/trades',{method:'POST'})).status,405);assert.equal((await fetch(url+'/anything')).status,404);assert.deepEqual((await (await fetch(url+'/api/trades')).json()).trades,[]);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('integration: an actual local EVM SaleSettled transaction appears in the live HTTP API',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:10}});const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;const signers=await Promise.all(Array.from({length:10},(_,i)=>provider.getSigner(i)));const addresses=await Promise.all(signers.map(x=>x.getAddress()));let server;
 const deploy=async(name,args)=>{const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`));const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;};
 const tx=async p=>(await p).wait(),id=s=>keccak256(toUtf8Bytes(s));
 try{const t=await deploy('MockToken',[6]),f=await deploy('MockFeed',[100000000n]);const v=await deploy('DropshippingVault',[addresses[0],t.target,f.target,f.target,86400,addresses.slice(0,7),addresses[9]]);await tx(v.connect(signers[8]).register(ZeroAddress));await tx(t.mint(addresses[0],10000000n));await tx(t.approve(v.target,10000000n));const receipt=await tx(v.settleSalesProfit(id('actual-sale'),t.target,addresses[8],2500000n,parseEther('125'),id('evidence')));for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  const c={...config(),address:v.target,startBlock:receipt.blockNumber};const feed=createTradeFeed(c,{provider});server=createApiServer(feed);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/trades`);assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,'live');assert.equal(data.trades.length,1);assert.equal(data.trades[0].transactionHash,receipt.hash);assert.equal(data.trades[0].grossProfit,'2.5');assert.equal(data.trades[0].salesUsd,'125.0');assert.equal(data.trades[0].seller,addresses[8]);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await provider.destroy();await rpc.disconnect();}
});
