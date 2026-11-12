import {describe,it,expect} from 'vitest';
import {ZeroAddress} from 'ethers';
import {acceptPublicConfig} from '../src/config';
import {parseVerifiedHistorySnapshot,requestVerifiedHistory} from '../src/server-event-history';
import {parseVerifiedTeamMember,requestVerifiedTeamMember} from '../src/team-data';

const vault='0x1111111111111111111111111111111111111111';
const wallet='0x2222222222222222222222222222222222222222';
const member='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64);
acceptPublicConfig({chainId:97,vaultAddress:vault});
const profile={version:1,chainId:97,vaultAddress:vault,wallet:member,referrer:wallet,
 blockNumber:197,blockHash:hash,registered:true,active:true,kyc:false,
 activeDirect:'2',capitalUsd:'15000000000000000000',salesUsd:'30000000000000000000',
 source:'contract+rpc'};
const teamPage={version:1,chainId:97,vaultAddress:vault,wallet,asset:ZeroAddress,
 scope:'wallet',kind:'team',confirmedHead:197,first:188,last:196,windowHash:hash,source:'database+rpc',logs:[]};
describe('server-verifiable team and referral data',()=>{
 it('accepts only confirmed member profiles bound to the configured contract',()=>{
  const result=parseVerifiedTeamMember(profile,member);
  expect(result.activeDirect).toBe(2n);
  expect(result.capitalUsd).toBe(15000000000000000000n);
  expect(()=>parseVerifiedTeamMember({...profile,chainId:56},member)).toThrow(/could not be verified/);
  expect(()=>parseVerifiedTeamMember({...profile,vaultAddress:wallet},member)).toThrow();
  expect(()=>parseVerifiedTeamMember({...profile,wallet},member)).toThrow();
  expect(()=>parseVerifiedTeamMember({...profile,capitalUsd:'-1000'},member)).toThrow();
  expect(()=>parseVerifiedTeamMember({...profile,source:'local'},member)).toThrow();
 });
 it('uses the private server API for member details, never wallet historical RPC',async()=>{
  const calls:string[]=[];
  const fake=async(url:RequestInfo|URL)=>{
   calls.push(String(url));
   return new Response(JSON.stringify(profile),{status:200});
  };
  const data=await requestVerifiedTeamMember(member,fake as typeof fetch);
  expect(calls[0]).toContain('/api/team/member?wallet=');
  expect(data.referrer).toBe(wallet);
 });
 it('validates only registered event windows in bounded server RPC pages',async()=>{
  const query={wallet,asset:ZeroAddress,scope:'wallet' as const,kind:'team' as const,from:188,to:196};
  const fetcher=async(url:RequestInfo|URL)=>{
   expect(String(url)).toContain('kind=team');
   return new Response(JSON.stringify(teamPage),{status:200});
  };
  const page=await requestVerifiedHistory({...query,fetcher:fetcher as typeof fetch});
  expect(page.source).toBe('database+rpc');
  expect(parseVerifiedHistorySnapshot(teamPage,query).logs).toHaveLength(0);
  await expect(requestVerifiedHistory({...query,asset:vault,fetcher:fetcher as typeof fetch})).rejects.toThrow(/Invalid history server request/);
  expect(()=>parseVerifiedHistorySnapshot({...teamPage,source:'unsupported'},query)).toThrow();
 });
});
