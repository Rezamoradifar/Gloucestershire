import {parseUnits} from 'ethers';
import type {V3Action} from './v3-actions';
import type {V3Snapshot} from './v3-chain';

export type V3WithdrawalKind='profit'|'principal'|'referral'|'network';
type V3WithdrawalAction=Extract<V3Action,{kind:'requestProfit'|'requestPrincipal'|'requestReferral'|'requestNetworkReward'}>;

export function parseV3Amount(input:string){
 const value=input.trim();
 if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))throw Error('Enter a positive decimal TEST USDT amount.');
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
  if(amount>view.referralAvailable||amount>view.ledger.requestCap)throw Error('Referral amount exceeds verified claim or cap.');
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
