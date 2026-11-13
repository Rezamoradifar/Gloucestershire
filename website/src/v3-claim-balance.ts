// Pure future V3 account renderer model; only accepts already VERIFIED chain-97
// contract state. Not connected to the currently deployed V2 website.
// Never treat accrued liabilities as spendable wallet tokens or funded payouts.
export type V3ClaimPosition={
 id:number;principal:bigint;availableProfit:bigint;
 availableDaily:bigint;availableCompound:bigint;
 cumulativeDaily:bigint;cumulativeCompound:bigint;
 reservedProfit:bigint;
};
export type V3ClaimLedger={
 chainId:number;runtimeVerified:boolean;block:number;
 registered:boolean;suspended:boolean;pendingWithdrawal:boolean;
 asOf:number;nextRequestAt:number;requestCap:bigint;
 referralAvailable:bigint;referralReserved:bigint;principalLiability:bigint;
 profitLiability:bigint;cash:bigint;escrow:bigint;
 positions:V3ClaimPosition[];
};
export function v3PrepareUserClaims(ledger:V3ClaimLedger){
 if(ledger.chainId!==97||ledger.runtimeVerified!==true||
  !Number.isSafeInteger(ledger.block)||ledger.block<=0)
  throw Error('V3 chain or contract runtime is unverified; do not display account claims.');
 if(!Number.isSafeInteger(ledger.asOf)||!Number.isSafeInteger(ledger.nextRequestAt)||
  ledger.asOf<0||ledger.nextRequestAt<0)throw Error('Invalid verified block time.');
 const totals=[ledger.requestCap,ledger.referralAvailable,ledger.referralReserved,ledger.principalLiability,
  ledger.profitLiability,ledger.cash,ledger.escrow];
 if(totals.some(x=>x<0n)||ledger.escrow>ledger.cash)
  throw Error('V3 liability or reserved cash is invalid.');
 let outstandingDaily=0n,outstandingCompound=0n,cumulativeDaily=0n,cumulativeCompound=0n;
 let recordedPrincipal=0n,positionMax=0n,reservedPersonal=0n;
 const seen=new Set<number>();
 for(const p of ledger.positions){
  if(!Number.isSafeInteger(p.id)||p.id<0||seen.has(p.id))throw Error('Duplicate or invalid V3 position.');
  seen.add(p.id);
  if([p.principal,p.availableProfit,p.availableDaily,p.availableCompound,
       p.cumulativeDaily,p.cumulativeCompound,p.reservedProfit].some(x=>x<0n)||
    p.availableProfit!==p.availableDaily+p.availableCompound||
    p.cumulativeDaily<p.availableDaily||p.cumulativeCompound<p.availableCompound)
   throw Error('V3 claim split does not reconcile; reject display.');
  reservedPersonal+=p.reservedProfit;
  outstandingDaily+=p.availableDaily;
  outstandingCompound+=p.availableCompound;
  cumulativeDaily+=p.cumulativeDaily;
  cumulativeCompound+=p.cumulativeCompound;
  recordedPrincipal+=p.principal;
  const requestLimit=p.availableProfit<ledger.requestCap?p.availableProfit:ledger.requestCap;
  if(requestLimit>positionMax)positionMax=requestLimit;
 }
 const eligible=ledger.registered&&!ledger.suspended&&!ledger.pendingWithdrawal&&
  ledger.asOf>=ledger.nextRequestAt;
 const referralMax=ledger.referralAvailable<ledger.requestCap?
  ledger.referralAvailable:ledger.requestCap;
 const maxSingleRequest=eligible?(positionMax>referralMax?positionMax:referralMax):0n;
 // Internal Current is ONLY outstanding, on-chain recorded profit/compound/referral
 // claims. This does NOT create an ERC-20 balance or transfer to any wallet.
 // Pending withdrawal amounts are moved out of Current into a reserved bucket.
 const internalCurrent=outstandingDaily+outstandingCompound+ledger.referralAvailable;
 const pendingInternal=reservedPersonal+ledger.referralReserved;
 const internalRecordedTotal=internalCurrent+pendingInternal;
 if(internalRecordedTotal>ledger.profitLiability||recordedPrincipal>ledger.principalLiability)
  throw Error('V3 internal Current exceeds verified on-chain global liabilities.');
 const accruedUnfunded=ledger.principalLiability+ledger.profitLiability>ledger.cash?
  ledger.principalLiability+ledger.profitLiability-ledger.cash:0n;
 return Object.freeze({
  status:'VERIFIED_V3_TEST_CLAIMS_NOT_PAYOUT' as const,
  block:ledger.block,recordedPrincipal,
  outstandingDaily,outstandingCompound,
  outstandingPersonal:outstandingDaily+outstandingCompound,
  outstandingReferral:ledger.referralAvailable,
  internalCurrent,pendingInternal,internalRecordedTotal,
  currentWalletTransfer:0n,
  cumulativeDaily,cumulativeCompound,
  maxSingleRequest,
  managerCashPayoutConfirmed:false,
  currentVaultCash:ledger.cash,
  reservedEscrowCash:ledger.escrow,
  overallUnfundedLiability:accruedUnfunded,
  pendingWithdrawal:ledger.pendingWithdrawal
 });
}
