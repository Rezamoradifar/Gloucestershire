// Read-only user reward breakdown for the already deployed V2 TESTNET contract.
// No new earnings/claims are written. "Daily" is a hypothetical ceiling from
// current principal, not an accrued entitlement; only actually funded credits
// returned by accounts(wallet,asset).profit can be requested on the V2 contract.
// Reinvested basis is cumulative, so its bounded slice is an ILLUSTRATION,
// not exact attribution after partial principal withdrawals.
import {tierFromRecordedUsd,V2_PLAN_DAILY_BPS} from './v2-investment-preview';
import type {V2Account,V2Snapshot} from './v2-chain';

const min=(a:bigint,b:bigint)=>a<b?a:b;
export type V2UserProfitSummary={
 tier:number;dailyBps:bigint;eligibleNow:boolean;
 dailyProjection:bigint;directDailyProjection:bigint;reinvestmentDailyProjection:bigint;
 creditedProfit:bigint;contractRequestableNow:bigint;contractRequestCap:bigint;
 nextRequestAt:number;pending:boolean;
 mode:'READ_ONLY_CONDITIONAL_ESTIMATE_NOT_CREDIT';
};
export function summarizeV2UserProfit(snapshot:V2Snapshot,account:V2Account):V2UserProfitSummary{
 if(account.principal<0n||account.profit<0n||account.reinvested<0n||
  account.cap<0n)throw Error('Invalid V2 on-chain account amounts.');
 const tier=tierFromRecordedUsd(snapshot.capitalUsd);
 const dailyBps=V2_PLAN_DAILY_BPS[tier];
 const reinvestedBasis=min(account.principal,account.reinvested);
 const directBasis=account.principal-reinvestedBasis;
 const directDailyProjection=directBasis*dailyBps/10_000n;
 const reinvestmentDailyProjection=reinvestedBasis*dailyBps/10_000n;
 // Separate integer rounding makes total exactly the sum of its components.
 const dailyProjection=directDailyProjection+reinvestmentDailyProjection;
 const pending=account.requestPending;
 const canRequest=Boolean(snapshot.registered&&!snapshot.suspended&&
  !pending&&snapshot.asOf>=account.nextRequestAt);
 const contractRequestableNow=canRequest?min(account.profit,account.cap):0n;
 return Object.freeze({
  tier,dailyBps,eligibleNow:Boolean(snapshot.eligible&&!snapshot.suspended),
  dailyProjection,directDailyProjection,reinvestmentDailyProjection,
  creditedProfit:account.profit,contractRequestableNow,
  contractRequestCap:account.cap,nextRequestAt:account.nextRequestAt,pending,
  mode:'READ_ONLY_CONDITIONAL_ESTIMATE_NOT_CREDIT' as const
 });
}
