// Durable, signer-free, BNB TESTNET V2 event history indexer.
// Uses Node 22 node:sqlite. Does not modify the vault, old worker, API or journals.
// Backfills confirmed blocks and stores raw canonical contract events for
// independent reconciliation. No identity documents, private keys or EOA sends.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {FetchRequest,JsonRpcProvider,keccak256,getAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';

const CHAIN=97;
const V2_ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const V2_CODE_HASH='0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99';
const START_BLOCK=142416836;
const DATABASE='/var/lib/globaldroptrade-v2/events.sqlite';
const REORG_WINDOW=72;
const BATCH_BLOCKS=200;
const CONFIRMATIONS=6;
const fail=reason=>{throw Error(reason);};
const hash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
const hexData=value=>typeof value==='string'&&/^0x(?:[a-fA-F0-9]{2})*$/.test(value);
const int=value=>Number.isSafeInteger(value)&&value>=0;

export class GlobalV2EventIndex {
 constructor(file,{chainId=CHAIN,vaultAddress=V2_ADDRESS,startBlock=START_BLOCK}={}){
  this.chainId=chainId;this.vaultAddress=getAddress(vaultAddress);this.startBlock=startBlock;
  if(chainId!==CHAIN||!int(startBlock)||startBlock<1)fail('V2_INDEX_IDENTITY_INVALID');
  if(file!==':memory:'){
   const dir=path.dirname(file);
   fs.mkdirSync(dir,{recursive:true,mode:0o700});
   const st=fs.lstatSync(dir);
   if(!st.isDirectory()||(process.getuid?.()===0&&st.uid!==0)||
      (st.mode&0o022)!==0)fail('V2_INDEX_DIRECTORY_UNSAFE');
   if(fs.existsSync(file)){
    const stFile=fs.lstatSync(file);
    if(!stFile.isFile()||(stFile.mode&0o077)!==0||
      (process.getuid?.()===0&&stFile.uid!==0))fail('V2_INDEX_DATABASE_UNSAFE');
   }
  }
  this.db=new DatabaseSync(file);
  if(file!==':memory:')fs.chmodSync(file,0o600);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
  this.db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);'
   +'CREATE TABLE IF NOT EXISTS checkpoint(height INTEGER PRIMARY KEY,hash TEXT NOT NULL);'
   +'CREATE TABLE IF NOT EXISTS logs(chain INTEGER NOT NULL,vault TEXT NOT NULL,height INTEGER NOT NULL,block_hash TEXT NOT NULL,'
   +'tx_hash TEXT NOT NULL,log_index INTEGER NOT NULL,topic0 TEXT,topic1 TEXT,topic2 TEXT,topic3 TEXT,data TEXT NOT NULL,'
   +'PRIMARY KEY(chain,vault,tx_hash,log_index));'
   +'CREATE INDEX IF NOT EXISTS logs_height ON logs(height);'
   +'CREATE INDEX IF NOT EXISTS logs_topics ON logs(topic1,topic2,topic3);');
  const read=this.db.prepare('SELECT v FROM meta WHERE k=?');
  const put=this.db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
  for(const [key,value] of [['schema','1'],['chain',String(chainId)],
   ['vault',this.vaultAddress.toLowerCase()],['start',String(startBlock)]]){
   const existing=read.get(key);
   if(existing&&existing.v!==value)fail('V2_INDEX_SOURCE_IDENTITY_CHANGED');
   put.run(key,value);
  }
  if(!read.get('cursor'))put.run('cursor',String(startBlock-1));
 }
 get cursor(){
  return Number(this.db.prepare('SELECT v FROM meta WHERE k=?').get('cursor')?.v);
 }
 get logCount(){
  return Number(this.db.prepare('SELECT count(*) as n FROM logs').get().n);
 }
 get latestCheckpoint(){
  return this.db.prepare('SELECT height,hash FROM checkpoint ORDER BY height DESC LIMIT 1').get()||null;
 }
 checkpointAtOrBefore(height){
  return this.db.prepare('SELECT height,hash FROM checkpoint WHERE height<=? ORDER BY height DESC LIMIT 1').get(height)||null;
 }
 close(){this.db.close();}
 transaction(callback){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const value=callback();
   this.db.exec('COMMIT');return value;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 rewind(height){
  if(!int(height)||height<this.startBlock-1||height>this.cursor)fail('V2_INDEX_REWIND_INVALID');
  return this.transaction(()=>{
   this.db.prepare('DELETE FROM logs WHERE height>?').run(height);
   this.db.prepare('DELETE FROM checkpoint WHERE height>?').run(height);
   this.db.prepare('UPDATE meta SET v=? WHERE k=?').run(String(height),'cursor');
  });
 }
 record(from,to,endHash,logs){
  if(!int(from)||!int(to)||from>to||from!==this.cursor+1||!hash(endHash)||
    !Array.isArray(logs)||logs.length>10000)fail('V2_INDEX_RANGE_INVALID');
  for(const row of logs){
   if(!int(row.blockNumber)||row.blockNumber<from||row.blockNumber>to||
     !hash(row.blockHash)||!hash(row.transactionHash)||!int(row.index)||
     !Array.isArray(row.topics)||row.topics.length>4||
     !row.topics.every(hash)||!hexData(row.data)||
     row.address?.toLowerCase()!==this.vaultAddress.toLowerCase())
    fail('V2_INDEX_LOG_INVALID');
  }
  return this.transaction(()=>{
   const add=this.db.prepare('INSERT INTO logs(chain,vault,height,block_hash,tx_hash,log_index,'
    +'topic0,topic1,topic2,topic3,data) VALUES(?,?,?,?,?,?,?,?,?,?,?) '
    +'ON CONFLICT(chain,vault,tx_hash,log_index) DO UPDATE SET '
    +'height=excluded.height,block_hash=excluded.block_hash,topic0=excluded.topic0,'
    +'topic1=excluded.topic1,topic2=excluded.topic2,topic3=excluded.topic3,data=excluded.data');
   for(const row of logs){
    add.run(this.chainId,this.vaultAddress.toLowerCase(),row.blockNumber,row.blockHash.toLowerCase(),
     row.transactionHash.toLowerCase(),row.index,
     ...(Array.from({length:4},(_,i)=>row.topics[i]?.toLowerCase()??null)),row.data.toLowerCase());
   }
   this.db.prepare('INSERT INTO checkpoint(height,hash) VALUES(?,?) ON CONFLICT(height) DO UPDATE SET hash=excluded.hash')
    .run(to,endHash.toLowerCase());
   this.db.prepare('UPDATE meta SET v=? WHERE k=?').run(String(to),'cursor');
  });
 }
 status(){
  return {version:1,chainId:this.chainId,vault:this.vaultAddress,startBlock:this.startBlock,
   cursor:this.cursor,rawEvents:this.logCount,latestCheckpoint:this.latestCheckpoint,
   containsPrivateKeys:false,financialLedgerAuthority:false,coverage:'CONFIRMED_INDEXED_BLOCKS_ONLY'};
 }
}

