import {useEffect,useState} from 'react';
import {errorText} from './chain';
import {displayAmount} from './money';
import {readQueue,type QueueAction} from './withdrawal-queue';
export default function WithdrawalRequests({who,block,owner,busy,onExecute}:{who:string;block:number;owner:boolean;busy:boolean;onExecute:(a:QueueAction)=>Promise<void>}){
 const [start,setStart]=useState(0n),[all,setAll]=useState(false),[reload,setReload]=useState(0),[data,setData]=useState<Awaited<ReturnType<typeof readQueue>>|null>(null),[error,setError]=useState('');
 useEffect(()=>{setStart(0n);setAll(false);},[who]);
 useEffect(()=>{let stopped=false;setData(null);setError('');readQueue(who,start,owner&&all).then(d=>{if(!stopped)setData(d);}).catch(e=>{if(!stopped)setError(errorText(e));});return()=>{stopped=true;};},[who,start,owner,all,block,reload]);
 return <section className="panel"><div className="panel-title"><h2>Withdrawal requests</h2><button className="small-button" disabled={busy} onClick={()=>setReload(n=>n+1)}>Refresh requests</button></div>
 <p className="muted">The payment deadline is 72 hours after your request. Payment can happen earlier when cash is available. Pending amounts cannot be reinvested. An overdue request remains owed; you may cancel it after the deadline to restore your profit balance.</p>
 {owner&&<label><input type="checkbox" checked={all} disabled={busy} onChange={e=>{setAll(e.target.checked);setStart(0n);}}/> Show all customer requests</label>}
 {error?<p className="inline-error" role="alert">{error}</p>:!data?<p role="status">Loading requests…</p>:<>
 {!data.rows.length&&<p>No requests yet.</p>}
 {data.rows.map(r=><article key={String(r.id)}><h3>Request #{String(r.id+1n)} · {r.status===1?'Paid':r.status===2?'Cancelled':BigInt(data.time)>=r.dueAt?'Overdue — awaiting payment':'Pending payment'}</h3>
 <p className="network-address">Recipient: {r.user}</p><p>{displayAmount(r.gross,r.decimals)} {r.symbol} requested · Fee {displayAmount(r.fee,r.decimals)} · Net {displayAmount(r.gross-r.fee,r.decimals)} {r.symbol}</p><p>Payment deadline: {new Date(Number(r.dueAt)*1000).toLocaleString()}</p>
 {r.status===0&&<div className="network-group-actions"><button className="small-button" disabled={busy} onClick={()=>void onExecute({kind:'pay',id:r.id})}>Pay recorded recipient · confirm in wallet</button>{r.user.toLowerCase()===who.toLowerCase()&&BigInt(data.time)>=r.dueAt&&<button className="small-button" disabled={busy} onClick={()=>void onExecute({kind:'cancel',id:r.id})}>Cancel overdue request and restore profit</button>}</div>}</article>)}
 <div className="network-pagination"><button className="small-button" disabled={busy||start===0n} onClick={()=>setStart(n=>n-8n)}>Previous</button><span>Page {String(start/8n+1n)}</span><button className="small-button" disabled={busy||start+8n>=data.count} onClick={()=>setStart(n=>n+8n)}>Next</button></div></>}
 </section>;
}
