import {describe,expect,it,vi} from 'vitest';
import {parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import type {V3Snapshot,V3WalletPosition} from '../src/v3-chain';
import type {UnifiedLot,UnifiedPositionPage} from '../src/v3-unified-position';
import {readUnifiedWithdrawalPages,type UnifiedVaultReader,type UnifiedBookReader} from '../src/v3-unified-position';
import {planV3AccountWithdrawal,summarizeV3AccountWithdrawal} from '../src/v3-account-withdrawal';
import V3AccountWithdrawalForm,{accountWithdrawalFormState,type V3AccountWithdrawalFormProps} from '../src/V3AccountWithdrawalForm';

const E=(value:string)=>parseEther(value),now=200*86400,lock=90*86400;
const wallet='0x0000000000000000000000000000000000000001';
function position(id:number,profit='3',changes:Partial<V3WalletPosition>={}):V3WalletPosition{
 return {id,principal:E('100'),availableProfit:E(profit),availableDaily:E(profit),availableCompound:0n,
  compoundedBasis:E(profit),reservedPrincipal:0n,reservedProfit:0n,cumulativeDaily:E(profit),cumulativeCompound:0n,
  openedAt:now-lock,lastAccruedAt:now,fromReinvestment:false,...changes};
}
function account(positions=[position(0),position(1,'7')]):V3Snapshot{
 return {wallet,block:1234,asOf:now,registered:true,suspended:false,paused:false,pendingWithdrawal:false,
  nextRequestAt:0,positions,referralAvailable:E('6'),networkAvailable:E('7'),ledger:{requestCap:E('20')}} as V3Snapshot;
}
function unifiedAccount(profits:string[],changes:Record<number,Partial<UnifiedLot>>={}){
 const lots:UnifiedLot[]=profits.map((profit,id)=>({id,principal:E('10'),reservedPrincipal:0n,daily:E(profit),compound:0n,
  basis:E(profit),reservedProfit:0n,openedAt:now-lock,lastAccruedAt:now,unlockAt:now,nextAccrualAt:now+3600,...changes[id]}));
 const sum=(field:'principal'|'reservedPrincipal'|'daily'|'compound'|'reservedProfit')=>lots.reduce((total,lot)=>total+lot[field],0n);
 const group=position(1,'0',{fromReinvestment:true,principal:sum('principal'),reservedPrincipal:sum('reservedPrincipal'),
  availableProfit:sum('daily')+sum('compound'),compoundedBasis:sum('daily')+sum('compound'),
  availableDaily:sum('daily'),availableCompound:sum('compound'),reservedProfit:sum('reservedProfit')});
 const view=account([position(0,'0'),group]);
 view.unifiedWithdrawalPages=[];
 for(let start=0;start<lots.length;start+=8){
  const items=lots.slice(start,start+8);
  view.unifiedWithdrawalPages.push({wallet,positionId:1,block:view.block,asOf:now,start,limit:8,totalLots:lots.length,
   principal:group.principal,daily:group.availableDaily,compound:group.availableCompound,reservedProfit:group.reservedProfit,
   availableProfitOnPage:items.reduce((sum,lot)=>sum+lot.daily+lot.compound,0n),
   maturedPrincipalOnPage:items.reduce((sum,lot)=>sum+(now>=lot.unlockAt?lot.principal-lot.reservedPrincipal:0n),0n),lots:items});
 }
 view.unifiedPage=view.unifiedWithdrawalPages[0];
 return view;
}
function props(view=account(),unified=false):V3AccountWithdrawalFormProps{
 return {view,unified,busy:false,readOnly:false,value:'6',kind:'profit',onKind:vi.fn(),onValue:vi.fn(),onSubmit:vi.fn()};
}

describe('one account withdrawal',()=>{
 it('requests referral earnings directly on Account without selecting a position or loading its profit pages',()=>{
  const view=unifiedAccount(['100']);view.singleCapital=true;
  view.referralAvailable=E('0.7');view.referralReserved=E('0.1');view.unifiedWithdrawalPages=undefined;
  const input={...props(view,true),kind:'referral' as const,onKind:undefined,value:'0.7'};
  const state=accountWithdrawalFormState(input);
  expect(state).toMatchObject({canSubmit:true,maximum:E('0.7'),fee:E('0.021'),net:E('0.679')});
  expect(planV3AccountWithdrawal(view,input.value,'referral',true)).toEqual({
   source:'position',action:{kind:'requestReferral',amount:E('0.7')}
  });
  const manual={...input,view:{...view,manualReinvest:true}};
  expect(accountWithdrawalFormState(manual)).toMatchObject({canSubmit:true,fee:E('0.014'),net:E('0.686')});
  expect(renderToStaticMarkup(<V3AccountWithdrawalForm {...manual}/>)).toContain('2%');
  const html=renderToStaticMarkup(<V3AccountWithdrawalForm {...input}/>);
  expect(html).toContain('Withdraw referral earnings');expect(html).toContain('Use maximum');
  expect(html).toContain('0.1 test USDT');expect(html).not.toMatch(/<select|Total principal|personal compound profit/);
  view.ledger.requestCap=E('0.6');
  expect(accountWithdrawalFormState(input)).toMatchObject({canSubmit:false,maximum:E('0.6'),error:'The per-request cap is 0.6 test USDT.'});
  expect(renderToStaticMarkup(<V3AccountWithdrawalForm {...input}/>)).toContain('Remaining commission stays in your account.');
  const balanceLimited={...input,view:{...view,referralAvailable:E('0.5')}};
  expect(accountWithdrawalFormState(balanceLimited)).toMatchObject({canSubmit:false,maximum:E('0.5'),error:'Your available referral balance is 0.5 test USDT.'});
  expect(accountWithdrawalFormState({...input,value:'0.4'})).toMatchObject({canSubmit:true,net:E('0.388')});
  for(const change of [{pendingWithdrawal:true},{nextRequestAt:now+1},{referralAvailable:0n},{paused:true},{suspended:true},{registered:false}]){
   expect(accountWithdrawalFormState({...input,view:{...view,...change},value:'0.1'})).toMatchObject({canSubmit:false,maximum:0n});
  }
  for(const stop of [{busy:true},{readOnly:true}]){
   expect(accountWithdrawalFormState({...input,...stop,value:'0.1'}).canSubmit).toBe(false);
  }
 });
 it('automatically chooses one eligible deposit and keeps the exact amount',()=>{
  expect(planV3AccountWithdrawal(account(),'6.000000000000000001','profit')).toEqual({source:'position',
   action:{kind:'requestProfit',positionId:1,amount:E('6.000000000000000001')}});
  const summary=summarizeV3AccountWithdrawal(account());
  expect(summary.profit).toBe(E('10'));expect(summary.principal).toBe(E('200'));
  expect(summary.maxProfit).toBe(E('7'));expect(summary.maxPrincipal).toBe(E('100'));
  expect(()=>planV3AccountWithdrawal(account(),'9','profit')).toThrow(/up to 7.0 USDT.*one supported transaction/);
  expect(()=>planV3AccountWithdrawal(account(),'11','profit')).toThrow(/exceeds the recorded account profit/);
  expect(()=>planV3AccountWithdrawal(account(),'999','principal')).toThrow(/exceeds the unlocked account principal/);
 });
 it('treats historical reinvestments as separate eligible records on the hourly contract',()=>{
  const view=account([position(0,'0'),position(1,'4',{fromReinvestment:true}),position(2,'5',{fromReinvestment:true})]);
  expect(planV3AccountWithdrawal(view,'5','profit').source).toBe('position');
  expect(summarizeV3AccountWithdrawal(view).maxProfit).toBe(E('5'));
  expect(()=>planV3AccountWithdrawal(view,'6','profit')).toThrow(/one supported transaction/);
 });
 it('reads late additions and chooses a window across read-page boundaries',()=>{
  const view=unifiedAccount(['0','0','0','0','0','0','0','4','5','0']);
  expect(view.unifiedWithdrawalPages?.map(page=>page.availableProfitOnPage)).toEqual([E('4'),E('5')]);
  expect(summarizeV3AccountWithdrawal(view,true).maxProfit).toBe(E('9'));
  const plan=planV3AccountWithdrawal(view,'9','profit',true);
  expect(plan.source).toBe('book');
  if(plan.source!=='book')throw Error('Expected an automatically selected book window.');
  expect(plan.page.positionId).toBe(1);expect(plan.page.start).toBe(1);expect(plan.page.lots.map(lot=>lot.id)).toEqual([1,2,3,4,5,6,7,8]);
  const late=unifiedAccount(Array.from({length:25},(_,index)=>index===24?'2':'0'));
  const selection=planV3AccountWithdrawal(late,'2','profit',true);
  expect(selection.source==='book'&&selection.page.start).toBe(17);
 });
 it('collects every later page at the seed block without re-reading the seed lots',async()=>{
  const view=unifiedAccount(Array.from({length:25},(_,index)=>index===24?'2':'0'));
  const group=view.positions[1],pages=view.unifiedWithdrawalPages!,lots=pages.flatMap(page=>page.lots),reads:number[]=[];
  const at=(options:{blockTag:number})=>expect(options).toEqual({blockTag:1234});
  const vault:UnifiedVaultReader={
   reinvestmentPositionPlusOne:async(_wallet,options)=>{at(options);return 2n;},
   positionOf:async(_wallet,_id,options)=>{at(options);return group;},
   claimableDaily:async(_wallet,_id,options)=>{at(options);return group.availableDaily;},
   claimableCompound:async(_wallet,_id,options)=>{at(options);return group.availableCompound;}
  };
  const book:UnifiedBookReader={
   position:async(_wallet,options)=>{at(options);return {principal:group.principal,reservedPrincipal:group.reservedPrincipal,
    daily:group.availableDaily,compound:group.availableCompound,basis:group.compoundedBasis,reservedProfit:group.reservedProfit,
    cumulativeDaily:group.cumulativeDaily,cumulativeCompound:group.cumulativeCompound,lots:25n};},
   lot:async(_wallet,id,options)=>{at(options);reads.push(id);return {...lots[id],openedAt:BigInt(lots[id].openedAt),lastAccruedAt:BigInt(lots[id].lastAccruedAt)};}
  };
  const complete=await readUnifiedWithdrawalPages(vault,book,pages[0]);
  expect(complete.map(page=>page.start)).toEqual([0,8,16,24]);
  expect([...reads].sort((a,b)=>a-b)).toEqual(Array.from({length:17},(_,index)=>index+8));
  expect(summarizeV3AccountWithdrawal({...view,unifiedWithdrawalPages:complete},true).maxProfit).toBe(E('2'));
  await expect(readUnifiedWithdrawalPages(vault,book,{...pages[0],totalLots:257})).rejects.toThrow(/256 additions/);
 });
 it('preserves each principal lock and excludes reserved principal',()=>{
  const view=account([position(0,'3',{openedAt:now-lock+1}),position(1,'7',{reservedPrincipal:E('90')})]);
  expect(summarizeV3AccountWithdrawal(view).maturedPrincipal).toBe(E('10'));
  expect(planV3AccountWithdrawal(view,'10','principal')).toEqual({source:'position',action:{kind:'requestPrincipal',positionId:1,amount:E('10')}});
  expect(()=>planV3AccountWithdrawal(view,'10.000000000000000001','principal')).toThrow(/exceeds the unlocked account principal/);
  const grouped=unifiedAccount(['1','2'],{0:{reservedPrincipal:E('8')},1:{openedAt:now,unlockAt:now+lock}});
  // Ordinary principal is still immature; the eligible amount is only the first addition.
  grouped.positions[0].openedAt=now;
  expect(summarizeV3AccountWithdrawal(grouped,true).maturedPrincipal).toBe(E('2'));
  expect(planV3AccountWithdrawal(grouped,'2','principal',true).source).toBe('book');
 });
 it('enforces the exact cap, pending state, cooldown, suspension and pause',()=>{
  const view=account();view.ledger.requestCap=E('2');
  expect(summarizeV3AccountWithdrawal(view).maxProfit).toBe(E('2'));
  expect(()=>planV3AccountWithdrawal(view,'2.000000000000000001','profit')).toThrow(/cap/);
  for(const change of [{registered:false},{pendingWithdrawal:true},{nextRequestAt:now+1},{suspended:true},{paused:true}]){
   expect(summarizeV3AccountWithdrawal({...view,...change}).maxProfit).toBe(0n);
   expect(()=>planV3AccountWithdrawal({...view,...change},'1','profit')).toThrow(/paused|cooldown/);
  }
 });
 it('rejects incomplete, stale, mismatched and duplicated account coverage',()=>{
  const view=unifiedAccount(Array(10).fill('1'));
  const pages=view.unifiedWithdrawalPages!;
  for(const changed of [undefined,pages.slice(1),[pages[0],pages[0]],
   [{...pages[0],block:view.block-1},pages[1]],
   [{...pages[0],asOf:now-1},pages[1]],
   [{...pages[0],wallet:'0x0000000000000000000000000000000000000002'},pages[1]]]){
   expect(()=>planV3AccountWithdrawal({...view,unifiedWithdrawalPages:changed},'1','profit',true)).toThrow(/complete|verified block/i);
  }
  const malformed={...pages[0],availableProfitOnPage:E('999')};
  expect(()=>summarizeV3AccountWithdrawal({...view,unifiedWithdrawalPages:[malformed,pages[1]]},true)).toThrow(/inconsistent/);
 });
 it('fails closed above the scan bound without claiming a partial maximum',()=>{
  const view=unifiedAccount(Array(257).fill('1'));
  const state=accountWithdrawalFormState({...props(view,true),value:'1'});
  expect(state.maximum).toBeNull();expect(state.canSubmit).toBe(false);expect(state.coverageError).toMatch(/256 additions/);
  // Independent referral requests do not consume principal or profit additions.
  expect(accountWithdrawalFormState({...props(view,true),kind:'referral',value:'1'}).canSubmit).toBe(true);
 });
 it('renders one amount form with exact fees and no position or addition selectors',()=>{
  const input={...props(),value:'6.000000000000000001'};
  const html=renderToStaticMarkup(<V3AccountWithdrawalForm {...input}/>);
  expect(html.match(/<select /g)).toHaveLength(1);expect(html.match(/<input /g)).toHaveLength(1);
  expect(html).not.toMatch(/Position #|Next additions|Previous additions|Source position/);
  expect(html).toContain('Maximum this dashboard can submit in one request: <strong>7.0 USDT</strong>');
  expect(html).toContain('Gross: 6.000000000000000001 USDT');expect(html).toContain('Fee: 0.18 USDT');
  expect(html).toContain('Net: 5.820000000000000001 USDT');
  expect(html).toContain('cannot combine separate positions into one request');
  expect(accountWithdrawalFormState({...input,readOnly:true}).canSubmit).toBe(false);
  expect(accountWithdrawalFormState({...input,busy:true}).canSubmit).toBe(false);
 });
 it('renders a verification error without a usable form for inconsistent balances',()=>{
  const view=account();view.positions[0].availableProfit+=1n;
  const html=renderToStaticMarkup(<V3AccountWithdrawalForm {...props(view)}/>);
  expect(html).toContain('role="alert"');expect(html).toContain('do not reconcile');
  expect(html).not.toContain('<form');expect(accountWithdrawalFormState(props(view)).canSubmit).toBe(false);
 });
});

it('submits from addition 257 with a verified window and never spends other pages as part of it',()=>{
 const view=unifiedAccount(Array.from({length:257},(_,i)=>i===256?'4':'1'));
 // Model the single-capital dashboard's last window; the vault position is #0.
 const group={...view.positions[1],id:0};
 const last={...view.unifiedWithdrawalPages!.at(-1)!,positionId:0,limit:16};
 view.positions=[group];view.singleCapital=true;view.unifiedWithdrawalPages=undefined;
 view.unifiedPage=last;view.withdrawalPage=last;
 expect(summarizeV3AccountWithdrawal(view,true)).toMatchObject({profit:E('260'),maxProfit:E('4'),maxPrincipal:E('10')});
 expect(planV3AccountWithdrawal(view,'4','profit',true)).toMatchObject({source:'book',page:{start:256,limit:16}});
 expect(()=>planV3AccountWithdrawal(view,'5','profit',true)).toThrow();
 expect(()=>summarizeV3AccountWithdrawal({...view,withdrawalPage:{...last,block:last.block-1}},true)).toThrow();
 expect(()=>summarizeV3AccountWithdrawal({...view,withdrawalPage:{...last,lots:[{...last.lots[0],id:255}]}},true)).toThrow();
});
