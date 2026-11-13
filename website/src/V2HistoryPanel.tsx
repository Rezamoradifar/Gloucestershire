import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,ExternalLink,History,RefreshCw} from 'lucide-react';
import {ZeroAddress,type Eip1193Provider} from 'ethers';
import {getWalletProvider} from './wallet';
import {V2_EXPLORER,v2Money,v2Short} from './v2-chain';
import {readV2History,type V2WalletEvent} from './v2-audit';

type HistoryResult=Awaited<ReturnType<typeof readV2History>>;
const kind=(row:V2WalletEvent)=>{
 if(row.name==='PersonalProfitCredited')return 'Personal';
 if(row.name==='ReferralProfitCredited')return 'Referral';
 if(row.name==='EarningsFunded')return 'Funding';
 if(row.name==='DepositRouted')return 'Deposit';
 if(row.name==='WithdrawalRequested')return 'Withdrawal request';
 if(row.name==='Reinvested')return 'Reinvest';
 if(row.name==='CheckIn')return 'Activity';
 return row.name;
};
export default function V2HistoryPanel({
 requester,subject,token,decimals=18
}:{requester:string;subject:string;token:string;decimals?:number}){
 const [page,setPage]=useState(0),[result,setResult]=useState<HistoryResult|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setPage(0);setResult(null);setError('');},[requester,subject,token,decimals]);
 async function read(offset:number){
  const provider=getWalletProvider() as Eip1193Provider|null;
  if(!provider)return setError('Connect a verified V2 wallet to inspect events.');
  if(!subject||!requester)return;
  setLoading(true);setError('');
  try{
   const data=await readV2History(provider,requester,subject,offset);
   if(getWalletProvider()===provider){setPage(offset);setResult(data);}
  }catch(e){setError(e instanceof Error?e.message:'Bounded event history was unavailable.');}
  finally{setLoading(false);}
 }
 const asset=(row:V2WalletEvent)=>{
  if(!row.asset)return null;
  const native=row.asset.toLowerCase()===ZeroAddress.toLowerCase();
  if(!native&&row.asset.toLowerCase()!==token.toLowerCase())return row.asset;
  return (row.amount!==null?v2Money(row.amount,native?18:decimals)+' ':'')+(native?'BNB':'USDT');
 };
 const personal=result?.events.filter(x=>x.name==='PersonalProfitCredited')??[];
 const referrals=result?.events.filter(x=>x.name==='ReferralProfitCredited')??[];
 return <section className="gv2-panel" aria-label="Verified on-chain V2 transaction events">
  <div className="gv2-panel-head"><h3><History size={19}/> Verified V2 event history</h3>
   <button disabled={loading} onClick={()=>void read(page)}><RefreshCw size={15}/> {loading?'Reading…':'Read block window'}</button>
  </div>
  <p className="gv2-small">Source: only the new V2 contract on chain 97. Showing bounded block windows, not the entire lifetime history. Events without user-indexed address cannot automatically be attributed to this wallet.</p>
  {error&&<p className="gv2-error" role="alert">{error}</p>}
  {result&&<>
   <div className="gv2-detail"><span>Inspected blocks</span><b>{result.from.toLocaleString()} – {result.to.toLocaleString()}</b></div>
   <div className="gv2-detail"><span>Personal / referral credit events in this window</span><b>{personal.length} / {referrals.length}</b></div>
   {result.events.map(row=><article className="gv2-position" key={row.key}>
    <div><strong>{kind(row)}</strong><small>Block {row.block.toLocaleString()} · {row.details}</small></div>
    <div><b>{asset(row)??'—'}</b><small>{row.level!==null?'Level '+row.level+' · rate '+(row.rateBps??0)/100+'%':''}</small>
     {row.source&&<small>Source: {v2Short(row.source)}</small>}</div>
    <div><a href={V2_EXPLORER+'/tx/'+row.tx} target="_blank" rel="noopener noreferrer">View receipt <ExternalLink size={14}/></a>
     {row.proof&&<small>Proof: {v2Short(row.proof)}</small>}</div>
   </article>)}
   {!result.events.length&&<p>No wallet-attributed V2 events in this bounded block window. This does not prove no older activity exists.</p>}
   <div className="gv2-buttons">
    <button disabled={loading||page===0} onClick={()=>void read(page-1)}><ArrowRight size={16}/> Newer blocks</button>
    <button disabled={loading||!result.hasOlder} onClick={()=>void read(page+1)}>Older blocks <ArrowLeft size={16}/></button>
   </div>
  </>}
 </section>;
}
