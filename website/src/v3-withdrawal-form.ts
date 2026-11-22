import {formatUnits,parseUnits} from 'ethers';
import {normalizeAmount} from './money';
import type {V3Action} from './v3-actions';
import type {V3Snapshot} from './v3-chain';

export type V3WithdrawalKind='profit'|'principal'|'referral'|'network';
type V3WithdrawalAction=Extract<V3Action,{kind:'requestProfit'|'requestPrincipal'|'requestReferral'|'requestNetworkReward'}>;

export function v3ProfitFeeBps(manualReinvest=false){return manualReinvest?200n:300n;}
export function v3WithdrawalFee(amount:bigint,principal:boolean,manualReinvest=false){
 return amount*(principal?3000n:v3ProfitFeeBps(manualReinvest))/10000n;
}

export function parseV3Amount(input:string){
 const value=normalizeAmount(input);
 if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))throw Error('Enter a positive decimal USDT amount.');
 const parsed=parseUnits(value,18);
 if(parsed<=0n)throw Error('Amount must be positive.');
 return parsed;
}

export function prepareV3WithdrawalRequest(view:V3Snapshot|null,input:string,position:string,kind:V3WithdrawalKind):V3WithdrawalAction{
 if(!view)throw Error('No verified V3 account.');
 const amount=parseV3Amount(input);
 if(!view.registered||view.suspended||view.pendingWithdrawal||view.asOf<view.nextRequestAt)
  throw Error('Withdrawal already pending, account suspended or 72-hour cooldown active.');
 if(kind==='referral'){
  const capped=view.ledger.requestCap<view.referralAvailable;
  const maximum=capped?view.ledger.requestCap:view.referralAvailable;
  if(amount>maximum)throw Error((capped?'The per-request cap is ':'Your available referral balance is ')+formatUnits(maximum,18)+' test USDT.');
  return {kind:'requestReferral',amount};
 }
 if(kind==='network'){
  if(amount>view.networkAvailable||amount>view.ledger.requestCap)throw Error('Network amount exceeds the verified claim or cap.');
  return {kind:'requestNetworkReward',amount};
 }
 const selected=view.positions.find(item=>item.id===Number(position));
 if(!selected)throw Error('Select a verified V3 position.');
 if(kind==='profit'){
  if(amount>selected.availableProfit||amount>view.ledger.requestCap)throw Error('Claim exceeds recorded position profit or 10% per-request limit.');
  return {kind:'requestProfit',positionId:selected.id,amount};
 }
 if(view.asOf<selected.openedAt+90*86400||amount>selected.principal-selected.reservedPrincipal)
  throw Error('This principal is not past its 90-day lock or is already reserved.');
 return {kind:'requestPrincipal',positionId:selected.id,amount};
}
