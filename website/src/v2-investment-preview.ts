// V2 INVESTMENT PREVIEW ONLY: no signer, allowances, deposits or state mutation.
// The public V2 vault is unaudited and its 10/10/80 routing cannot guarantee
// repayment of gross user principal. These calculations are an isolated demo,
// not an authorization to solicit funds or a promise of daily returns.
import {parseUnits} from 'ethers';

export type V2PreviewAsset='USDT'|'BNB';
export type V2Plan='Starter'|'Basic'|'Growth'|'Pro'|'VIP';
export const V2_PLAN_NAMES=['Starter','Basic','Growth','Pro','VIP'] as const;
export const V2_PLAN_DAILY_BPS=[50n,70n,90n,110n,130n] as const;
export const V2_REFERRAL_BPS=[
 [800n,400n,200n,0n],
 [1000n,500n,300n,0n],
 [1200n,600n,400n,0n],
 [1400n,700n,500n,0n],
 [1600n,800n,600n,400n]
] as const;
export const V2_LOCK_DAYS=90;
export const V2_MINIMUM_USD=10n*10n**18n;
export const V2_VIP_THRESHOLD=50_000n*10n**18n;
export const V2_USD_DECIMALS=18;

export function parsePreviewDecimal(value:string,decimals:number){
 if(typeof value!=='string'||!Number.isSafeInteger(decimals)||decimals<0||decimals>18||
  !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim()))
  throw Error('Enter a valid positive amount without commas or signs.');
 const result=parseUnits(value.trim(),decimals);
 if(result<=0n)throw Error('Enter an amount greater than zero.');
 return result;
}
export function tierFromRecordedUsd(value:bigint){
 if(value<0n)throw Error('Recorded capital cannot be negative.');
 if(value>50_000n*10n**18n)return 4;
 if(value>10_000n*10n**18n)return 3;
 if(value>2_500n*10n**18n)return 2;
 if(value>500n*10n**18n)return 1;
 return 0;
}
export function previewV2Investment({
 asset,amount,decimals,assumedPriceUsd,existingCapitalUsd=0n,kycVerified=false
}:{
 asset:V2PreviewAsset;amount:string;decimals:number;assumedPriceUsd:string;
 existingCapitalUsd?:bigint;kycVerified?:boolean;
}){
 if(!['USDT','BNB'].includes(asset)||typeof kycVerified!=='boolean'||existingCapitalUsd<0n)
  throw Error('Invalid preview context.');
 const principal=parsePreviewDecimal(amount,decimals);
 const hypotheticalUsdPrice=parsePreviewDecimal(assumedPriceUsd,V2_USD_DECIMALS);
 const usdValue=principal*hypotheticalUsdPrice/(10n**BigInt(decimals));
 if(usdValue<V2_MINIMUM_USD)throw Error('The contract requires at least 10 USD per new deposit.');
 const after=existingCapitalUsd+usdValue;
 const tier=tierFromRecordedUsd(after);
 const fee1=principal/10n;
 const fee2=principal/10n;
 const operations=principal-fee1-fee2;
 const hypotheticalDailyUpper=principal*V2_PLAN_DAILY_BPS[tier]/10_000n;
 const levels=V2_REFERRAL_BPS[tier].map((bps,level)=>({
  level:level+1,bps,
  // Only hypothetical: actual credit requires a qualifying upline and
  // additional, independently funded income deposited in the vault.
  maximumForEligibleUpline:hypotheticalDailyUpper*bps/10_000n
 }));
 const maxConditionalUplines=levels.reduce((sum,x)=>sum+x.maximumForEligibleUpline,0n);
 return Object.freeze({
  mode:'SIMULATION_ONLY_NO_CHAIN_WRITES' as const,
  asset,decimals,amount:principal,recordedPrincipal:principal,
  priceAssumptionUsd:hypotheticalUsdPrice,usdValue,existingCapitalUsd,
  capitalAfterUsd:after,tier,plan:V2_PLAN_NAMES[tier],
  dailyCapBps:V2_PLAN_DAILY_BPS[tier],
  hypotheticalDailyCap:hypotheticalDailyUpper,
  feeWallet1:fee1,feeWallet2:fee2,operations,liquidPrincipalInVaultFromThisDeposit:0n,
  estimatedGrossPrincipalShortfall:principal,
  referralLevels:levels,
  maximumIllustrativeFundedRevenueNeeded:hypotheticalDailyUpper+maxConditionalUplines,
  requiresAdminVipKyc:after>V2_VIP_THRESHOLD&&!kycVerified,
  requiresWalletTransactionInRealContract:true,
  liveTransferPerformed:false,
  realUsdtCredited:false,
  noGuaranteedProfit:true
 });
}
