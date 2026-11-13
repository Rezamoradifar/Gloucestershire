import {useEffect,useState,type FormEvent} from 'react';
import {ExternalLink,Search,ShieldCheck,Users} from 'lucide-react';
import {ZeroAddress,getAddress,isAddress} from 'ethers';
import {errorText,type Snapshot} from './chain';
import {readOnlySession} from './read-only-session';
import {explorer} from './config';
import {displayAmount} from './money';
import {readDailyActivityStatus,type DailyActivityStatus} from './daily-activity-client';
import {requestDirectBranches} from './server-team';

type Account={asset:'BNB'|'USDT';principal:bigint;profit:bigint;externalDeposited:bigint;reinvested:bigint;withdrawalCap:bigint;decimals:number};
type Position={id:number;asset:string;principal:bigint;capitalUsd:bigint;unlockAt:bigint};
type Result={
 who:string;registered:boolean;active:boolean;kyc:boolean;tier:number;
 referrer:string;activeDirect:bigint;registeredDirect:number|null;
 capitalUsd:bigint;salesUsd:bigint;positionsTotal:number;positions:Position[];
 assets:Account[];block:number;activity:DailyActivityStatus|null;activityError:string;
};

export default function AdminWalletLookup({admin,data}:{admin:string;data:Snapshot}){
 const [value,setValue]=useState(''),[result,setResult]=useState<Result|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setValue('');setResult(null);setError('');},[admin,data.asset]);
 const search=async(event:FormEvent)=>{
  event.preventDefault();if(busy)return;setError('');setResult(null);
  if(!isAddress(value)){setError('Enter a valid wallet address.');return;}
  setBusy(true);
  try{
   const target=getAddress(value),{vault}=await readOnlySession(admin),options={blockTag:data.blockNumber};
   const [user,tier,positionsCount,token,tokenDecimals,branches]=await Promise.all([
    vault.users(target,options),vault.tierOf(target,options),vault.positionCount(target,options),
    vault.usdt(options),vault.tokenDecimals(options),
    requestDirectBranches(target,0,12,data.blockNumber)
   ]);
   const count=Number(positionsCount);
   if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid contract position count.');
   const assets=await Promise.all(
    ([{asset:'BNB' as const,address:ZeroAddress,decimals:18},
      {asset:'USDT' as const,address:getAddress(token),decimals:Number(tokenDecimals)}])
      .map(async item=>{
       const [account,reinvested,withdrawalCap]=await Promise.all([
        vault.accounts(target,item.address,options),
        vault.cumulativeReinvested(target,item.address,options),
        vault.profitWithdrawalCap(target,item.address,options)
       ]);
       return {asset:item.asset,principal:BigInt(account.principal),profit:BigInt(account.profit),
        externalDeposited:BigInt(account.externalDeposited),reinvested:BigInt(reinvested),
        withdrawalCap:BigInt(withdrawalCap),decimals:item.decimals};
      })
   );
   const positions=await Promise.all(Array.from({length:Math.min(8,count)},async(_,id)=>{
    const position=await vault.positionOf(target,id,options);
    return {id,asset:getAddress(position.asset),principal:BigInt(position.principal),
     capitalUsd:BigInt(position.capitalUsd),unlockAt:BigInt(position.unlockAt)};
   }));
   const signed=await readDailyActivityStatus(target).then(
    value=>({value,error:''}),reason=>({value:null,error:(reason as Error)?.message||'Daily signature status unavailable.'})
   );
   setResult({who:target,registered:Boolean(user.registered),active:Boolean(user.active),
    kyc:Boolean(user.vipKyc),tier:Number(tier),referrer:getAddress(user.referrer),
    activeDirect:BigInt(user.activeDirect),registeredDirect:branches.total,
    capitalUsd:BigInt(user.capitalUsd),salesUsd:BigInt(user.salesUsd),
    positionsTotal:count,positions,assets,block:data.blockNumber,
    activity:signed.value,activityError:signed.error});
  }catch(reason){setError(errorText(reason));}
  finally{setBusy(false);}
 };
 return <section className="panel v2-admin-lookup" aria-labelledby="v2-wallet-search">
  <div className="panel-title"><div><span className="detail-kicker">VERIFIED CUSTOMER FILE</span>
   <h3 id="v2-wallet-search"><Search size={19}/> Customer details · contract & check-in</h3>
   <p>Read public wallet accounting on BNB and USDT, registered referrals, verified activity, and recent positions. No account data is altered here.</p></div></div>
  <form onSubmit={e=>void search(e)}><label htmlFor="v2-admin-address">Registered wallet address</label>
   <div className="v2-admin-search-row"><input id="v2-admin-address" value={value} placeholder="0x…"
    onChange={e=>setValue(e.target.value)} spellCheck={false} autoComplete="off"/>
    <button className="small-button" disabled={busy} type="submit"><Search size={16}/>{busy?'Reading…':'Search'}</button></div></form>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {result&&<div className="v2-admin-found">
   <div className="v2-admin-found-title"><strong><bdi>{result.who}</bdi></strong>
    <a target="_blank" rel="noopener noreferrer" href={explorer+'/address/'+result.who}><ExternalLink size={16}/> Explorer</a></div>
   <div className="v2-admin-found-grid">
    <span><ShieldCheck size={16}/> Registration <b>{result.registered?'Registered on chain':'Not registered'}</b></span>
    <span><Users size={16}/> Reporter status <b>{result.active?'Reported active':'Not verified active'}</b></span>
    <span>Tier <b>{result.tier}</b></span><span>VIP KYC <b>{result.kyc?'Admin-verified':'Awaiting manual review'}</b></span>
    <span>Registered directs <b>{result.registeredDirect??'—'}</b></span>
    <span>Reporter-verified active directs <b>{result.activeDirect.toString()}</b></span>
    <span>Position count <b>{result.positionsTotal}</b></span>
    <span>Capital USD <b>{displayAmount(result.capitalUsd,18,2)}</b></span>
    <span>Recorded sales USD <b>{displayAmount(result.salesUsd,18,2)}</b></span>
    <span>Referrer <b><bdi>{result.referrer===ZeroAddress?'None':result.referrer}</bdi></b></span>
    <span>Signed 24h check-in <b>{result.activity?result.activity.activityCurrent?'Current':'Not current':'Unavailable'}</b></span>
    <span>Check-in recorded at <b>{result.activity?.lastCheckInAt?new Date(result.activity.lastCheckInAt*1000).toLocaleString():'Not available'}</b></span>
   </div>
   {result.activityError&&<p className="muted">Check-in service: {result.activityError}. Missing evidence is not proof of inactivity.</p>}
   <h4>Asset accounting · same contract block</h4>
   <div className="v2-admin-found-grid">{result.assets.map(item=><div key={item.asset}>
    <strong>{item.asset}</strong>
    <div>Principal: {displayAmount(item.principal,item.decimals,4)}</div>
    <div>Credited profit: {displayAmount(item.profit,item.decimals,4)}</div>
    <div>Deposited externally: {displayAmount(item.externalDeposited,item.decimals,4)}</div>
    <div>Reinvested: {displayAmount(item.reinvested,item.decimals,4)}</div>
    <div>Profit withdrawal cap: {displayAmount(item.withdrawalCap,item.decimals,4)}</div>
   </div>)}</div>
   <h4>Recorded investment positions</h4>
   {result.positions.length?<div className="v2-admin-found-grid">{result.positions.map(item=><span key={item.id}>
    Position #{item.id+1} <b>{displayAmount(item.principal,item.asset===ZeroAddress?18:result.assets[1].decimals,4)}</b>
    <small>USD {displayAmount(item.capitalUsd,18,2)} · unlock {new Date(Number(item.unlockAt)*1000).toLocaleDateString()}</small>
   </span>)}</div>:<p className="muted">No positions reported for this wallet.</p>}
   {result.positionsTotal>result.positions.length&&<p className="muted">Showing {result.positions.length} of {result.positionsTotal} positions. Additional positions require paginated reading.</p>}
   <p className="muted">Snapshot block {result.block.toLocaleString()}. Activity, KYC, and contract capital are separate conditions. This is not a complete financial-event database or proof of withdrawal transfer.</p>
  </div>}
 </section>;
}
