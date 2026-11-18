// Honest on-chain V3 TESTNET internal-profit readiness for connected users.
// This does NOT infer whether a VPS timer is enabled; that must be checked
// through the actual systemd service logs and confirmed DailyClaimAccrued events.
import type {V3WalletPosition} from './v3-chain';
export type V3AccrualStatus={
 code:'UNREGISTERED'|'NO_POSITION'|'PAUSED'|'SUSPENDED'|
 'CHECKIN_REQUIRED'|'NOT_YET_DUE'|'DUE_NEEDS_KEEPER_OR_USER_TX';
 message:string;eligibleDueCount:number;nextDueAt:number|null;
 canSignCheckIn:boolean;shouldAccrueWithoutCheckIn:boolean;
};
export function summarizeV3AccrualStatus(args:{
 registered:boolean;suspended:boolean;paused:boolean;
 eligible:boolean;capital:bigint;lastCheckIn:number;asOf:number;
 positions:readonly Pick<V3WalletPosition,'id'|'principal'|'lastAccruedAt'>[]
}):V3AccrualStatus{
 const {registered,suspended,paused,eligible,capital,lastCheckIn,asOf,positions}=args;
 if(!Number.isSafeInteger(asOf)||asOf<0||!Number.isSafeInteger(lastCheckIn)||
  lastCheckIn<0||capital<0n||positions.some(p=>
   p.principal<0n||!Number.isSafeInteger(p.lastAccruedAt)||p.lastAccruedAt<0))
  throw Error('Invalid verified V3 accrual status inputs.');
 let nextDueAt:number|null=null,eligibleDueCount=0;
 for(const p of positions){
  if(p.principal<=0n)continue;
  const due=p.lastAccruedAt+86400;
  if(nextDueAt===null||due<nextDueAt)nextDueAt=due;
  if(asOf>=due)eligibleDueCount++;
 }
 const canSignCheckIn=lastCheckIn===0||asOf>=lastCheckIn+3600;
 let code:V3AccrualStatus['code'],message:string;
 if(!registered){code='UNREGISTERED';message='V3 wallet is not registered. Old V2 members are not auto-migrated.';}
 else if(!capital||nextDueAt===null){
  code='NO_POSITION';message='No verified, funded TESTNET V3 position exists for this wallet; there is no daily accrual to record.';
 }else if(paused){
  code='PAUSED';message='V3 accruals are paused on-chain. No profit can be recorded until unpaused.';
 }else if(suspended){
  code='SUSPENDED';message='This V3 account is suspended on-chain.';
 }else if(!eligible||lastCheckIn===0||asOf-lastCheckIn>=86400){
  code='CHECKIN_REQUIRED';message='A valid user-signed check-in within 24h is required by the deployed V3 contract. The keeper cannot forge one.';
 }else if(eligibleDueCount===0){
  code='NOT_YET_DUE';message='The next eligible 24-hour V3 accounting period has not matured. No credit is due yet.';
 }else{
  code='DUE_NEEDS_KEEPER_OR_USER_TX';
  message='V3 test-profit accrual is due, but Current changes only after a confirmed permissionless keeper/user transaction. Check the VPS timer and on-chain receipt.';
 }
 return {code,message,eligibleDueCount,nextDueAt,canSignCheckIn,
  shouldAccrueWithoutCheckIn:code==='DUE_NEEDS_KEEPER_OR_USER_TX'&&!canSignCheckIn};
}
