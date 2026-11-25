// Server-side reader for the isolated, verified chain-97 member portfolios.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,getAddress,toBeHex,zeroPadValue} from 'ethers';
import {PLAN_PORTFOLIO_PROFILE,PORTFOLIO_PROFILE,UNIFIED_DEPLOYER} from '../scripts/v3-unified-release-pins.mjs';
import {verifyUnifiedRelease} from '../scripts/verify-v3-unified-release.mjs';

const hash = value => typeof value==='string' && /^0x[0-9a-f]{64}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value>=0;
const check = ok => { if (!ok) throw Error('Inconsistent member history data'); };
const failures = {400:'Invalid member history request.',409:'The confirmed history changed. Refresh history.',
  429:'The history service is busy. Please retry.',503:'Verified member history is temporarily unavailable.'};
function fail(status) { throw Object.assign(Error(failures[status]),{historyStatus:status}); }
export function memberHistoryFailure(error) {
  const status = Object.hasOwn(failures,error?.historyStatus) ? error.historyStatus : 503;
  return {status,error:failures[status]};
}

const eventDefinitions = [
  ['vault',1,'deposits','DepositRouted(address indexed user,uint256 indexed positionId,uint256 amount,uint256 fee1,uint256 fee2,uint256 operations)'],
  ['vault',1,'earnings','DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)'],
  ['vault',1,'earnings','ReferralClaimAccrued(address indexed upline,address indexed source,uint8 level,uint256 amount)'],
  ['vault',1,'earnings','NetworkClaimAccrued(address indexed user,uint256 indexed group,uint256 amount,uint8 stages)'],
  ['vault',1,'earnings','AccountEarningsReinvested(address indexed user,uint256 indexed positionId,uint256 personal,uint256 referral,uint256 network,uint256 total)'],
  ['vault',1,'earnings','ProfitReinvested(address indexed user,uint256 indexed fromPosition,uint256 newPositionId,uint256 amount)'],
  ['vault',1,'account','CheckIn(address indexed user,uint256 at)'],
  ['vault',1,'account','StatusChanged(address indexed user,bool suspended)'],
  ['vault',2,'withdrawals','WithdrawalRequested(uint256 indexed id,address indexed user,uint8 kind,uint256 gross,uint256 fee)'],
  ['vault',2,'withdrawals','AccountWithdrawalAllocated(uint256 indexed id,address indexed user,uint256 personal,uint256 referral,uint256 network,uint256 principal)'],
  ['vault',2,'withdrawals','WithdrawalPaid(uint256 indexed id,address indexed beneficiary,uint256 net,uint256 fee)'],
  ['vault','request','withdrawals','WithdrawalApproved(uint256 indexed id,address indexed manager)'],
  ['vault','request','withdrawals','WithdrawalEscrowFunded(uint256 indexed id,address indexed funder,uint256 gross)'],
  ['vault','request','withdrawals','WithdrawalExistingCashReserved(uint256 indexed id,uint256 gross)'],
  ['vault','request','withdrawals','WithdrawalReleased(uint256 indexed id,uint8 status)'],
  ['network',2,'account','NetworkVolumeQueued(uint256 indexed job,address indexed source,uint256 usd)'],
  ['network',1,'account','RewardGroupCreated(address indexed user,uint256 indexed group,address[] branches)'],
  ['network',1,'account','RewardBranchesAdded(address indexed user,uint256 indexed group,address[] branches)'],
  ['network',1,'account','NetworkRewardPrepared(address indexed user,uint256 indexed group,uint8 stage,uint256 preparedUsd,uint256 cursor)'],
  ['network',1,'earnings','NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd)'],
  ['network',1,'account','CyclePrepared(address indexed user,uint256 indexed group,uint256 cycle,uint256 preparedUsd,uint256 cursor)'],
  ['network',1,'earnings','CycleEarned(address indexed user,uint256 indexed group,uint256 cycle,uint256 volumeUsd,uint256 rewardUsd)'],
  ['token',1,'account','Approval(address indexed owner,address indexed spender,uint256 value)'],
];
const events = new Interface(eventDefinitions.map(([, , , signature]) => 'event '+signature));
const eventTypes = eventDefinitions.map(([source,position,category,signature]) => ({
  source,position,category,topic:events.getEvent(signature.slice(0,signature.indexOf('('))).topicHash,
}));
const vaultAbi = [
  'function MANAGER_ROLE() view returns(bytes32)',
  'function hasRole(bytes32,address) view returns(bool)',
  'function userWithdrawalCount(address) view returns(uint256)',
  'function userWithdrawalId(address,uint256) view returns(uint256)',
  'function withdrawalOf(uint256) view returns(tuple(address beneficiary,uint256 positionId,uint256 gross,uint256 fee,uint64 requestedAt,uint8 status,uint8 kind))',
  'function withdrawalAllocation(uint256) view returns(uint256 personal,uint256 referral,uint256 network,uint256 principal)',
];

