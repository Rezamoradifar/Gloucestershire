import {ArrowUpRight,Check,Clock3,ExternalLink,Globe2,Layers,LockKeyhole,Wallet} from 'lucide-react';
import {chainId,chainName,configured,explorer,vaultAddress} from './config';
import {displayAmount as fmt} from './money';
import {profitAvailability} from './account';
import type {Asset,Snapshot} from './chain';

const time=(v:bigint|number)=>new Date(Number(v)*1000).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC';

export function AccountWelcome({who,network,data,loading,connecting,busy,onConnect}:{who:string;network:number|null;data:Snapshot|null;loading:boolean;connecting:boolean;busy:boolean;onConnect:()=>void}){
 const matching=!!who&&network===chainId;
 return <section className="account-welcome" aria-label="Account connection status">
  <img src="/assets/intelligence-earth-640.webp" alt="" width="640" height="640"/>
  <div className="account-welcome-copy"><span className="eyebrow">YOUR GLOBAL ACCOUNT</span><h2>Your capital.<br/><em>A clearer view.</em></h2><p>Follow your positions, review funded profit and understand each withdrawal before you confirm.</p>
   <button className="small-button" disabled={busy||connecting} onClick={onConnect}><Wallet size={16}/>{who?'Manage wallet':'Connect your wallet'}<ArrowUpRight size={16}/></button>
  </div>
  <dl className="account-connection">
   <div><dt>Wallet</dt><dd><span className={'connection-dot '+(who?'connected':'')}/>{who?who.slice(0,6)+'…'+who.slice(-4):'Not connected'}</dd></div>
   <div><dt>Network</dt><dd>{matching?chainName:who?`Switch from chain ${network??'unknown'}`:chainName+' required'}</dd></div>
   <div><dt>Account data</dt><dd>{loading?'Refreshing…':data?`Block ${data.blockNumber.toLocaleString('en-US')}`:'Not loaded yet'}</dd></div>
  </dl>
 </section>;
}

export default function AccountDetails({data,asset}:{data:Snapshot|null;asset:Asset}){
 const preview=data?profitAvailability(data):null;
 const positions=data?.positions.filter(p=>p.asset.toLowerCase()===data.asset.toLowerCase()&&p.principal>0n)||[];
 const locked=positions.filter(p=>data&&p.unlockAt>BigInt(data.blockTime));
 const nextUnlock=locked.reduce<bigint|null>((next,p)=>next===null||p.unlockAt<next?p.unlockAt:next,null);
 const checks=[
  {title:'Recorded profit',value:data?`${fmt(data.profit,data.decimals)} ${asset}`:'Connect to load',pass:data?data.profit>0n:null},
  {title:'Per-withdrawal cap',value:data?`${fmt(data.withdrawalLimit,data.decimals)} ${asset}`:'Connect to load',pass:data?data.withdrawalLimit>0n:null},
  {title:'Withdrawal cooldown',value:data?(preview?.cooling?time(data.nextWithdrawal):'Elapsed at loaded block'):'Connect to load',pass:preview?!preview.cooling:null},
  {title:'Shared treasury cash',value:data?`${fmt(data.liquidBalance,data.decimals)} ${asset}`:'Connect to load',pass:data&&preview?preview.recordedLimit>0n&&data.liquidBalance>=preview.recordedLimit:null},
 ];
 return <div className="account-detail-grid">
  <section className="panel withdrawal-detail" aria-labelledby="withdrawal-detail-title">
   <div className="panel-title"><div><span className="detail-kicker">BEFORE YOU WITHDRAW</span><h2 id="withdrawal-detail-title">Profit withdrawal breakdown</h2></div><ArrowUpRight size={22}/></div>
   <div className="withdrawal-net"><span>Estimated net under loaded limits</span><strong>{preview?fmt(preview.net,data!.decimals):'—'} <small>{asset}</small></strong><p>{preview?.cooling?'The cooldown is still active.':data?'After the profit fee; network gas is separate.':'Your figures appear after connecting the right account and network.'}</p></div>
   <dl className="withdrawal-checks">{checks.map(check=><div key={check.title}><dt>{check.pass===true?<Check size={15}/>:check.pass===false?<LockKeyhole size={15}/>:<Clock3 size={15}/>} {check.title}</dt><dd>{check.value}</dd></div>)}</dl>
   <div className="withdrawal-fees"><span>Gross estimate <bdi>{preview?fmt(preview.gross,data!.decimals):'—'} {asset}</bdi></span><span>Profit fee {data?`(${Number(data.fee)/100}%)`:''}<bdi>{preview?fmt(preview.fee,data!.decimals):'—'} {asset}</bdi></span></div>
   <p className="detail-note">An estimate at the loaded block, not reserved funds. Other withdrawals or owner actions can change liquidity; the transaction is checked again before signing.</p>
  </section>
  <section className="panel account-records" aria-labelledby="account-records-title">
   <div className="panel-title"><div><span className="detail-kicker">YOUR ACCOUNT RECORD</span><h2 id="account-records-title">Balances & position details</h2></div><Layers size={22}/></div>
   <dl className="account-record-list">
    <div><dt>In your wallet</dt><dd>{fmt(data?.walletBalance,data?.decimals)} {asset}</dd></div>
    <div><dt>Lifetime external deposits</dt><dd>{fmt(data?.externalDeposited,data?.decimals)} {asset}</dd></div>
    <div><dt>Completed reinvestments</dt><dd>{fmt(data?.reinvested,data?.decimals)} {asset}</dd></div>
    <div><dt>Withdrawal-cap basis</dt><dd>{data?fmt(data.externalDeposited+data.reinvested,data.decimals):'—'} {asset}</dd></div>
    <div><dt>Minimum new deposit</dt><dd>{fmt(data?.minDeposit,18,2)} USD</dd></div>
    <div><dt>Open positions in loaded list</dt><dd>{data?positions.length:'—'}</dd></div>
    <div><dt>Locked / unlocked in loaded list</dt><dd>{data?`${locked.length} / ${positions.length-locked.length}`:'—'}</dd></div>
    <div><dt>Next unlock in loaded list</dt><dd>{data?(nextUnlock?time(nextUnlock):'No locked position loaded'):'—'}</dd></div>
   </dl>
   <p className="detail-note">{data?`${data.positions.length} of ${data.positionCount} positions loaded across assets. `:''}Unlocking does not remove the position’s principal penalty. Open My positions to review the individual terms.</p>
  </section>
  <section className="panel account-read-status" aria-label="Data source">
   <Globe2 size={21}/><div><h3>{chainName}{chainId===97?' · Test assets only':''}</h3><p>{data?`Snapshot: ${time(data.blockTime)}. Account figures refresh every 30 seconds while idle.`:'No account values have been loaded. Connect a wallet to read your records.'}</p></div>
   {configured&&<a href={`${explorer}/address/${vaultAddress}`} target="_blank" rel="noreferrer">View contract <ExternalLink size={15}/></a>}
  </section>
 </div>;
}
