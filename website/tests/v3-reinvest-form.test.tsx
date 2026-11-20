import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseEther} from 'ethers';
import type {V3Snapshot,V3WalletPosition} from '../src/v3-chain';
import type {V3ClaimLedger} from '../src/v3-claim-balance';

// Open the reinvest tab while retaining React's real server-rendering hooks.
vi.mock('react',async importOriginal=>{
 const react=await importOriginal<typeof import('react')>();
 return {...react,useState:(initial:unknown)=>react.useState(initial==='deposit'?'reinvest':initial)};
});
import V3ClassicOverview from '../src/V3ClassicOverview';
const E=(value:string)=>parseEther(value);
const positions=[{id:0,principal:E('1000'),availableProfit:E('273.683399'),availableDaily:E('273.683399'),
 availableCompound:0n,cumulativeDaily:E('273.683399'),cumulativeCompound:0n,compoundedBasis:E('273.683399'),reservedProfit:0n,fromReinvestment:false},
 {id:1,principal:E('1000'),availableProfit:E('684.208498'),availableDaily:E('684.208498'),
 availableCompound:0n,cumulativeDaily:E('684.208498'),cumulativeCompound:0n,compoundedBasis:E('684.208498'),reservedProfit:0n,fromReinvestment:false}] as V3WalletPosition[];
const ledger={chainId:97,runtimeVerified:true,block:1234,asOf:1000,nextRequestAt:0,registered:true,
 suspended:false,paused:false,pendingWithdrawal:false,requestCap:E('100'),referralAvailable:0n,referralReserved:0n,
 networkAvailable:0n,networkReserved:0n,principalLiability:E('2000'),profitLiability:E('957.891897'),
 cash:0n,escrow:0n,positions} as V3ClaimLedger;
const view={capital:E('2000'),walletTestTokenBalance:0n,tier:1,dailyRateBps:70,registered:true,
 suspended:false,paused:false,qualifiedDirects:0,requiredDirects:6,qualifiedVolume:0n,requiredVolume:E('10000'),
 positions,ledger} as V3Snapshot;
const actions={connected:false,busy:true,loading:false,connecting:false,value:'',onValue:()=>{},referrer:'',onReferrer:()=>{},invalidInvite:false,
 selectedPosition:'0',onPosition:()=>{},onDeposit:()=>{},onWithdraw:()=>{},onReinvest:()=>{},
 onNetwork:()=>{},onConnect:()=>{},onWalletConnect:()=>{}};

describe('unified reinvestment form',()=>{
 it.each([
  {state:'disconnected',connected:false,loading:false,message:'Connect wallet to view balance'},
  {state:'loading',connected:true,loading:true,message:'Checking account…'},
  {state:'unavailable',connected:true,loading:false,message:'Account data unavailable'}
 ])('does not present an unloaded account as zero recorded profit when $state',({connected,loading,message})=>{
  const html=renderToStaticMarkup(<V3ClassicOverview {...actions} view={null} unifiedRelease connected={connected} loading={loading}/>);
  expect(html).toContain(message);
  expect(html).not.toContain('Recorded position profit across all sources');
  expect(html).not.toContain('0.00 USDT');
 });
 it('shows a verified zero profit distinctly from an account that has not loaded',()=>{
  const emptyView={...view,capital:0n,positions:[],ledger:{...ledger,positions:[],
   principalLiability:0n,profitLiability:0n,requestCap:0n}};
  const html=renderToStaticMarkup(<V3ClassicOverview {...actions} view={emptyView} unifiedRelease connected/>);
  expect(html).toContain('Recorded position profit across all sources: <strong>0.00 USDT</strong>');
  expect(html).toContain('Referral and network rewards are separate');
 });
 it('shows one total and no source selector in the read-only unified profile',()=>{
  const html=renderToStaticMarkup(<V3ClassicOverview {...actions} view={{...view,unifiedPage:null}}/>);
  expect(html).toContain('957.891897 USDT');
  expect(html).toContain('Referral and network rewards are separate');
  expect(html).not.toContain('Source position for recorded profit');
  expect(html).not.toContain('<select');
 });
 it('keeps source selection for the existing contract that still requires it',()=>{
  const html=renderToStaticMarkup(<V3ClassicOverview {...actions} view={view}/>);
  expect(html).toContain('Source position for recorded profit');
  expect(html).toContain('<select');
  expect(html).toContain('Each reinvestment remains a separate contract position');
 });
});
