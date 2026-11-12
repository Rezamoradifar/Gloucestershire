import {getAddress,isAddress,ZeroAddress} from 'ethers';
import {chainId,vaultAddress} from './config';

export type HistoryScanKind='finance'|'reward'|'team';
export type HistoryScanScope='wallet'|'global';
export type VerifiedHistoryLog={
 address:string;transactionHash:string;blockHash:string;blockNumber:number;
 index:number;topics:string[];data:string;timestamp:number
};
type HistorySnapshot={
 version:1;chainId:number;vaultAddress:string;wallet:string;asset:string;
 scope:HistoryScanScope;kind:HistoryScanKind;confirmedHead:number;
 first:number|null;last:number|null;logs:VerifiedHistoryLog[];
 windowHash?:string;source?:'rpc'|'database+rpc'
};
const validHash=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const validNumber=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const validAddress=(value:unknown)=>typeof value==='string'&&isAddress(value);
const invalid=():never=>{throw Error('History server returned invalid blockchain data. Retry without changing your wallet.');};

export function parseVerifiedHistorySnapshot(value:unknown,{
 wallet,asset,scope,kind,from,to
}:{wallet:string;asset:string;scope:HistoryScanScope;kind:HistoryScanKind;from?:number;to?:number}):HistorySnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 const page=value as Record<string,any>;
 if(page.version!==1||page.chainId!==chainId||!validAddress(page.vaultAddress)||
  !validAddress(page.wallet)||!validAddress(page.asset)||
  getAddress(page.vaultAddress)!==getAddress(vaultAddress)||
  getAddress(page.wallet)!==getAddress(wallet)||getAddress(page.asset)!==getAddress(asset)||
  page.scope!==scope||page.kind!==kind||!validNumber(page.confirmedHead)||
  (page.source!==undefined&&!['rpc','database+rpc'].includes(page.source))||
  (page.windowHash!==undefined&&!validHash(page.windowHash))||
  !Array.isArray(page.logs)||page.logs.length>250)invalid();
 if(kind==='team'&&(scope!=='wallet'||getAddress(asset)!==ZeroAddress))invalid();
 if(from===undefined||to===undefined){
  if(page.first!==null||page.last!==null||page.logs.length!==0)invalid();
 }else if(page.first!==from||page.last!==to||to>page.confirmedHead)invalid();
 const seen=new Set<string>();
 for(const item of page.logs){
  if(!item||!validAddress(item.address)||getAddress(item.address)!==getAddress(vaultAddress)||
   !validHash(item.transactionHash)||!validHash(item.blockHash)||
   !validNumber(item.blockNumber)||!validNumber(item.index)||
   !validNumber(item.timestamp)||item.timestamp===0||
   from===undefined||to===undefined||item.blockNumber<from||item.blockNumber>to||
   !Array.isArray(item.topics)||item.topics.length<1||item.topics.length>4||
   !item.topics.every(validHash)||typeof item.data!=='string'||
   !/^0x(?:[0-9a-f]{2})*$/i.test(item.data))invalid();
  const id=item.transactionHash+':'+item.index;
  if(seen.has(id))invalid();seen.add(id);
 }
 return page as HistorySnapshot;
}

export async function requestVerifiedHistory({
 wallet,asset,scope,kind,from,to,fetcher=fetch,signal
}:{
 wallet:string;asset:string;scope:HistoryScanScope;kind:HistoryScanKind;
 from?:number;to?:number;fetcher?:typeof fetch;signal?:AbortSignal
}):Promise<HistorySnapshot>{
 if(!isAddress(wallet)||getAddress(wallet)===ZeroAddress||!isAddress(asset)||
  (kind!=='finance'&&scope!=='wallet')||
  (kind==='team'&&getAddress(asset)!==ZeroAddress)||
  (from!==undefined||to!==undefined)&&
  (!validNumber(from)||!validNumber(to)||Number(from)>Number(to)||Number(to)-Number(from)+1>96))
  throw Error('Invalid history server request.');
 const params=new URLSearchParams({wallet:getAddress(wallet),asset:getAddress(asset),scope,kind});
 if(from!==undefined&&to!==undefined){params.set('from',String(from));params.set('to',String(to));}
 let response:Response;
 try{
  const timeout=AbortSignal.timeout(25000);
  response=await fetcher('/api/event-history/window?'+params.toString(),{
   cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout
  });
 }catch(error){
  if(error instanceof Error&&error.name==='AbortError')throw error;
  throw Error('Verified history server is not reachable. Retry shortly.');
 }
 if(response.status===404)throw Error('Verified history API has not been installed. Update the site API and frontend together.');
 if(!response.ok)throw Error(response.status===400?
  'Invalid verified history range. Restart the scan.':
  'Verified history RPC is temporarily unavailable. Try again shortly.');
 return parseVerifiedHistorySnapshot(await response.json(),{wallet,asset,scope,kind,from,to});
}
