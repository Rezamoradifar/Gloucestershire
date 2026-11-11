import {useEffect,useState,type FormEvent} from 'react';
import {ExternalLink,Search,ShieldCheck,Users} from 'lucide-react';
import {getAddress,isAddress} from 'ethers';
import {session,errorText,type Snapshot} from './chain';
import {explorer} from './config';
import {displayAmount} from './money';
type Result={who:string;registered:boolean;active:boolean;kyc:boolean;tier:number;direct:bigint;capitalUsd:bigint;salesUsd:bigint;principal:bigint;profit:bigint;positions:bigint;block:number};
export default function AdminWalletLookup({admin,data}:{admin:string;data:Snapshot}){
 const [value,setValue]=useState(''),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setValue('');setResult(null);setError('');},[admin,data.asset]);
 const search=async(event:FormEvent)=>{
  event.preventDefault();if(busy)return;setError('');setResult(null);
  if(!isAddress(value)){setError('Enter a valid wallet address.');return;}
  setBusy(true);
  try{
   const target=getAddress(value),{vault}=await session(admin),options={blockTag:data.blockNumber};
   const [user,account,tier,positions]=await Promise.all([vault.users(target,options),vault.accounts(target,data.asset,options),vault.tierOf(target,options),vault.positionCount(target,options)]);
   setResult({who:target,registered:Boolean(user.registered),active:Boolean(user.active),kyc:Boolean(user.vipKyc),tier:Number(tier),
    direct:BigInt(user.activeDirect),capitalUsd:BigInt(user.capitalUsd),salesUsd:BigInt(user.salesUsd),principal:BigInt(account.principal),profit:BigInt(account.profit),positions:BigInt(positions),block:data.blockNumber});
  }catch(reason){setError(errorText(reason));}
  finally{setBusy(false);}
 };
 return <section className="panel v2-admin-lookup" aria-labelledby="v2-wallet-search">
  <div className="panel-title"><div><span className="detail-kicker">CONTRACT DIRECTORY</span><h3 id="v2-wallet-search"><Search size={19}/> Search member wallet</h3><p>Read public contract records for a member. This does not change balances or permissions.</p></div></div>
  <form onSubmit={e=>void search(e)}><label htmlFor="v2-admin-address">Wallet address</label><div className="v2-admin-search-row"><input id="v2-admin-address" value={value} placeholder="0x…" onChange={e=>setValue(e.target.value)} spellCheck={false} autoComplete="off"/><button className="small-button" disabled={busy} type="submit"><Search size={16}/>{busy?'Reading…':'Search'}</button></div></form>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {result&&<div className="v2-admin-found"><div className="v2-admin-found-title"><strong>{result.who}</strong><a target="_blank" rel="noopener noreferrer" href={explorer+'/address/'+result.who}><ExternalLink size={16}/> Explorer</a></div>
   <div className="v2-admin-found-grid">
    <span><ShieldCheck size={16}/> Registration <b>{result.registered?'On-chain registered':'Not registered'}</b></span>
    <span><Users size={16}/> Account status <b>{result.active?'Reported active':'Not verified active'}</b></span>
    <span>Tier <b>{result.tier}</b></span><span>VIP KYC <b>{result.kyc?'Verified':'Not verified'}</b></span>
    <span>Active directs <b>{result.direct.toString()}</b></span><span>Position count <b>{result.positions.toString()}</b></span>
    <span>Recorded principal <b>{displayAmount(result.principal,data.decimals,2)}</b></span>
    <span>Recorded profit <b>{displayAmount(result.profit,data.decimals,2)}</b></span>
    <span>Capital USD <b>{displayAmount(result.capitalUsd,18,2)}</b></span>
    <span>Recorded sales USD <b>{displayAmount(result.salesUsd,18,2)}</b></span>
   </div><p className="muted">Read at block {result.block.toLocaleString()}. These records are not an audit, KYC document disclosure or confirmation of wallet transfers.</p>
  </div>}
 </section>;
}
