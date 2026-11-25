import {useState,type FormEvent,type ReactNode} from 'react';
import {V3_HOURLY_TEST} from './v3-site-config';
import {ArrowDownLeft,ArrowRight,ArrowUpRight,Coins,Layers,LockKeyhole,Wallet} from 'lucide-react';
import DigitalValue from './DigitalValue';
import {formatV3Amount as money,v3TierName} from './v3-format';
import {v3PrepareUserClaims} from './v3-claim-balance';
import V3UnifiedReinvestSummary from './V3UnifiedReinvestSummary';
import type {V3Snapshot} from './v3-chain';

type Mode='deposit'|'withdraw'|'reinvest';
type Props={
 children?:ReactNode;
 view:V3Snapshot|null;connected:boolean;busy:boolean;loading:boolean;connecting:boolean;readOnly?:boolean;unifiedRelease?:boolean;
 value:string;onValue:(value:string)=>void;
 referrer:string;onReferrer:(value:string)=>void;invalidInvite:boolean;
 selectedPosition:string;onPosition:(value:string)=>void;
 onDeposit:()=>void;onWithdraw:()=>void;onReinvest:()=>void;onAccountReinvest?:()=>void;onAccountWithdraw?:()=>void;
 onNetwork:()=>void;onConnect:()=>void;onWalletConnect:()=>void;
};

