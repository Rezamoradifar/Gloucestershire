import {useEffect,useState} from 'react';
import {errorText} from './chain';
import {displayAmount} from './money';
import {readQueue,type QueueAction} from './withdrawal-queue';
export default function WithdrawalRequests({who,block,owner,busy,onExecute}:{who:string;block:number;owner:boolean;busy:boolean;onExecute:(a:QueueAction)=>Promise<void>}){
 const [start,setStart]=useState(0n),[all,setAll]=useState(false),[reload,setReload]=useState(0),[data,setData]=useState<Awaited<ReturnType<typeof readQueue>>|null>(null),[error,setError]=useState('');
 useEffect(()=>{setStart(0n);setAll(false);},[who]);
 useEffect(()=>{let stopped=false;setData(null);setError('');readQueue(who,start,owner&&all).then(d=>{if(!stopped)setData(d);}).catch(e=>{if(!stopped)setError(errorText(e));});return()=>{stopped=true;};},[who,start,owner,all,block,reload]);
 return <section className="panel"><div className="panel-title"><h2>Withdrawal requests</h2><button className="small-button" disabled={busy} onClick={()=>setReload(n=>n+1)}>Refresh requests</button></div>
 <p className="muted">Submit your request once. The administrator approves it, then the contract pays the recorded recipient when funded. The payment deadline is 72 hours after your request. Reserved amounts cannot be used twice. You may cancel an overdue request to restore its original balance.</p>
 {owner&&<label><input type="checkbox" checked={all} disabled={busy} onChange={e=>{setAll(e.target.checked);setStart(0n);}}/> Show all customer requests</label>}
 {error?<p className="inline-error" role="alert">{error}</p>:!data?<p role="status">Loading requests…</p>:<>
 {!data.approvalRequired&&<p className="notice neutral">This legacy contract does not enforce administrator approval. A new contract deployment is required to activate that rule.</p>}
 {!data.rows.length&&<p>No requests yet.</p>}
 {data.rows.map(r=><article key={String(r.id)}><h3>Request #{String(r.id+1n)} · {r.principal?'Principal':'Profit'} · {r.status===1?'Paid':r.status===2?'Cancelled':r.status===3?'Approved — awaiting payment':BigInt(data.time)>=r.dueAt?'Overdue — awaiting approval':'Awaiting administrator approval'}</h3>
 <p className="network-address">Recipient: {r.user}</p><p>{displayAmount(r.gross,r.decimals)} {r.symbol} requested · Fee {displayAmount(r.fee,r.decimals)} · Net {displayAmount(r.gross-r.fee,r.decimals)} {r.symbol}</p><p>Payment deadline: {new Date(Number(r.dueAt)*1000).toLocaleString()}</p>
 {(r.status===0||r.status===3)&&<div className="network-group-actions">{owner&&data.approvalRequired&&r.status===0&&<><button className="small-button" disabled={busy} onClick={()=>void onExecute({kind:'approve',id:r.id})}>Approve request</button><button className="small-button" disabled={busy} onClick={()=>void onExecute({kind:'approveAndPay',id:r.id})}>Approve and pay now</button></>}{owner&&(!data.approvalRequired||r.status===3)&&<button className="small-button" disabled={busy} onClick={()=>void onExecute({kind:'pay',id:r.id})}>{data.approvalRequired?'Pay approved recipient':'Pay legacy request'}</button>}{r.user.toLowerCase()===who.toLowerCase()&&BigInt(data.time)>=r.dueAt&&<button className="small-button" disabled={busy} onClick={()=>void onExecute({kind:'cancel',id:r.id})}>Cancel overdue request and restore balance</button>}</div>}</article>)}
 <div className="network-pagination"><button className="small-button" disabled={busy||start===0n} onClick={()=>setStart(n=>n-8n)}>Previous</button><span>Page {String(start/8n+1n)}</span><button className="small-button" disabled={busy||start+8n>=data.count} onClick={()=>setStart(n=>n+8n)}>Next</button></div></>}
 </section>;
}
