import {allocateAccountEarnings,totalAccountEarnings} from './v3-account-earnings';
import {unifiedLots,v3AccountTotals} from './v3-account-withdrawal';
import type {V3Snapshot} from './v3-chain';
import type {UnifiedLot} from './v3-unified-position';
import {v3WithdrawalFee} from './v3-withdrawal-form';

export type PortfolioAction={
 kind:'requestAccountWithdrawal';amount:bigint;
 parts:{personal:bigint;referral:bigint;network:bigint;principal:bigint};
 profitStart:number;principalStart:number;
};
function bestWindow(lots:UnifiedLot[],amount:(lot:UnifiedLot)=>bigint){
 let sum=0n,best=0n,start=0;
 for(let i=0;i<lots.length;i++){
  sum+=amount(lots[i]);
  if(i>=64)sum-=amount(lots[i-64]);
  if(sum>best){best=sum;start=lots[Math.max(0,i-63)].id;}
 }
 return {amount:best,start};
}

export function portfolioLimits(view:V3Snapshot){
 if(!view.portfolio)throw Error('This contract supports single-source requests.');
 v3AccountTotals(view.positions);
 if(view.positions.length>1||view.positions.some(p=>!p.fromReinvestment))throw Error('The capital account could not be verified.');
 const lots=view.positions.length?unifiedLots(view,view.positions[0]).lots:[];
 const profit=bestWindow(lots,l=>l.daily+l.compound);
 const principal=bestWindow(lots,l=>view.asOf>=l.unlockAt?l.principal-l.reservedPrincipal:0n);
 const available={personal:profit.amount,referral:view.referralAvailable,network:view.networkAvailable};
 const earnings=totalAccountEarnings(available);
 const cap=view.ledger.requestCap;
 const ready=view.registered&&!view.suspended&&!view.paused&&!view.pendingWithdrawal&&view.asOf>=view.nextRequestAt;
 return {available,earnings:ready?(earnings<cap?earnings:cap):0n,principal:ready?principal.amount:0n,
  profitStart:profit.start,principalStart:principal.start,ready};
}

export function portfolioQuote(limits:ReturnType<typeof portfolioLimits>,gross:bigint,includePrincipal:boolean){
 const earnings=gross<limits.earnings?gross:limits.earnings;
 const principal=gross-earnings;
 if(!limits.ready||gross<=0n||principal>(includePrincipal?limits.principal:0n))
  throw Error('Enter an amount within the current withdrawal limit.');
 const split=earnings?allocateAccountEarnings(limits.available,earnings):{personal:0n,referral:0n,network:0n};
 const earningsFee=v3WithdrawalFee(earnings,false,true),principalFee=v3WithdrawalFee(principal,true);
 const action:PortfolioAction={kind:'requestAccountWithdrawal',amount:gross,parts:{...split,principal},
  profitStart:limits.profitStart,principalStart:limits.principalStart};
 return {action,earningsFee,principalFee,net:gross-earningsFee-principalFee};
}