async function verifiedLogs(provider,from,to){
 try{
  const rows=await provider.getLogs({address:V2_ADDRESS,fromBlock:from,toBlock:to});
  if(rows.length>10000)fail('V2_INDEX_RESULT_TOO_LARGE');
  return rows;
 }catch(error){
  if(from===to)throw Error('V2_INDEX_SINGLE_BLOCK_LOG_FAILURE');
  const middle=Math.floor((from+to)/2);
  return [...await verifiedLogs(provider,from,middle),...await verifiedLogs(provider,middle+1,to)];
 }
}
export async function syncGlobalV2Index({provider,index,confirmations=CONFIRMATIONS,batchSize=BATCH_BLOCKS,
 expectedCodeHash=V2_CODE_HASH,chainId=CHAIN,expectedAddress=V2_ADDRESS}){
 if(chainId!==CHAIN||getAddress(expectedAddress)!==index.vaultAddress||
  !int(confirmations)||confirmations<3||confirmations>32||
  !int(batchSize)||batchSize<1||batchSize>2000)
  fail('V2_INDEX_POLICY_INVALID');
 if(Number(await provider.send('eth_chainId',[]))!==chainId)
  fail('V2_INDEX_CHAIN_MISMATCH');
 const head=await provider.getBlockNumber();
 const confirmed=head-confirmations;
 if(confirmed<index.startBlock)fail('V2_INDEX_CONTRACT_BLOCK_NOT_CONFIRMED');
 const code=await provider.getCode(expectedAddress,confirmed);
 if(code==='0x'||keccak256(code).toLowerCase()!==expectedCodeHash.toLowerCase())
  fail('V2_INDEX_CODE_HASH_MISMATCH');
 // Rewind and repeat the unfinalized tail on every update. Before removing it,
 // check the last stable checkpoint. A deeper reorg halts for manual review.
 const current=index.cursor;
 if(current>=index.startBlock){
  const protectedAnchor=index.checkpointAtOrBefore(Math.max(index.startBlock-1,current-REORG_WINDOW));
  if(protectedAnchor){
   const canonical=await provider.getBlock(protectedAnchor.height);
   if(!canonical||canonical.hash?.toLowerCase()!==protectedAnchor.hash)
    fail('V2_INDEX_DEEP_REORG_MANUAL_REVIEW');
   index.rewind(protectedAnchor.height);
  }else index.rewind(index.startBlock-1);
 }
 let count=0;
 for(let from=index.cursor+1;from<=confirmed;){
  const to=Math.min(confirmed,from+batchSize-1);
  const first=await provider.getBlock(to);
  if(!first?.hash)fail('V2_INDEX_CANONICAL_BLOCK_MISSING');
  const logs=await verifiedLogs(provider,from,to);
  const last=await provider.getBlock(to);
  if(first.hash.toLowerCase()!==last?.hash?.toLowerCase())
   fail('V2_INDEX_BLOCK_CHANGED_DURING_SCAN');
  // A log references the canonical block hash; different hashes are never
  // silently included. If a provider is inconsistent, stop before committing.
  const byBlock=new Map();
  for(const log of logs){
   if(!byBlock.has(log.blockNumber))byBlock.set(log.blockNumber,[]);
   byBlock.get(log.blockNumber).push(log);
  }
  for(const [height,items] of byBlock){
   const canonical=await provider.getBlock(height);
   if(!canonical?.hash||items.some(x=>x.blockHash.toLowerCase()!==canonical.hash.toLowerCase()))
    fail('V2_INDEX_REORG_LOG_MISMATCH');
  }
  index.record(from,to,last.hash,logs);
  count+=logs.length;from=to+1;
 }
 return {...index.status(),confirmedHead:confirmed,eventsScannedThisRun:count};
}
async function main(){
 if(process.argv.length!==3||!['--check','--sync'].includes(process.argv[2]))
  fail('V2_INDEX_USAGE_CHECK_OR_SYNC');
 if(process.getuid?.()!==0)fail('V2_INDEX_ROOT_REQUIRED');
 const config=readConfig();
 if(config.chainId!==97||!config.rpcUrl)fail('V2_INDEX_TESTNET_RPC_REQUIRED');
 const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
 const provider=new JsonRpcProvider(request,CHAIN,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 let index;
 try{
  if(process.argv[2]==='--check'){
   const head=await provider.getBlockNumber();
   const code=await provider.getCode(V2_ADDRESS,head-6);
   if(Number(await provider.send('eth_chainId',[]))!==CHAIN||
    code==='0x'||keccak256(code).toLowerCase()!==V2_CODE_HASH)
    fail('V2_INDEX_TARGET_UNVERIFIED');
   console.log('V2_INDEX_PREFLIGHT '+JSON.stringify({chainId:CHAIN,address:V2_ADDRESS,
    confirmedHead:head-6,willModifyHistory:false,source:'READ_ONLY_TESTNET'}));
   return;
  }
  index=new GlobalV2EventIndex(DATABASE);
  const result=await syncGlobalV2Index({provider,index});
  console.log('V2_INDEX_SYNC '+JSON.stringify(result));
 }finally{index?.close();provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await main();}catch(e){
  console.error(/^[A-Z][A-Z0-9_]+$/.test(e?.message||'')?e.message:'V2_INDEX_RPC_OR_STORAGE_FAILED');
  process.exitCode=1;
 }
}