function queryFor(params,kind) {
  if (!['events','withdrawals'].includes(kind)) fail(400);
  const keys=[...params.keys()],allowed=['wallet','vault','anchor','hash',
    ...(kind==='withdrawals'?['page']:['tx','start','end','from','to','category'])];
  if (keys.length!==new Set(keys).size || keys.some(k=>!allowed.includes(k))) fail(400);
  const number = name => {
    const value=params.get(name);
    if (value===null) return undefined;
    if (!/^(0|[1-9]\d{0,15})$/.test(value) || !integer(Number(value))) fail(400);
    return Number(value);
  };
  const addr = name => {try {const addr=getAddress(params.get(name)); if(addr!==ZeroAddress)return addr;} catch {} fail(400);};
  const q={kind,wallet:addr('wallet'),vault:addr('vault'),anchor:number('anchor'),hash:params.get('hash'),
    tx:params.get('tx'),start:number('start'),end:number('end'),from:number('from'),to:number('to'),
    category:params.get('category')??'all',page:number('page')??0};
  if ((q.anchor===undefined)!==(q.hash===null) || (q.hash!==null && !hash(q.hash)) ||
      (q.tx!==null && !hash(q.tx)) || (q.from===undefined)!==(q.to===undefined) ||
      (q.from!==undefined && (q.anchor===undefined || q.to<q.from || q.to-q.from>=16000 || q.to>q.anchor ||
        q.tx!==null || q.start!==undefined || q.end!==undefined)) ||
      (q.start!==undefined && q.end!==undefined && q.start>=q.end) ||
      !['all','deposits','earnings','withdrawals','account'].includes(q.category) || q.page>50000) fail(400);
  return q;
}

function readProfiles() {
  try {
    const list=JSON.parse(readFileSync(new URL('./v3-history-profiles.json',import.meta.url),'utf8'));
    if(Array.isArray(list) && list.length<=2)return list;
  } catch {}
  return [];
}
function readers(env) {
  let credential;
  if(env.CREDENTIALS_DIRECTORY)try{credential=readFileSync(join(env.CREDENTIALS_DIRECTORY,'v3-history-rpc'),'utf8').trim();}catch{}
  const urls=[...new Set([credential,env.V3_HISTORY_RPC_URL,'https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'].filter(Boolean))];
  return urls.flatMap(value=>{
    let url;
    try{url=new URL(value);}catch{return [];}
    if(url.protocol!=='https:'||url.hash)return [];
    const req=new FetchRequest(url.href);req.timeout=8500;
    return [new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1})];
  });
}
function profilesByAddress(list) {
  const map=new Map();
  for(const proof of list){
    const profile=[PORTFOLIO_PROFILE,PLAN_PORTFOLIO_PROFILE].find(p=>p.status===proof.status);
    const address=getAddress(proof.vault);
    if(!profile || !integer(proof.deploymentBlock) || proof.chainId!==97 || map.has(address))throw Error('Invalid V3 member history profile');
    map.set(address,{proof,profile});
  }
  return map;
}

