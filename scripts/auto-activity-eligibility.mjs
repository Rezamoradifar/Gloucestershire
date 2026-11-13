// Testnet-only, read-only decision engine for automatic activity verification.
// A signed check-in is evidence of control of the wallet; it is never KYC.
// Do not use this module to infer a payment, modify an old epoch, or backdate status.
export const autoActivityPolicyVersion=1;
const validAddress=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value);
const safe=value=>Number.isSafeInteger(value)&&value>=0;
export function evaluateAutoActivity({
 chainId,vaultAddress,wallet,confirmedBlock,confirmedTimestamp,registered,active,
 vipKyc,capitalUsd,validSignedCheckIn,checkInTimestamp,
 nowTimestamp,minimumCapitalUsd=1n,eligibleSince=0,
}){
 if(chainId!==97||!validAddress(vaultAddress)||!validAddress(wallet)||
 !safe(confirmedBlock)||!safe(confirmedTimestamp)||!safe(nowTimestamp)||
 typeof registered!=='boolean'||typeof active!=='boolean'||typeof vipKyc!=='boolean'||
 typeof validSignedCheckIn!=='boolean'||typeof capitalUsd!=='bigint'||
 typeof minimumCapitalUsd!=='bigint'||minimumCapitalUsd<0n||!safe(eligibleSince)||
 checkInTimestamp!==null&&!safe(checkInTimestamp))
  throw Error('AUTO_ACTIVITY_UNVERIFIED_INPUT');
 const blockers=[];
 if(confirmedTimestamp>nowTimestamp+30||nowTimestamp-confirmedTimestamp>300)blockers.push('CHAIN_SNAPSHOT_STALE');
 if(!registered)blockers.push('WALLET_NOT_REGISTERED');
 if(capitalUsd<minimumCapitalUsd)blockers.push('MINIMUM_CAPITAL_NOT_MET');
 if(!validSignedCheckIn||checkInTimestamp===null)blockers.push('SIGNED_24H_CHECKIN_REQUIRED');
 else if(checkInTimestamp<eligibleSince||confirmedTimestamp-checkInTimestamp>=86400||
   checkInTimestamp>confirmedTimestamp+30)blockers.push('SIGNED_24H_CHECKIN_EXPIRED');
 return Object.freeze({
  wallet,chainId,contract:vaultAddress,confirmedBlock,
  observedActive:active,observedKyc:vipKyc,
  // The existing contract setter accepts both flags; all callers must preserve
  // the user's last confirmed KYC value. A stronger, independently enforced
  // KYC-only-admin guarantee requires a new role-separated vault contract.
  action:blockers.length?'none':active?'already_active':'activate_without_kyc_change',
  blockers:Object.freeze(blockers),requiresHumanKycReview:!vipKyc,
  eligibleSince,checkInTimestamp
 });
}
