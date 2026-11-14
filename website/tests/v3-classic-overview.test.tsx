import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseEther} from 'ethers';
import V3ClassicOverview from '../src/V3ClassicOverview';
import type {V3Snapshot} from '../src/v3-chain';
import type {V3ClaimLedger} from '../src/v3-claim-balance';

const to=(value:string)=>parseEther(value);
const actions={busy:false,loading:false,connecting:false,value:'',onValue:()=>{},referrer:'',onReferrer:()=>{},invalidInvite:false,
 selectedPosition:'0',onPosition:()=>{},onDeposit:()=>{},onWithdraw:()=>{},onReinvest:()=>{},
 onNetwork:()=>{},onConnect:()=>{},onWalletConnect:()=>{}};
const ledger:V3ClaimLedger={chainId:97,runtimeVerified:true,block:1234,asOf:1000,nextRequestAt:0,
 registered:true,suspended:false,pendingWithdrawal:false,requestCap:to('100'),referralAvailable:to('1.2'),
 principalLiability:to('1000'),profitLiability:to('15.249'),cash:to('1000'),escrow:0n,
 positions:[{id:0,principal:to('1000'),availableProfit:to('14.049'),availableDaily:to('14'),
  availableCompound:to('0.049'),cumulativeDaily:to('14'),cumulativeCompound:to('0.049'),reservedProfit:0n}]};

describe('classic Global layout with current V3 data',()=>{
 it('shows the original layout without inventing a balance before connection',()=>{
  const html=renderToStaticMarkup(<V3ClassicOverview {...actions} view={null}/>);
  for(const label of ['Your assets','Active principal','Recorded profit &amp; rewards',
   'Largest claim request limit','Manage capital','Your plan','24-hour daily cycle'])expect(html).toContain(label);
  expect(html).toContain('aria-label="— TEST"');
  expect(html).toContain('Connect wallet');
  expect(html).not.toContain('aria-label="0.00 TEST"');
 });
 it('shows the exact verified V3 capital and separate recorded claims',()=>{
  const view={capital:to('1000'),walletTestTokenBalance:to('7'),tier:1,dailyRateBps:70,
   registered:true,suspended:false,paused:false,qualifiedDirects:2,requiredDirects:6,
   qualifiedVolume:to('500'),requiredVolume:to('10000'),positions:[{id:0}],ledger} as unknown as V3Snapshot;
  const html=renderToStaticMarkup(<V3ClassicOverview {...actions} view={view}/>);
  for(const value of ['1,000.00','15.249','14.049'])expect(html).toContain(`aria-label="${value} TEST"`);
  expect(html).toContain('Basic');
  expect(html).toContain('2 / 6');
  expect(html).toContain('10% / 10% / 80%');
 });
});