export default function V3ClassicOverview(props:Props){
 const {view,connected,busy,loading,connecting,readOnly=false,unifiedRelease,value,onValue,referrer,onReferrer,invalidInvite,
  selectedPosition,onPosition,onDeposit,onWithdraw,onReinvest,onAccountReinvest,onAccountWithdraw,onNetwork,onConnect,onWalletConnect}=props;
 const [mode,setMode]=useState<Mode>('deposit');
 const claims=view?v3PrepareUserClaims(view.ledger):null;
 const ready=Boolean(view&&!view.paused&&!view.suspended&&!busy&&!loading&&!readOnly);
 const positions=view?.positions??[];
 const unified=unifiedRelease??Boolean(view&&view.unifiedPage!==undefined);
 const reinvested=view?.singleCapital?view.reinvestments:
  positions.filter(item=>item.fromReinvestment).reduce((sum,item)=>sum+item.principal,0n);
 const recordedPositionProfit=claims?.outstandingPersonal??0n;
 const position=positions.find(item=>item.id===Number(selectedPosition));
 const requiresPosition=mode==='reinvest'&&!unified;
 const requiresExistingPosition=mode!=='deposit';
 const usable=ready&&value.trim()!==''&&(!requiresExistingPosition||positions.length>0);
 function submit(event:FormEvent){
  event.preventDefault();
  if(!usable)return;
  if(mode==='deposit')onDeposit();else if(mode==='withdraw')onWithdraw();else onReinvest();
 }
 const accountReadStatus=loading?'Checking account…':'Account data unavailable';
 const cards=[
  {label:'Active principal',value:view?money(view.capital):'—',Icon:Layers,foot:view?'Combined verified account principal':connected?accountReadStatus:'Available after connection'},
  {label:'Recorded profit & rewards',value:claims?money(claims.internalCurrent):'—',Icon:Coins,foot:'Internal account credit; not wallet cash'},
  {label:'Per-request reward cap',value:view?money(view.ledger.requestCap):'—',Icon:ArrowUpRight,foot:'Available request amount is verified in the withdrawal form'}
 ];
 return <section className="gv1-overview" aria-label="Account overview">
  <div className="gv1-section-head"><div><h2>Your assets</h2><p>Balances from your connected testnet account</p></div>
   <span className="gv1-asset-pill"><span>₮</span> USDT</span></div>
  <div className="gv1-asset-grid">{cards.map(({label,value:cardValue,Icon,foot})=><article className="gv1-asset-card" key={label}>
   <div className="gv1-card-top"><span>{label}</span><Icon size={19}/></div>
   <strong><DigitalValue value={cardValue} unit="USDT"/></strong><small>{foot}</small>
  </article>)}</div>
  {props.children}
  <div className="gv1-home-grid">
   <section className="gv1-panel gv1-operation" aria-labelledby="gv1-manage-title">
    <div className="gv1-panel-title"><div><h2 id="gv1-manage-title">Manage capital</h2><p>Selected asset: USDT</p></div><span className="gv1-round-icon"><ArrowDownLeft size={20}/></span></div>
    <div className="gv1-operation-tabs" role="group" aria-label="Choose account operation">
     {([{id:'deposit',label:'Deposit'},{id:'withdraw',label:'Withdraw profit'},{id:'reinvest',label:'Reinvest'}] as const).map(item=>
      <button key={item.id} type="button" aria-pressed={mode===item.id} disabled={busy} onClick={()=>{if(item.id==='reinvest'&&onAccountReinvest)onAccountReinvest();else if(item.id==='withdraw'&&onAccountWithdraw)onAccountWithdraw();else setMode(item.id);}}>{item.id==='withdraw'&&onAccountWithdraw?'Withdraw earnings':item.label}</button>)}
    </div>
    <form onSubmit={submit}>
     {mode==='reinvest'&&view&&<p className="gv2-small">{view.singleCapital?'Total reinvested':'Combined reinvested principal'}: {money(reinvested)} USDT.
      {' '}{view.singleCapital?'Reinvestment adds to the same investment account.':
       unified?'Reinvestments share one position; each addition has its own lock.':'Each reinvestment remains a separate contract position with its own lock.'}</p>}
     {mode==='reinvest'&&unified&&view&&<V3UnifiedReinvestSummary positions={positions}/>}
     {requiresPosition&&<label className="gv1-field">Source position for recorded profit
      <select value={selectedPosition} disabled={!view||busy||positions.length===0} onChange={event=>onPosition(event.target.value)}>
       {positions.length?positions.map(position=><option key={position.id} value={position.id}>Position #{position.id+1} · {position.fromReinvestment?'Reinvestment':'Deposit'} · {money(position.availableProfit)} USDT profit</option>):<option value="0">No position available</option>}
      </select></label>}
     <label className="gv1-field" htmlFor="gv1-amount"><span>Amount <small>{!view?(connected?accountReadStatus:'Connect wallet to view balance'):mode==='deposit'?
      `Wallet balance: ${money(view.walletTestTokenBalance)} USDT`:mode==='withdraw'||(mode==='reinvest'&&unified)?
      `Recorded account profit: ${money(recordedPositionProfit)} USDT`:position?
      `Recorded position profit: ${money(position.availableProfit)} USDT`:'Select a position'}</small></span>
      <div className="gv1-amount"><input id="gv1-amount" value={value} onChange={event=>onValue(event.target.value)}
       disabled={!view||busy} inputMode="decimal" autoComplete="off" placeholder="0.00"/><span>₮</span></div></label>
     {mode==='deposit'&&view&&!view.registered&&<label className="gv1-field" htmlFor="gv1-referrer">Referral address or invitation link <small>Optional and permanent after registration</small>
      <input id="gv1-referrer" value={referrer} onChange={event=>onReferrer(event.target.value)} disabled={busy} placeholder="0x… or Global invitation link"/>
      {invalidInvite&&!referrer.trim()&&<span role="status" className="gv1-inline-warning">Invitation is invalid. Enter a valid address or continue without one.</span>}</label>}
     {requiresExistingPosition&&view&&positions.length===0&&<p className="gv1-inline-warning">Open a test position before selecting this action.</p>}
     <p className="gv1-operation-note"><LockKeyhole size={15}/>{mode==='withdraw'?'Continue to the account withdrawal form. Eligible records are selected automatically.':
      mode==='reinvest'?(unified?'Recorded profit adds to the account with a separate 90-day lock.':'Recorded profit creates a new 90-day locked position.'):'100% of a test deposit is routed to designated wallets, including fee wallets. This does not establish product spending. Minimum deposit: 10 USDT.'}</p>
     {mode==='deposit'&&view&&typeof view.allowance==='bigint'&&<p className="gv2-small">{view.registered?'': 'Your first deposit also registers this wallet. '}{view.allowance===0n?'Approve the exact amount in your wallet, then return here to confirm the deposit.':'Your current token allowance is '+money(view.allowance)+' USDT. The wallet requests approval only if more is needed.'}</p>}
     {readOnly&&<p id="gv1-read-only" className="gv1-inline-warning">Wallet transactions are disabled in this preview.</p>}
     <button type="submit" className="gv2-primary gv1-action" disabled={!usable} aria-describedby={readOnly?'gv1-read-only':undefined}>
      {mode==='deposit'?'Review test deposit':mode==='withdraw'?'Review withdrawal request':'Review reinvestment'} <ArrowRight size={16}/></button>
     {!view&&!connected&&<div className="gv1-connect-actions"><button type="button" disabled={connecting} onClick={onConnect}><Wallet size={15}/> Connect wallet</button>
      <button type="button" disabled={connecting} onClick={onWalletConnect}>WalletConnect</button></div>}
    </form>
   </section>
   <aside className="gv1-side-panels">
    <section className="gv1-panel gv1-plan" aria-labelledby="gv1-plan-title">
     <div className="gv1-panel-title"><h2 id="gv1-plan-title">Your plan</h2><span className="gv1-plan-tag">{view?(view.registered?v3TierName(view.tier):'Not registered'):connected?accountReadStatus:'Not connected'}</span></div>
     <div className="gv1-plan-figure"><span className="gv1-plan-symbol">◆</span><div>
      <strong><DigitalValue value={view?String(view.dailyRateBps/100):'—'} unit="%"/></strong><small>{V3_HOURLY_TEST?'Rate per eligible one-hour test cycle':'Rate per eligible 24-hour cycle'}</small></div></div>
     <div className="gv1-plan-detail"><span>Recorded capital value</span><b>{view?money(view.capital):'—'} USDT</b></div>
     <div className="gv1-plan-detail"><span>Qualified directs</span><b>{view?`${view.qualifiedDirects} / ${view.requiredDirects}`:'—'}</b></div>
     <div className="gv1-plan-detail"><span>Eligible volume</span><b>{view?`${money(view.qualifiedVolume)} / ${money(view.requiredVolume)}`:'—'}</b></div>
     <button type="button" className="gv1-text-button" onClick={onNetwork}>Explore referral network <ArrowRight size={15}/></button>
    </section>
    <section className="gv1-panel gv1-cycle-preview"><ClockIcon/><div><h3>{V3_HOURLY_TEST?'One-hour test cycle':'24-hour daily cycle'}</h3>
     <p>{view?'The live timer and separate profit details are shown below.':connected?'Cycle details appear after the account is verified.':'Connect your wallet to load the live cycle.'}</p></div></section>
   </aside>
  </div>
 </section>;
}

function ClockIcon(){return <span className="gv1-clock-icon" aria-hidden="true">◷</span>;}
