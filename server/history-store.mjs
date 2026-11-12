// Durable read-through cache for *confirmed and RPC-verified* contract logs.
// The database is not the source of truth and is never used for balances,
// earned rewards, withdrawal state, registration eligibility, or payments.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const safe=value=>Number.isSafeInteger(value)&&value>=0;
function key(config,query){
 return [config.chainId,config.address.toLowerCase(),query.wallet.toLowerCase(),
  query.asset.toLowerCase(),query.scope,query.kind,query.from,query.to];
}
export function createVerifiedHistoryStore(file='/var/lib/globaldroptrade-api/verified-history.sqlite'){
 if(!path.isAbsolute(file))throw Error('HISTORY_DB_ABSOLUTE_PATH_REQUIRED');
 const folder=path.dirname(file);
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(stat&&(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0))
  throw Error('HISTORY_DB_UNSAFE_FILE');
 const db=new DatabaseSync(file);
 fs.chmodSync(file,0o600);
 db.exec(`CREATE TABLE IF NOT EXISTS verified_history_pages (
   chain_id INTEGER NOT NULL, vault TEXT NOT NULL, wallet TEXT NOT NULL,
   asset TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL,
   first_block INTEGER NOT NULL, last_block INTEGER NOT NULL,
   checkpoint_hash TEXT NOT NULL, snapshot TEXT NOT NULL,
   saved_at INTEGER NOT NULL,
   PRIMARY KEY(chain_id,vault,wallet,asset,scope,kind,first_block,last_block)
 );`);
 const find=db.prepare(`SELECT snapshot FROM verified_history_pages
  WHERE chain_id=? AND vault=? AND wallet=? AND asset=? AND scope=? AND kind=?
   AND first_block=? AND last_block=?`);
 const insert=db.prepare(`INSERT OR REPLACE INTO verified_history_pages
  (chain_id,vault,wallet,asset,scope,kind,first_block,last_block,checkpoint_hash,snapshot,saved_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
 const purge=db.prepare(`DELETE FROM verified_history_pages WHERE rowid IN (
   SELECT rowid FROM verified_history_pages ORDER BY saved_at DESC,rowid DESC LIMIT -1 OFFSET 20000
 )`);
 let writes=0;
 return {
  get(config,query){
   if(!safe(query?.from)||!safe(query?.to))return null;
   const row=find.get(...key(config,query));
   if(!row)return null;
   try{
    const snapshot=JSON.parse(row.snapshot);
    if(snapshot.version!==1||snapshot.chainId!==config.chainId||
     snapshot.vaultAddress.toLowerCase()!==config.address.toLowerCase()||
     snapshot.wallet.toLowerCase()!==query.wallet.toLowerCase()||
     snapshot.asset.toLowerCase()!==query.asset.toLowerCase()||
     snapshot.scope!==query.scope||snapshot.kind!==query.kind||
     snapshot.first!==query.from||snapshot.last!==query.to||
     !hash(snapshot.windowHash)||!hash(snapshot.runtimeHash)||!Array.isArray(snapshot.logs)||snapshot.logs.length>250)
     return null;
    return snapshot;
   }catch{return null;}
  },
  put(config,query,snapshot){
   if(!safe(query?.from)||!safe(query?.to)||snapshot?.first!==query.from||
    snapshot.last!==query.to||!hash(snapshot.windowHash)||!hash(snapshot.runtimeHash)||
    !Array.isArray(snapshot.logs)||snapshot.logs.length>250)
    throw Error('HISTORY_DB_VERIFIED_PAGE_REQUIRED');
   insert.run(...key(config,query),snapshot.windowHash,JSON.stringify(snapshot),Date.now());
   if(++writes%100===0)purge.run(); // bounded cache, older pages remain recoverable from RPC
  },
  close(){db.close();}
 };
}
