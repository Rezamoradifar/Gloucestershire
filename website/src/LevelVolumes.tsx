import {useCallback,useEffect,useRef,useState} from 'react';
import {requestTeamVolumes,type VerifiedLevelVolume} from './server-team';
import {displayAmount} from './money';

export default function LevelVolumes({who,connected,block}:{who:string;connected:boolean;block:number}){
 const [data,setData]=useState<VerifiedLevelVolume[]|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loadedBlock,setLoadedBlock]=useState(0);
 const controller=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  if(!connected||!who)return;
  controller.current?.abort();
  const current=new AbortController();controller.current=current;
  setBusy(true);setError('');
  try{
   const result=await requestTeamVolumes(who,undefined,current.signal);
   if(!current.signal.aborted){setData(result.levels);setLoadedBlock(result.block);}
  }catch(error){
   if(!current.signal.aborted)setError((error as Error)?.message||'Verified level totals unavailable.');
  }finally{if(!current.signal.aborted)setBusy(false);}
 },[who,connected]);
 useEffect(()=>{setData(null);setLoadedBlock(0);},[who,connected]);
 useEffect(()=>{void load();return()=>controller.current?.abort();},[load]);
 return <section className="panel">
  <div className="panel-title"><h2>Team levels 1, 2 & 3 · confirmed volume</h2>
   <button className="small-button" disabled={!connected||block<=0||busy} onClick={()=>void load()}>
    {busy?'Verifying…':'Refresh level totals'}
   </button>
  </div>
  <p className="muted">Contract-verified USD volume for each exact referral depth, read through the Global server RPC. It is not a wallet balance, referral invitation count, or confirmed profit payment. Pending volume propagation blocks totals rather than showing fabricated zero.</p>
  {busy&&!data&&<p role="status">Verifying confirmed contract branch volumes…</p>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <div className="network-summary">{[1,2,3].map((level,i)=><span key={level}>Level {level}
   <strong>{data?displayAmount(data[i].volume,18,2):'—'} USD</strong>
   <small>{data?`${data[i].members} direct members at this exact depth`:busy?'Loading contract totals…':error?'Totals unavailable — retry refresh':!connected?'Connect wallet to view totals':'Awaiting confirmed snapshot…'}</small>
  </span>)}</div>
  {data&&<p className="muted">Verified on-chain snapshot: block {loadedBlock}. Refresh to include newer activity.</p>}
 </section>;
}