async function getBlock(provider,number) {
  const block=await provider.getBlock(number);
  check(block?.number===number && hash(block.hash) && integer(block.timestamp) && block.timestamp>0);
  return block;
}
async function selectRange(provider,q,anchor) {
  let from=anchor.firstBlock,to=anchor.block;
  if(q.tx) {
    const receipt=await provider.getTransactionReceipt(q.tx);
    if(receipt){
      check(receipt.hash.toLowerCase()===q.tx.toLowerCase() && integer(receipt.blockNumber));
      if(receipt.blockNumber<from || receipt.blockNumber>to)return {from,to:from-1};
      check((await getBlock(provider,receipt.blockNumber)).hash.toLowerCase()===receipt.blockHash.toLowerCase());
      from=to=receipt.blockNumber;
    }
  }
  async function lowerBound(lo,hi,time){
    let upper=hi+1;
    while(lo<upper){
      const mid=lo+Math.floor((upper-lo)/2);
      if((await getBlock(provider,mid)).timestamp<time)lo=mid+1;else upper=mid;
    }
    return lo;
  }
  if(q.start!==undefined)from=await lowerBound(from,to,q.start);
  if(q.end!==undefined && from<=to)to=await lowerBound(from,to,q.end)-1;
  return {from,to};
}

async function batchMap(values,fn) {
  const out=[];
  for(let i=0;i<values.length;i+=4)out.push(...await Promise.all(values.slice(i,i+4).map(fn)));
  return out;
}
const safeNumber = value => {const n=Number(value);check(integer(n));return n;};
async function withdrawalPage(vault,q,at) {
  const total=safeNumber(await vault.userWithdrawalCount(q.wallet,at));
  const offset=q.page*20;
  if(offset>=total && q.page!==0)fail(400);
  const ids=await batchMap(Array.from({length:Math.min(20,Math.max(0,total-offset))},(_,i)=>total-1-offset-i),
    index=>vault.userWithdrawalId(q.wallet,index,at));
  check(new Set(ids.map(String)).size===ids.length);
  const items=await batchMap(ids,async id=>{
    const row=await vault.withdrawalOf(id,at);
    const beneficiary=getAddress(row.beneficiary),status=safeNumber(row.status),kind=safeNumber(row.kind);
    const requestedAt=safeNumber(row.requestedAt);
    check(beneficiary===q.wallet && status<=5 && kind===4 && row.gross>0n && row.fee<=row.gross &&
      requestedAt>0 && requestedAt<=8640000000000);
    const {personal,referral,network,principal}=await vault.withdrawalAllocation(id,at);
    const earnings=personal+referral+network;
    check(earnings+principal===row.gross && earnings*200n/10000n+principal*3000n/10000n===row.fee);
    return {id:safeNumber(id),positionId:safeNumber(row.positionId),beneficiary,status,kind,requestedAt,
      gross:String(row.gross),fee:String(row.fee),
      allocation:{personal:String(personal),referral:String(referral),network:String(network),principal:String(principal)}};
  });
  return {page:q.page,total,items};
}

