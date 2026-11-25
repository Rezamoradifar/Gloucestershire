import {describe,it,expect,vi} from 'vitest';
import {parseEther as u} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import {formatShare} from '../src/v3-format';
import {portfolioLimits,portfolioQuote} from '../src/v3-portfolio';
import {v3ParseReleaseConfig,unifiedWalletEnabled} from '../src/v3-site-config';
import {verifiedPortfolioCapBps,type V3Snapshot} from '../src/v3-chain';
import V3SeparateTestAccounts from '../src/V3SeparateTestAccounts';
import V3PortfolioWithdrawal from '../src/V3PortfolioWithdrawal';

const wallet='0x1111111111111111111111111111111111111111';
function snapshot(){
 const lot={id:0,principal:u('1000'),reservedPrincipal:0n,daily:u('7'),compound:0n,basis:u('7'),reservedProfit:0n,
  openedAt:100,lastAccruedAt:200,unlockAt:100+90*86400,nextAccrualAt:3800};
 const position={id:0,principal:lot.principal,reservedPrincipal:0n,availableProfit:lot.daily,availableDaily:lot.daily,availableCompound:0n,
  reservedProfit:0n,compoundedBasis:lot.daily,fromReinvestment:true,openedAt:100,lastAccruedAt:200};
 const asOf=lot.unlockAt+1;
 const page={wallet,positionId:0,block:17,asOf,start:0,limit:8,totalLots:1,principal:lot.principal,daily:lot.daily,compound:0n,reservedProfit:0n,
  availableProfitOnPage:lot.daily,maturedPrincipalOnPage:lot.principal,lots:[lot]};
 return {wallet,block:17,asOf,registered:true,suspended:false,paused:false,portfolio:true,tier:1,earningsCapBps:1000,singleCapital:true,positions:[position],nextRequestAt:0,
  unifiedWithdrawalPages:[page],pendingWithdrawal:false,ledger:{requestCap:u('100')},originalDeposits:u('1000'),reinvestments:0n,
  referralAvailable:u('.7'),networkAvailable:u('35'),networkReserved:0n,referralReserved:0n} as unknown as V3Snapshot;
}
describe('portfolio withdrawal review',()=>{
 it('shows one gross field and matches the itemised single-signature amount',()=>{
  const v=snapshot(),limits=portfolioLimits(v),quote=portfolioQuote(limits,u('42.7'),false);
  expect(limits.earnings).toBe(u('42.7'));
  expect(quote.action.parts).toEqual({personal:u('7'),referral:u('.7'),network:u('35'),principal:0n});
  expect(quote.net).toBe(u('41.846'));
  expect(()=>portfolioQuote(limits,u('42.700000000000000001'),false)).toThrow();
  const mixed=portfolioQuote(limits,u('52.7'),true);
  expect(mixed.action.parts.principal).toBe(u('10'));expect(mixed.net).toBe(u('48.846'));
  const html=renderToStaticMarkup(<V3PortfolioWithdrawal view={v} busy={false} readOnly={false} value="42.7" onValue={vi.fn()} onPage={vi.fn()} onSubmit={vi.fn()}/>);
  expect(html).toContain('41.846');expect(html).toContain('One request across your account');expect(html).not.toContain('type="radio"');
 });
 it('shows the full cap percentage and limits only earnings, including a zero rate and a zero basis',()=>{
  const view={...snapshot(),planPortfolio:true as const,earningsCapBps:325};
  view.ledger={...view.ledger,requestCap:u('32.5')};
  const render=(v:V3Snapshot)=>renderToStaticMarkup(<V3PortfolioWithdrawal view={v} busy={false} readOnly={false}
   value="" onValue={vi.fn()} onPage={vi.fn()} onSubmit={vi.fn()}/>);
  expect(render(view)).toContain('Basic plan earnings cap <b>3.25%</b>');
  expect(render(view)).toContain('Choose a share of the amount available now');
  expect(portfolioLimits(view).earnings).toBe(u('32.5'));
  const legacy=render(snapshot());
  expect(legacy).toContain('Earnings cap per request <b>10%</b>');expect(legacy).not.toContain('Basic plan earnings cap');
  const zero={...view,earningsCapBps:0,ledger:{...view.ledger,requestCap:0n}};
  expect(render(zero)).toContain('Basic plan earnings cap <b>0%</b>');
  expect(portfolioQuote(portfolioLimits(zero),u('3'),true).action.parts).toEqual({personal:0n,referral:0n,network:0n,principal:u('3')});
  expect(render({...view,originalDeposits:0n,ledger:{...view.ledger,requestCap:0n}})).toContain('Basic plan earnings cap <b>3.25%</b>');
 });
 it('checks the on-chain rate against the exact floored cap at any token precision',()=>{
  expect(verifiedPortfolioCapBps(325n,101n,3n)).toBe(325);
  expect(verifiedPortfolioCapBps(0n,101n,0n)).toBe(0);
  expect(verifiedPortfolioCapBps(10000n,101n,101n)).toBe(10000);
  expect(verifiedPortfolioCapBps(325n,0n,0n)).toBe(325);
  expect(()=>verifiedPortfolioCapBps(325n,101n,4n)).toThrow();
  expect(()=>verifiedPortfolioCapBps(10001n,0n,0n)).toThrow();
  expect(()=>verifiedPortfolioCapBps(-1n,0n,0n)).toThrow();
 });
 it('uses the actual shared cap, age, pending state and verified coverage',()=>{
  const v=snapshot();v.ledger.requestCap=u('20');
  expect(portfolioLimits(v).earnings).toBe(u('20'));
  expect(portfolioQuote(portfolioLimits(v),u('20'),false).action.parts).toEqual({referral:u('.7'),network:u('19.3'),personal:0n,principal:0n});
  expect(portfolioLimits({...v,pendingWithdrawal:true})).toMatchObject({principal:0n,earnings:0n});
  expect(()=>portfolioLimits({...v,block:18})).toThrow();
  expect(()=>portfolioLimits({...v,portfolio:undefined})).toThrow();
 });
 it('uses exact decimal ratios, preserves missing denominators and negative margins',()=>{
  expect(formatShare(1n,3n)).toBe('33.33%');expect(formatShare(0n,1n)).toBe('0%');
  expect(formatShare(0n,0n)).toBe('—');expect(formatShare(1n,50000n)).toBe('<0.01%');expect(formatShare(-1n,4n)).toBe('−25%');
 });
 it('only enables portfolio writes for its own verified release path or its matching primary',()=>{
  const address=(i:number)=>'0x'+i.toString(16).padStart(40,'0'),hash='0x'+'a'.repeat(64);
  const config=v3ParseReleaseConfig({address:address(10),runtimeHash:hash,deploymentTx:hash,unifiedMode:'portfolio-testnet',book:address(11),
   network:address(12),networkRuntimeHash:hash,bookRuntimeHash:hash});
  expect(config?.unified).toMatchObject({portfolio:true,accountReinvest:true,manualReinvest:true});
  const ok=(path:string,mode:string)=>unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',mode);
  expect(ok('/portfolio-test/','')).toBe(true);expect(ok('/','portfolio-testnet')).toBe(true);
  expect(ok('/plan-portfolio-test/','portfolio-testnet')).toBe(false);
  expect(ok('/account-reinvest-test/','portfolio-testnet')).toBe(false);expect(ok('/','account-reinvest-testnet')).toBe(false);
 });
 it('keeps the plan-based account isolated from the V7 route and points members to previous balances',()=>{
  const address=(n:number)=>'0x'+n.toString(16).padStart(40,'0'),hash='0x'+'a'.repeat(64);
  const mode='plan-portfolio-testnet';
  const config=v3ParseReleaseConfig({address:address(10),runtimeHash:hash,deploymentTx:hash,unifiedMode:mode,
   book:address(11),network:address(12),bookRuntimeHash:hash,networkRuntimeHash:hash});
  expect(config?.unified).toMatchObject({planPortfolio:true,portfolio:true,accountReinvest:true,manualReinvest:true});
  const enabled=(path:string,primary='')=>unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',primary);
  expect(enabled('/plan-portfolio-test/index.html')).toBe(true);
  for(const route of ['/','/portfolio-test/','/account-reinvest-test/','/previous-hourly-test/']){
   expect(enabled(route)).toBe(false);
   expect(enabled(route,mode)).toBe(false);
   expect(enabled(route,'portfolio-testnet')).toBe(false);
  }
  expect(renderToStaticMarkup(<V3SeparateTestAccounts config={config}/>)).toContain('href="/portfolio-test/"');
 });
});
