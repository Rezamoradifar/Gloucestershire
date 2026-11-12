import {describe,expect,it,vi} from 'vitest';
import {acceptPublicConfig} from '../src/config';
import {requestDirectBranches,requestTeamPage,requestTeamProfile,requestTeamVolumes} from '../src/server-team';

const vault='0x1111111111111111111111111111111111111111';
const parent='0x2222222222222222222222222222222222222222';
const child='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64);
acceptPublicConfig({chainId:97,vaultAddress:vault});
const base={version:1,chainId:97,vaultAddress:vault,confirmedHead:197};
const page={...base,kind:'registrations',parent,first:188,last:196,
 members:[{address:child,block:190,index:2,tx:hash}]};
const profile={...base,kind:'member',wallet:child,block:195,
 profile:{referrer:parent,registered:true,active:true,kyc:false,activeDirect:'3',capitalUsd:'800',salesUsd:'1200'}};

describe('verified team API client',()=>{
 it('loads confirmed server registration pages with no wallet eth_getLogs',async()=>{
  const original=globalThis.fetch;
  const mock=vi.fn(async()=>new Response(JSON.stringify(page),{status:200}));
  globalThis.fetch=mock as typeof fetch;
  try{
   const result=await requestTeamPage(parent,188,196);
   expect(result.members).toEqual(page.members);
   expect(mock.mock.calls[0][0]).toContain('/api/team/registrations?parent=');
   expect(mock.mock.calls[0][0]).toContain('from=188');
  }finally{globalThis.fetch=original;}
 });
 it('refuses forged page, mismatched contract and unconfirmed members',async()=>{
  const original=globalThis.fetch;
  try{
   for(const response of [{...page,chainId:56},{...page,vaultAddress:parent},
    {...page,members:[{...page.members[0],block:198}]},
    {...page,members:[page.members[0],page.members[0]]}]){
    globalThis.fetch=(async()=>new Response(JSON.stringify(response),{status:200})) as typeof fetch;
    await expect(requestTeamPage(parent,188,196)).rejects.toThrow();
   }
  }finally{globalThis.fetch=original;}
 });
 it('loads public member state from a confirmed contract RPC snapshot',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(JSON.stringify(profile),{status:200})) as typeof fetch;
  try{
   const user=await requestTeamProfile(child,195);
   expect(user.capitalUsd).toBe(800n);
   expect(user.activeDirect).toBe(3n);
  }finally{globalThis.fetch=original;}
 });
 it('reads verified level volumes as exact bigint values from the server',async()=>{
  const original=globalThis.fetch;
  const report={...base,kind:'volume',wallet:parent,block:197,levels:[
   {level:1,members:2,volume:'1000000000000000000'},
   {level:2,members:1,volume:'2000000000000000000'},
   {level:3,members:0,volume:'0'}
  ]};
  globalThis.fetch=(async()=>new Response(JSON.stringify(report),{status:200})) as typeof fetch;
  try{
   const result=await requestTeamVolumes(parent);
   expect(result.levels[0].volume).toBe(1000000000000000000n);
   expect(result.levels[1].members).toBe(1);
  }finally{globalThis.fetch=original;}
 });
 it('paginates registered direct contract members at one pinned canonical checkpoint',async()=>{
  const original=globalThis.fetch;
  const result={...base,kind:'branches',parent,block:197,blockHash:hash,
   offset:0,limit:12,total:1,members:[{address:child,branchIndex:0}]};
  const mock=vi.fn(async()=>new Response(JSON.stringify(result),{status:200}));
  globalThis.fetch=mock as typeof fetch;
  try{
   const page=await requestDirectBranches(parent,0,12,197);
   expect(page.total).toBe(1);
   expect(page.members[0].address).toBe(child);
   expect(mock.mock.calls[0][0]).toContain('/api/team/branches?');
   expect(mock.mock.calls[0][0]).toContain('block=197');
  }finally{globalThis.fetch=original;}
 });
 it('rejects forged, unconfirmed, missing or duplicate contract branch entries',async()=>{
  const original=globalThis.fetch;
  const member={address:child,branchIndex:0};
  const valid={...base,kind:'branches',parent,block:197,blockHash:hash,offset:0,limit:12,total:1,members:[member]};
  try{
   for(const bad of [
    {...valid,chainId:56},
    {...valid,block:198},
    {...valid,blockHash:'not-a-hash'},
    {...valid,total:2},
    {...valid,members:[member,member]},
    {...valid,members:[{address:parent,branchIndex:0}]},
    {...valid,members:[{address:child,branchIndex:2}]}
   ]){
    globalThis.fetch=(async()=>new Response(JSON.stringify(bad),{status:200})) as typeof fetch;
    await expect(requestDirectBranches(parent,0,12,197)).rejects.toThrow();
   }
   await expect(requestDirectBranches(parent,-1,12)).rejects.toThrow(/Invalid direct-team page/);
   await expect(requestDirectBranches(parent,0,100)).rejects.toThrow(/Invalid direct-team page/);
  }finally{globalThis.fetch=original;}
 });
 it('does not leak server errors or accept unbounded pages',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(JSON.stringify({error:'private RPC credentials'}),{status:503})) as typeof fetch;
  try{
   await expect(requestTeamPage(parent,1,200)).rejects.toThrow(/Invalid team range/);
   await expect(requestTeamPage(parent,188,196)).rejects.toThrow(/temporarily unavailable/);
  }finally{globalThis.fetch=original;}
 });
});
