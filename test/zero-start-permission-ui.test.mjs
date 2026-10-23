import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPermissionProvider,permissionJournalKey,readPermissionIntent,savePermissionIntent,clearPermissionIntent,confirmedPermissionReceipt,permissionErrorText} from '../deployment-console/zero-start-permission.js';

const target='0x23C32Bb326DB63f89532f80e757B8463c75655b8';
const account='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const other='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
const txHash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32);
const prepared={version:1,action:'propose',account,target,chainId:97,round:0,data:'0xbe8f5b59'+'00'.repeat(32),request:{from:account,to:target,value:'0x0',chainId:'0x61'}};
const intent=()=>({version:1,chainId:97,target,account,action:'propose',createdAt:'2026-10-23T01:00:00.000Z',id:'review-1',status:'requesting',hash:null,prepared:structuredClone(prepared)});
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};

test('SafePal injection is preferred without prompting a fallback provider',()=>{
 const safe={request:()=>{throw Error('Selection must not call the wallet');}},otherProvider={request:()=>{throw Error('Selection must not call the wallet');}};
 assert.equal(selectPermissionProvider({safepalProvider:safe,ethereum:otherProvider}),safe);
 assert.equal(selectPermissionProvider({ethereum:{providers:[otherProvider,{...safe,isSafePal:true}]}}).isSafePal,true);
 assert.equal(selectPermissionProvider({ethereum:otherProvider}),otherProvider);
 assert.equal(selectPermissionProvider({}),null);
});

test('wallet fee and pending-transaction blockers explain the required user action without exposing RPC errors',()=>{
 assert.match(permissionErrorText(Error('PERMISSION_OWNER_OR_PARTNER_NEEDS_TEST_BNB')),/official test BNB faucet/);
 assert.match(permissionErrorText(Error('PERMISSION_FEE_CHANGED_REVIEW_REQUIRED')),/Review the action again/);
 assert.match(permissionErrorText(Error('PERMISSION_WALLET_HAS_PENDING_TRANSACTIONS')),/Resolve it in SafePal/);
 assert.match(permissionErrorText(Error('PERMISSION_OWNER_REQUIRED')),/owner wallet/);
 assert.match(permissionErrorText(Error('PERMISSION_TEST_BNB_FEE_LIMIT')),/0.01 test BNB/);
 assert.doesNotMatch(permissionErrorText(Error('RPC failed https://private.invalid/key-secret')),/private|key-secret/);
});

test('a durable unknown-response intent survives reload and blocks a second wallet request',()=>{
 const saved=storage(),entry=intent();savePermissionIntent(saved,entry);
 assert.deepEqual(readPermissionIntent(saved,account),entry);
 assert.throws(()=>savePermissionIntent(saved,{...entry,id:'another-review'}),/already waiting/);
 assert.equal(readPermissionIntent(saved,account).status,'requesting');
 assert.equal(readPermissionIntent(saved,account).hash,null);
 assert.equal(readPermissionIntent(saved,other),null);
});

test('intent persistence fails closed when site storage rejects or loses a write',()=>{
 const entry=intent();
 assert.throws(()=>savePermissionIntent({getItem:()=>null,setItem:()=>{throw Error('quota');}},entry),/could not be saved/);
 assert.throws(()=>savePermissionIntent({getItem:()=>null,setItem:()=>{}},entry),/could not be saved/);
 assert.throws(()=>readPermissionIntent({getItem:()=>{throw Error('blocked');}},account),/storage is unavailable/);
});

test('saved intents cannot change their account, target, chain or valid broadcast hash',()=>{
 for(const mutate of [
  row=>{row.target=other;},row=>{row.chainId=56;},row=>{row.prepared.account=other;},
  row=>{row.prepared.request.to=other;},row=>{row.prepared.request.value='0x1';},
  row=>{row.status='broadcast';row.hash='not-a-hash';}
 ]){
  const saved=storage(),entry=intent();mutate(entry);saved.setItem(permissionJournalKey(account),JSON.stringify(entry));
  assert.throws(()=>readPermissionIntent(saved,account),/cannot be verified/);
 }
});

test('only the same request can acquire a transaction hash or be cleared',()=>{
 const saved=storage(),entry=intent();savePermissionIntent(saved,entry);
 savePermissionIntent(saved,{...entry,status:'broadcast',hash:txHash});
 assert.equal(readPermissionIntent(saved,account).hash,txHash);
 assert.throws(()=>clearPermissionIntent(saved,account,'another-review'),/changed/);
 assert.equal(readPermissionIntent(saved,account).hash,txHash);
 clearPermissionIntent(saved,account,entry.id);assert.equal(readPermissionIntent(saved,account),null);
});

function receiptProvider({head='0xb',chain='0x61',status='0x1',orphan=false,transaction={}}={}){
 return {async request({method}){
  if(method==='eth_getTransactionReceipt')return {transactionHash:txHash,blockHash,blockNumber:'0xa',status};
  if(method==='eth_blockNumber')return head;
  if(method==='eth_chainId')return chain;
  if(method==='eth_getBlockByNumber')return {hash:orphan?'0x'+'33'.repeat(32):blockHash};
  if(method==='eth_getTransactionByHash')return {hash:txHash,from:account,to:target,input:prepared.data,value:'0x0',...transaction};
  throw Error('Unexpected method '+method);
 }};
}

test('a matching receipt waits for three confirmations and distinguishes reverted transactions',async()=>{
 const entry={...intent(),status:'broadcast',hash:txHash};
 assert.equal(await confirmedPermissionReceipt(receiptProvider(),entry),null);
 assert.deepEqual(await confirmedPermissionReceipt(receiptProvider({head:'0xc'}),entry),{hash:txHash,success:true});
 assert.deepEqual(await confirmedPermissionReceipt(receiptProvider({head:'0xc',status:'0x0'}),entry),{hash:txHash,success:false});
});

test('unrelated or orphaned receipts cannot release a saved request',async()=>{
 const entry={...intent(),status:'broadcast',hash:txHash};
 for(const options of [{chain:'0x38'},{orphan:true},{transaction:{from:other}},{transaction:{to:other}},{transaction:{input:'0x'}},{transaction:{value:'0x1'}}]){
  await assert.rejects(()=>confirmedPermissionReceipt(receiptProvider({head:'0xc',...options}),entry),/cannot be verified/);
 }
});

test('a receipt reorganized during verification never becomes confirmed',async()=>{
 const entry={...intent(),status:'broadcast',hash:txHash},provider=receiptProvider({head:'0xc'});let reads=0;
 const request=provider.request.bind(provider);provider.request=async input=>input.method==='eth_getBlockByNumber'&&++reads===2?{hash:'0x'+'44'.repeat(32)}:request(input);
 await assert.rejects(()=>confirmedPermissionReceipt(provider,entry),/cannot be verified/);
});
