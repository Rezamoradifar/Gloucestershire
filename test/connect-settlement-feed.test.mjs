import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress} from 'ethers';
import {discoverSettings,renderSettings,verifyConnection} from '../scripts/connect-settlement-feed.mjs';
import {readConfig} from '../server/trades-api.mjs';
const address='0x1111111111111111111111111111111111111111';
const options={source:'/existing',env:{},read:()=>({}),exists:()=>false};
test('connection discovery preserves the installed target and private RPC over historical reports',()=>{
 const installed={TRADES_RPC_URL:'https://rpc.invalid/private',TRADES_CHAIN_ID:'56',TRADES_VAULT_ADDRESS:address};
 const result=discoverSettings({...options,installed,exists:()=>true,readJson:()=>{throw Error('Historical report should not replace active target');}});
 assert.deepEqual(result,{...installed,TRADES_PORT:'3115'});
});
test('connection discovery uses explicit website target and matching network RPC',()=>{
 const result=discoverSettings({...options,read:file=>file.endsWith('/website/.env')?{VITE_CHAIN_ID:'97',VITE_VAULT_ADDRESS:address}:file==='/existing/.env'?{BSC_TESTNET_RPC:'https://rpc.invalid/test'}:{}});
 assert.equal(result.TRADES_CHAIN_ID,'97');assert.equal(result.TRADES_RPC_URL,'https://rpc.invalid/test');assert.equal(result.TRADES_VAULT_ADDRESS,address);
});
test('connection discovery refuses ambiguous chain reports and explicit chain conflicts',()=>{
 const reports={...options,exists:()=>true,readJson:file=>({chainId:file.includes('.testnet-server')?97:56,contractAddress:address})};
 assert.throws(()=>discoverSettings(reports),/Both testnet and mainnet/);
 assert.throws(()=>discoverSettings({...reports,env:{TRADES_CHAIN_ID:'56'},exists:file=>file.includes('.testnet-server')}),/Requested chain conflicts/);
 const single=discoverSettings({...reports,exists:file=>file.includes('.testnet-server')});
 assert.equal(single.TRADES_CHAIN_ID,'97');assert.equal(single.TRADES_VAULT_ADDRESS,address);assert.equal(single.TRADES_RPC_URL,'');
});
test('settings retain unrelated options, replace duplicate managed keys and safely quote URL fragments',()=>{
 const original='# existing settings\nCUSTOM=keep\nTRADES_RPC_URL=old\nTRADES_RPC_URL=duplicate\n';
 const settings={TRADES_RPC_URL:'https://rpc.invalid/p?a=$value&b=2#fragment',TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:address};
 const text=renderSettings(original,settings),parsed=parseEnv(text);
 assert.equal(parsed.CUSTOM,'keep');assert.equal(parsed.TRADES_RPC_URL,settings.TRADES_RPC_URL);assert.equal(text.match(/^TRADES_RPC_URL=/gm).length,1);
 assert.throws(()=>renderSettings('',{TRADES_RPC_URL:'url\nINJECTED=yes'}),/Unsupported characters/);
});
test('connection preflight refuses a stale/unavailable feed without exposing private RPC errors',async()=>{
 const config=readConfig({TRADES_RPC_URL:'https://rpc.invalid/private',TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:address});
 for(const status of ['stale','unavailable'])await assert.rejects(verifyConnection(config,{provider:{},feedFactory:()=>({get:async()=>({status})})}),/RPC connection check failed/);
});
test('legacy contract connection reports that requested plan checks did not match',async()=>{
 const config=readConfig({TRADES_RPC_URL:'https://rpc.invalid/private',TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:address});
 const result=await verifyConnection(config,{provider:{},feedFactory:()=>({get:async()=>({status:'live',trades:[],latestBlock:99})}),contractFactory:()=>({owner:async()=>address,tierConfig:async()=>{throw Error('Old contract');}})});
 assert.equal(result.requestedPlanChecksMatch,false);assert.equal(result.networkControlsSupported,false);assert.equal(result.transactionsSent,0);assert.ok(!JSON.stringify(result).includes('private'));
});
test('actual local EVM connection verifies all new plan parameters without sending transactions',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:10}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:10},(_,i)=>provider.getSigner(i)));const addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args)=>{const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`));const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;};
 try{
  const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
  const vault=await deploy('DropshippingVault',[addresses[0],token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[9]]);
  const before=await provider.getTransactionCount(addresses[0]);
  const result=await verifyConnection(readConfig({TRADES_RPC_URL:'http://local.invalid',TRADES_VAULT_ADDRESS:vault.target,TRADES_CHAIN_ID:'97'}),{provider});
  assert.equal(result.requestedPlanChecksMatch,true);assert.equal(result.networkControlsSupported,true);assert.equal(result.owner,addresses[0]);assert.equal(result.settlementsInWindow,0);assert.equal(await provider.getTransactionCount(addresses[0]),before);
  await assert.rejects(verifyConnection(readConfig({TRADES_RPC_URL:'http://local.invalid',TRADES_VAULT_ADDRESS:addresses[8],TRADES_CHAIN_ID:'97'}),{provider}),/RPC connection check failed/);
 }finally{await provider.destroy();await rpc.disconnect();}
});