// Narrow an expensive window without claiming coverage of the omitted blocks.
const tooWide = () => Object.assign(Error('History range too wide'),{narrow:true});
function sizeLimit(error){
  const nested=error?.info?.error??error?.error??error;
  const text=String(nested?.message??'');
  if(/rate limit|too many requests|throttl/i.test(text)||Number(nested?.code)===429)return false;
  return error?.narrow || Number(nested?.code)===-32005 ||
    /block range|range (?:is )?too (?:large|wide)|result limit|more than .*results|response size exceeded/i.test(text);
}
async function readLogs(provider,vault,q,proof,at,from,to,knownIds) {
  const walletTopic=zeroPadValue(q.wallet,32),vaultTopic=zeroPadValue(q.vault,32);
  const groups=new Map();
  for(const def of eventTypes){
    if(q.category!=='all' && q.category!==def.category)continue;
    if(def.position==='request' && knownIds?.length===0)continue;
    const key=def.source+def.position;
    const group=groups.get(key)??{address:proof[def.source],source:def.source,position:def.position,names:[]};
    group.names.push(def.topic);groups.set(key,group);
  }
  const all=[],requestIds=new Set(),seen=new Set();
  for(const group of groups.values()){
    let topics=[group.names,group.position===1?walletTopic:null];
    if(group.position===2)topics.push(walletTopic);
    if(group.source==='token')topics.push(vaultTopic);
    if(group.position==='request')topics=knownIds?[group.names,knownIds]:[group.names];
    const logs=await provider.getLogs({address:group.address,topics,fromBlock:from,toBlock:to});
    check(Array.isArray(logs));
    // A cap or a dense page is never presented as complete. A single block
    // can legitimately contain more than one screenful of activity.
    if((logs.length>160 || all.length+logs.length>160) && from!==to)throw tooWide();
    if(logs.length>4096)throw tooWide();
    for(const log of logs){
      check(!log.removed && getAddress(log.address)===group.address && integer(log.blockNumber) &&
        log.blockNumber>=from && log.blockNumber<=to && integer(log.index) && hash(log.blockHash) && hash(log.transactionHash) &&
        Array.isArray(log.topics) && log.topics.every(hash) && group.names.includes(log.topics[0].toLowerCase()) &&
        typeof log.data==='string' && /^0x(?:[0-9a-f]{2})*$/i.test(log.data));
      const parsed=events.parseLog(log); check(parsed);
      if(group.position==='request'){
        const id=toBeHex(parsed.args.id,32);
        if(knownIds)check(knownIds.includes(id));
        else if(getAddress((await vault.withdrawalOf(parsed.args.id,at)).beneficiary)!==q.wallet)continue;
        requestIds.add(id);
      }else{
        check(log.topics[group.position].toLowerCase()===walletTopic.toLowerCase());
        if(group.source==='token')check(log.topics[2].toLowerCase()===vaultTopic.toLowerCase());
      }
      const key=log.transactionHash.toLowerCase()+':'+log.index;check(!seen.has(key));seen.add(key);all.push(log);
    }
  }
  const blocks=new Map(await batchMap([...new Set(all.map(log=>log.blockNumber))],async n=>[n,await getBlock(provider,n)]));
  const logs=all.map(log=>{
    const block=blocks.get(log.blockNumber);check(block.hash.toLowerCase()===log.blockHash.toLowerCase());
    return {address:getAddress(log.address),topics:log.topics,data:log.data,blockNumber:log.blockNumber,
      blockHash:log.blockHash,transactionHash:log.transactionHash,index:log.index,timestamp:block.timestamp};
  });
  logs.sort((a,b)=>b.blockNumber-a.blockNumber || b.index-a.index);
  return {logs,requestIds:[...requestIds],range:{from,to}};
}

