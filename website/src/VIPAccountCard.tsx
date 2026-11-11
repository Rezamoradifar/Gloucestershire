import {ArrowUpRight,CheckCircle2,Coins,LockKeyhole,ShieldCheck,Wallet} from 'lucide-react';
import {profitAvailability} from './account';
import {displayAmount} from './money';
import type {Asset,Snapshot} from './chain';
const tiers=['Starter','Basic','Growth','Pro','VIP'];
export default function VIPAccountCard({data,asset,onViewHistory,onViewProfile}:{data:Snapshot|null;asset:Asset;onViewHistory:()=>void;onViewProfile:()=>void}){
 const available=data?profitAvailability(data):null;
 return <section className="v2-vip-card" aria-label="Personal portfolio card">
  <div className="v2-vip-glow" aria-hidden="true"/><div className="v2-vip-top"><div className="v2-vip-mark"><span>◎</span><div><strong>GLOBAL PRIVATE ACCOUNT</strong><small>{data?'VERIFIED CONTRACT SNAPSHOT':'CONNECT WALLET TO VIEW'}</small></div></div><span className="v2-vip-chip"><ShieldCheck size={16}/>{data?tiers[data.tier]??'Member':'Member'}</span></div>
  <div className="v2-vip-main"><div><span>Recorded principal</span><strong>{displayAmount(data?.principal,data?.decimals,2)} <em>{asset}</em></strong><small>Position principal · not a wallet balance</small></div><div><span>Credited profit</span><strong>{displayAmount(data?.profit,data?.decimals,2)} <em>{asset}</em></strong><small>Contract allocations · subject to liquidity</small></div></div>
  <div className="v2-vip-bottom"><div><CheckCircle2 size={17}/><span>Estimated net available now</span><strong>{displayAmount(available?.net,data?.decimals,2)} {asset}</strong></div><div><LockKeyhole size={17}/><span>Withdrawal status</span><strong>{!data?'—':available?.cooling?'Cooldown active':data.pendingWithdrawal?'Request pending':'Contract rules apply'}</strong></div></div>
  <div className="v2-vip-actions"><button type="button" onClick={onViewHistory}><Coins size={16}/> Financial history <ArrowUpRight size={16}/></button><button type="button" onClick={onViewProfile}><Wallet size={16}/> Member profile <ArrowUpRight size={16}/></button></div>
  <p>Amounts are derived from a loaded chain snapshot. Availability can change before any signed withdrawal; no profit is guaranteed.</p>
 </section>;
}
