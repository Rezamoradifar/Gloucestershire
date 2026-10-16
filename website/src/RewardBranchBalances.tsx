import {useEffect,useState} from 'react';
import {session,errorText} from './chain';
import {displayAmount} from './money';

export function branchBalances(historical:bigint,consumed:bigint,reserved:bigint){
 if(historical<consumed||consumed<reserved||reserved<0n)throw Error('Inconsistent branch snapshot. Refresh network.');
 return {claimed:consumed-reserved,reserved,remaining:historical-consumed+reserved};
}
type Row={address:string;historical:bigint;claimed:bigint;reserved:bigint;remaining:bigint};
const usd=(n:bigint)=>displayAmount(n,18,2);
export default function RewardBranchBalances({who,group,count,block}:{who:string;group:bigint;count:bigint;block:number}){
 const [start,setStart]=useState(0n),[rows,setRows]=useState<Row[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let stopped=false;setRows(null);setError('');
  async function read(){try{const {vault}=await session(who),options={blockTag:block},result:Row[]=[];
   const end=start+12n<count?start+12n:count;
   for(let i=start;i<end;i++){if(stopped)return;const b=await vault.rewardBranch(who,group,i,options);const historical:bigint=await vault.branchVolumeUsd(who,b.branch,options);result.push({address:b.branch,historical,...branchBalances(historical,b.consumedUsd,b.reservedForStageUsd)});}
   if(!stopped)setRows(result);
  }catch(e){if(!stopped)setError(errorText(e));}}
  void read();return()=>{stopped=true;};
 },[who,group,count,block,start]);
 return <section aria-label="Branch volume balances"><h4>Volume carried forward by branch</h4><p className="muted">Only volume used for claimed rewards is deducted. Remaining volume includes reservations for the current stage; new deposits and reinvestments add to it once propagated. Each stage still applies its per-branch cap.</p>
 {error?<p role="alert" className="inline-error">{error}</p>:!rows?<p role="status">Loading branch balances…</p>:<div className="network-table"><table><thead><tr><th>Branch</th><th>Historical USD</th><th>Used for claimed rewards</th><th>Remaining USD</th><th>Reserved within remaining</th></tr></thead><tbody>{rows.map(r=><tr key={r.address}><td><code>{r.address}</code></td><td>{usd(r.historical)}</td><td>{usd(r.claimed)}</td><td>{usd(r.remaining)}</td><td>{usd(r.reserved)}</td></tr>)}</tbody></table></div>}
 {count>12n&&<div className="network-pagination"><button className="small-button" disabled={start===0n} onClick={()=>setStart(n=>n-12n)}>Previous</button><span>Page {String(start/12n+1n)}</span><button className="small-button" disabled={start+12n>=count} onClick={()=>setStart(n=>n+12n)}>Next</button></div>}
 </section>;
}
