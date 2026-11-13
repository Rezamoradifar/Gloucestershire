import {describe,it,expect,vi} from 'vitest';
import {acceptPublicConfig} from '../src/config';
import {adminHead,adminRegistrations,adminUser,adminWithdrawals,AdminUserApiError} from '../src/admin-users-client';

const vault='0x1111111111111111111111111111111111111111';
const parent='0x3333333333333333333333333333333333333333';
const member='0x2222222222222222222222222222222222222222';
const token='0x4444444444444444444444444444444444444444';
const h='0x'+'a'.repeat(64);
const auth='c'.repeat(64);
acceptPublicConfig({chainId:97,vaultAddress:vault});
const head={version:1,chainId:97,vaultAddress:vault,deploymentBlock:100,confirmedHead:197,blockHash:h,
 kind:'head' as const,source:'verified_contract_rpc'};
const registry={...head,kind:'registrations',from:180,to:197,events:[
 {wallet:member,referrer:parent,blockNumber:190,logIndex:1,transactionHash:h}
],complete:false};
const profile={...head,kind:'user',wallet:member,
 profile:{registered:true,active:false,kycVerified:false,referrer:parent,activeDirect:'0',registeredDirect:'5',
  qualifiedDirect:'1',capitalUsd:'10000000000000000000',salesUsd:'0',tier:1,dailyTargetBps:150},
 positionCount:1,positionOffset:0,positions:[{id:0,symbol:'USDT',principal:'10000000000000000000',
  capitalUsd:'10000000000000000000',unlockAt:'1700000000',penaltyBps:200}],
 assets:['BNB','USDT'].map(symbol=>({symbol,address:symbol==='BNB'?'0x0000000000000000000000000000000000000000':token,
  decimals:18,principal:'0',profit:'1000000000000000000',externalDeposited:'0',
  nextWithdrawal:'0',withdrawalCap:'0',reinvested:'0'})),source:'contract_state_at_confirmed_block'};
const withdrawals={...head,kind:'withdrawals',wallet:member,supported:true,page:0,total:1,queueAddress:parent,
 requests:[{id:'1',asset:token,gross:'1000',fee:'0',net:'1000',dueAt:'1700000000',status:3}],
 note:'Queue state is not a transaction receipt.',source:'verified_contract_queue'};

describe('owner-only verified user directory client',()=>{
 const fetchOne=async(data:unknown,fn:()=>Promise<unknown>,code=200)=>{
  const saved=globalThis.fetch;
  const spy=vi.fn(async()=>new Response(JSON.stringify(data),{status:code}));
  globalThis.fetch=spy as typeof fetch;
  try{return {data:await fn(),calls:spy.mock.calls};}finally{globalThis.fetch=saved;}
 };
 it('uses bearer token in headers, never query parameters or storage',async()=>{
  const result=await fetchOne(head,()=>adminHead(auth));
  expect(result.data).toMatchObject(head);
  expect(result.calls[0][0]).toContain('/api/admin-users/head?');
  expect(result.calls[0][1].headers.Authorization).toBe('Bearer '+auth);
  expect(result.calls[0][0]).not.toContain(auth);
 });
 it('rejects forged chain, vault, pinned block and duplicate registry entries',async()=>{
  for(const bad of [{...head,chainId:56},{...head,vaultAddress:parent},{...head,blockHash:'invalid'}])
   await expect(fetchOne(bad,()=>adminHead(auth))).rejects.toThrow();
  const r=await fetchOne(registry,()=>adminRegistrations(auth,head,180,197));
  expect((r.data as typeof registry).events[0].wallet).toBe(member);
  for(const bad of [{...registry,events:[registry.events[0],registry.events[0]]},
   {...registry,from:170},{...registry,blockHash:'0x'+'b'.repeat(64)}])
   await expect(fetchOne(bad,()=>adminRegistrations(auth,head,180,197))).rejects.toThrow();
 });
 it('reports both contract assets, positions and exact token-unit strings without fabricating payout',async()=>{
  const result=await fetchOne(profile,()=>adminUser(auth,head,member));
  expect((result.data as typeof profile).profile.registeredDirect).toBe('5');
  expect((result.data as typeof profile).profile.activeDirect).toBe('0');
  expect((result.data as typeof profile).assets).toHaveLength(2);
  await expect(fetchOne({...profile,profile:{...profile.profile,profit:'not allowed'}},()=>adminUser(auth,head,member))).resolves.toBeDefined();
  await expect(fetchOne({...profile,assets:[profile.assets[0]]},()=>adminUser(auth,head,member))).rejects.toThrow();
 });
 it('separates queue approval state from payment and handles unavailable queue',async()=>{
  const r=await fetchOne(withdrawals,()=>adminWithdrawals(auth,head,member,0));
  expect((r.data as typeof withdrawals).requests[0].status).toBe(3);
  await expect(fetchOne({...withdrawals,requests:[{...withdrawals.requests[0],status:8}]},
    ()=>adminWithdrawals(auth,head,member,0))).rejects.toThrow();
  const unsupported=await fetchOne({...head,kind:'withdrawals',wallet:member,supported:false,source:'queue_not_supported'},
    ()=>adminWithdrawals(auth,head,member,0));
  expect((unsupported.data as {supported:boolean}).supported).toBe(false);
 });
 it('does not confuse an expired administrator session with an empty registry',async()=>{
  await expect(fetchOne({error:'Sign in again'},()=>adminHead(auth),401)).rejects.toBeInstanceOf(AdminUserApiError);
  await expect(adminHead('short')).rejects.toThrow(/Verify the owner wallet/);
 });
});