export function createV3MemberHistory({proofs=readProfiles(),providers,env=process.env,
  verifyRelease=verifyUnifiedRelease,makeVault=(address,provider)=>new Contract(address,vaultAbi,provider)}={}) {
  const profiles=profilesByAddress(proofs), candidates=providers??readers(env);
  const verified=new WeakMap(),readerSpan=new WeakMap(),backoff=new WeakMap(),pending=new Map(),pages=new Map();
  let cachedBytes=0;
  function dropPage(key){
    cachedBytes-=pages.get(key).size;
    pages.delete(key);
  }
  function readCache(key){
    const cached=pages.get(key);
    if(!cached)return null;
    if(cached.expires<=Date.now()){dropPage(key);return null;}
    pages.delete(key);pages.set(key,cached);
    return cached.value;
  }
  function writeCache(key,value){
    const size=Buffer.byteLength(JSON.stringify(value));
    if(size>512*1024)return;
    if(pages.has(key))dropPage(key);
    while(pages.size>=192 || cachedBytes+size>8*1024*1024)dropPage(pages.keys().next().value);
    pages.set(key,{value,size,expires:Date.now()+120000});
    cachedBytes+=size;
  }
  async function session(provider,entry){
    let cache=verified.get(provider);
    if(!cache){cache=new Map();verified.set(provider,cache);}
    const key=entry.proof.vault;
    if(!cache.has(key)){
      const job=(async()=>{
        const checked=await verifyRelease(provider,entry.proof,UNIFIED_DEPLOYER,entry.profile);
        const deployment=await getBlock(provider,checked.proof.deploymentBlock);
        const receipt=await provider.getTransactionReceipt(checked.proof.deploymentTx);
        check(receipt && receipt.blockHash.toLowerCase()===deployment.hash.toLowerCase());
        return {proof:checked.proof,deploymentHash:deployment.hash};
      })().catch(error=>{cache.delete(key);throw error;});
      cache.set(key,job);
    }
    const result=await cache.get(key);
    const [chain,deploy]=await Promise.all([provider.send('eth_chainId',[]),getBlock(provider,result.proof.deploymentBlock)]);
    if(BigInt(chain)!==97n || deploy.hash.toLowerCase()!==result.deploymentHash.toLowerCase()){cache.delete(key);fail(503);}
    return result.proof;
  }
  async function page(provider,entry,q) {
    const proof=await session(provider,entry);
    const head=(await provider.getBlockNumber())-3, height=q.anchor??head;
    check(integer(head) && head>=proof.deploymentBlock);
    if(height<proof.deploymentBlock || height>head)fail(409);
    const block=await getBlock(provider,height);
    if(q.hash && block.hash.toLowerCase()!==q.hash.toLowerCase())fail(409);
    const anchor={firstBlock:proof.deploymentBlock,block:height,hash:block.hash};
    const base={version:1,chainId:97,vault:getAddress(proof.vault),wallet:q.wallet,
      token:getAddress(proof.token),network:getAddress(proof.network),anchor};
    // An immutable page is reusable across RPCs only after this reader verifies
    // the deployment and independently checks the same canonical anchor.
    const cacheKey=JSON.stringify({...q,anchor:height,hash:block.hash.toLowerCase()});
    const cached=readCache(cacheKey);
    if(cached)return cached;
    const vault=makeVault(proof.vault,provider),at={blockTag:height};
    let result;
    if(q.kind==='withdrawals')result=await withdrawalPage(vault,q,at);
    else if(q.from===undefined)result={range:await selectRange(provider,q,anchor),logs:[],requestIds:[]};
    else{
      if(q.from<proof.deploymentBlock)fail(400);
      let knownIds;
      if(q.category==='all'||q.category==='withdrawals'){
        const count=safeNumber(await vault.userWithdrawalCount(q.wallet,at));
        if(count<=32){
          knownIds=await batchMap(Array.from({length:count},(_,i)=>i),async i=>toBeHex(await vault.userWithdrawalId(q.wallet,i,at),32));
          check(new Set(knownIds).size===count);
        }
      }
      let from=Math.max(q.from,q.to-(readerSpan.get(provider)??16000)+1);
      for(;;){
        try{result=await readLogs(provider,vault,q,base,at,from,q.to,knownIds);break;}
        catch(error){
          if(!sizeLimit(error)||from===q.to)throw error;
          from+=Math.ceil((q.to-from)/2);
          if(!error.narrow)readerSpan.set(provider,q.to-from+1);
        }
      }
    }
    if((await getBlock(provider,height)).hash.toLowerCase()!==block.hash.toLowerCase())fail(409);
    const response={...base,...result};
    writeCache(cacheKey,response);
    return response;
  }
  return {
    supportAuthority(address){
      const entry=profiles.get(address);
      if(!entry)return null;
      return async wallet=>{
        for(const provider of candidates){
          try{
            const proof=await session(provider,entry);
            const head=await provider.getBlockNumber(),height=head-3;
            check(integer(height)&&height>=proof.deploymentBlock);
            const block=await getBlock(provider,height),vault=makeVault(proof.vault,provider);
            const role=await vault.MANAGER_ROLE({blockTag:height});
            const [confirmed,current]=await Promise.all([
              vault.hasRole(role,wallet,{blockTag:height}),vault.hasRole(role,wallet,{blockTag:'latest'})
            ]);
            check((await getBlock(provider,height)).hash===block.hash);
            return confirmed===true&&current===true;
          }catch{ /* Try the next verified reader on transport or identity failure. */ }
        }
        throw Error('Verified manager role unavailable.');
      };
    },
    async get(params,kind='events'){
      const q=queryFor(params,kind),entry=profiles.get(q.vault);
      if(!entry)fail(503);
      const key=JSON.stringify(q);
      if(pending.has(key))return pending.get(key);
      if(pending.size>=6)fail(429);
      const job=(async()=>{
        let conflict=false;
        // A reader that recently failed transport is tried after healthy ones.
        const now=Date.now();
        const available=candidates.filter(provider=>(backoff.get(provider)??0)<=now);
        const order=[...available,...candidates.filter(provider=>!available.includes(provider))];
        for(const provider of order){
          try{
            const result=await page(provider,entry,q);
            backoff.delete(provider);
            return result;
          }
          catch(error){
            if(error?.historyStatus===400)throw error;
            if(error?.historyStatus===409)conflict=true;else backoff.set(provider,Date.now()+30000);
          }
        }
        fail(conflict?409:503);
      })().finally(()=>pending.delete(key));
      pending.set(key,job);
      return job;
    },
    close(){if(!providers)for(const provider of candidates)provider.destroy();}
  };
}
