// One visible Global V3 investment account, backed by real independent
// underlying TESTNET positions; no hidden migrations or fabricated balances.
// Deployed V3 requestProfit/requestPrincipal each reference ONE positionId,
// and it blocks a second concurrent request. Never pretend a multi-position
// on-chain withdrawal is possible without a separately deployed new contract.
export type V3UnderlyingPosition={
 id:number;principal:bigint;reservedPrincipal:bigint;availableProfit:bigint;
 availableDaily:bigint;availableCompound:bigint;reservedProfit:bigint;
 openedAt:number;lastAccruedAt:number;
};
export type V3UnifiedAccount={
 underlyingPositions:number;principal:bigint;currentProfit:bigint;
 currentDaily:bigint;currentCompound:bigint;pendingProfit:bigint;
 maturedPrincipal:bigint;maxSingleProfitRequest:bigint;
 maxSinglePrincipalRequest:bigint;nextAccrualAt:number|null
};
export type V3UnifiedRequestPlan={
 kind:'requestProfit'|'requestPrincipal';amount:bigint;
 positionId:number;maxSingleRequest:bigint;accountTotal:bigint;
};
const max=(a:bigint,b:bigint)=>a>b?a:b;
const min=(a:bigint,b:bigint)=>a<b?a:b;
const principalFree=(p:V3UnderlyingPosition)=>p.principal-p.reservedPrincipal;
function validate(positions:readonly V3UnderlyingPosition[],asOf:number){
 if(!Number.isSafeInteger(asOf)||asOf<0||positions.length>100)
  throw Error('V3 unified account has invalid confirmed state.');
 const seen=new Set<number>();
 for(const p of positions){
  if(!Number.isSafeInteger(p.id)||p.id<0||seen.has(p.id)||
   !Number.isSafeInteger(p.openedAt)||p.openedAt<0||
   !Number.isSafeInteger(p.lastAccruedAt)||p.lastAccruedAt<0||
   [p.principal,p.reservedPrincipal,p.availableProfit,p.availableDaily,
    p.availableCompound,p.reservedProfit].some(x=>x<0n)||
   p.reservedPrincipal>p.principal||
   p.availableProfit!==p.availableDaily+p.availableCompound)
   throw Error('V3 verified underlying position accounting mismatch.');
  seen.add(p.id);
 }
}
export function getV3UnifiedAccount(
 positions:readonly V3UnderlyingPosition[],asOf:number,profitCap:bigint
):V3UnifiedAccount{
 validate(positions,asOf);
 if(profitCap<0n)throw Error('V3 profit withdrawal cap invalid.');
 let principal=0n,currentProfit=0n,currentDaily=0n,currentCompound=0n;
 let pendingProfit=0n,maturedPrincipal=0n,maxSingleProfitRequest=0n;
 let maxSinglePrincipalRequest=0n,nextAccrualAt:number|null=null;
 for(const p of positions){
  principal+=p.principal;
  currentProfit+=p.availableProfit;currentDaily+=p.availableDaily;
  currentCompound+=p.availableCompound;pendingProfit+=p.reservedProfit;
  const due=p.lastAccruedAt+86400;
  if(p.principal>0n&&(nextAccrualAt===null||due<nextAccrualAt))nextAccrualAt=due;
  maxSingleProfitRequest=max(maxSingleProfitRequest,min(p.availableProfit,profitCap));
  if(asOf>=p.openedAt+90*86400){
   maturedPrincipal+=principalFree(p);
   maxSinglePrincipalRequest=max(maxSinglePrincipalRequest,principalFree(p));
  }
 }
 return Object.freeze({
  underlyingPositions:positions.length,principal,currentProfit,currentDaily,
  currentCompound,pendingProfit,maturedPrincipal,maxSingleProfitRequest,
  maxSinglePrincipalRequest,nextAccrualAt
 });
}
export function planV3UnifiedWithdrawal(
 kind:'profit'|'principal',amount:bigint,positions:readonly V3UnderlyingPosition[],
 asOf:number,profitCap:bigint
):V3UnifiedRequestPlan{
 const account=getV3UnifiedAccount(positions,asOf,profitCap);
 if(amount<=0n)throw Error('Enter a positive amount for your unified V3 account.');
 const profit=kind==='profit',limit=profit?account.maxSingleProfitRequest:
  account.maxSinglePrincipalRequest;
 const total=profit?account.currentProfit:account.maturedPrincipal;
 if(profit&&amount>profitCap)
  throw Error('V3 profit request exceeds the contract 10% per-request limit.');
 if(amount>total)
  throw Error('Requested amount exceeds the verified unified V3 '+(profit?'profit':'matured principal')+' balance.');
 if(amount>limit)
  throw Error(
   'Your combined V3 account has enough recorded TEST units, but the existing deployed contract '+
   'can withdraw from only one underlying position per request (maximum '+
   String(limit)+' base units). A genuine single combined on-chain withdrawal '+
   'requires an independently reviewed new contract. No transfer or request was sent.'
  );
 const options=positions.filter(p=>profit?
  p.availableProfit>=amount:
  (asOf>=p.openedAt+90*86400&&principalFree(p)>=amount));
 // Deterministic: use oldest eligible position with enough capacity;
 // NEVER split a user request, create two pending requests or silently alter
 // requested amounts.
 options.sort((a,b)=>a.openedAt-b.openedAt||a.id-b.id);
 const selected=options[0];
 if(!selected)throw Error('No currently eligible V3 underlying position covers this request.');
 return Object.freeze({
  kind:profit?'requestProfit':'requestPrincipal',
  positionId:selected.id,amount,maxSingleRequest:limit,accountTotal:total
 });
}
