import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Wallet,getAddress} from 'ethers';
const alice=Wallet.createRandom(),bob=Wallet.createRandom(),contract='0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522';
const state=vi.hoisted(()=>({provider:null as any}));
vi.mock('../src/config',()=>({configured:true,chainId:97,vaultAddress:'0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522'}));
vi.mock('../src/wallet',()=>({getWalletProvider:()=>state.provider}));
import {dailyActivityApi,signDailyActivity,requireDailyActivityStatus,readAllocationStatus} from '../src/daily-activity-client';

let methods:string[];
beforeEach(()=>{
 methods=[];vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com'}});
 state.provider={request:vi.fn(async({method,params}:any)=>{
  methods.push(method);if(method==='eth_chainId')return '0x61';if(['eth_accounts','eth_requestAccounts'].includes(method))return [alice.address];
  if(method==='personal_sign')return alice.signMessage(Buffer.from(params[0].slice(2),'hex'));
  throw Error('Activity must not call a contract or transfer funds: '+method);
 })};
});
afterEach(()=>vi.unstubAllGlobals());
function challenge(){
 const issuedAt=Date.now(),issuedBlock={number:100,hash:'0x'+'a'.repeat(64),timestamp:Math.floor(issuedAt/1000)-3};
 const c={chainId:97,vaultAddress:contract,origin:'https://globaldroptrade.com',wallet:alice.address,nonce:'ab'.repeat(24),issuedAt,expiresAt:issuedAt+300000,issuedBlock,windowSeconds:86400,message:''};
 c.message=['GlobalDropTrade daily activity',`Origin: ${c.origin}`,`Chain: ${c.chainId}`,`Contract: ${getAddress(contract)}`,`Wallet: ${alice.address}`,`Nonce: ${c.nonce}`,`Issued: ${new Date(c.issuedAt).toISOString()}`,`Expires: ${new Date(c.expiresAt).toISOString()}`,`Block: ${issuedBlock.number}`,`Block hash: ${issuedBlock.hash}`,`Block time: ${issuedBlock.timestamp}`,'Activity window: 86400 seconds','This signature records a daily check-in only. It does not authorize a transaction or transfer.'].join('\n');return c;
}
function status(){const at=Math.floor(Date.now()/1000)-3;return {version:1 as const,chainId:97,vaultAddress:contract,wallet:alice.address,windowSeconds:86400,requirementEnabled:true,requirementActive:true,activationTimestamp:at-86400,activityCurrent:true,lastCheckInAt:at,activeUntil:at+86400,nextCheckInAt:at+3600,checkedAt:new Date().toISOString(),recorded:true};}

it('uses a real personal signature and records activity without a token approval or transaction',async()=>{
 const request=vi.fn(async(route:string,_method?:string,body?:any)=>{
  if(route==='challenge')return challenge();expect(route).toBe('check-in');expect(body.nonce).toBe('ab'.repeat(24));expect(body.signature).toMatch(/^0x[0-9a-f]+$/);return status();
 });
 expect((await signDailyActivity(alice.address,()=>true,request as any)).recorded).toBe(true);
 expect(methods).toContain('personal_sign');expect(methods).not.toContain('eth_call');expect(methods).not.toContain('eth_sendTransaction');
});

it.each(['origin','vaultAddress','wallet','nonce','chainId','message','expiresAt'])('rejects a mismatched %s before opening a signature prompt',async field=>{
 const c=challenge() as any;
 if(field==='expiresAt')c.expiresAt=Date.now()-1;else if(field==='chainId')c.chainId=56;else if(field==='message')c.message='Approve a transfer';else if(field==='nonce')c.nonce='ff'.repeat(24);else c[field]=field==='origin'?'https://untrusted.invalid':bob.address;
 await expect(signDailyActivity(alice.address,()=>true,(async()=>c) as any)).rejects.toThrow('does not match');expect(methods).not.toContain('personal_sign');
});

it('abandons a changed account before signing and never submits a stale signature',async()=>{
 let valid=true;
 const request=vi.fn(async()=>{valid=false;return challenge();});
 await expect(signDailyActivity(alice.address,()=>valid,request as any)).rejects.toThrow('account changed');expect(methods).not.toContain('personal_sign');
 valid=true;const previous=state.provider.request;
 state.provider.request=async(input:any)=>{const result=await previous(input);if(input.method==='personal_sign')valid=false;return result;};
 const requests:string[]=[];
 await expect(signDailyActivity(alice.address,()=>valid,(async(route:string)=>{requests.push(route);return challenge();}) as any)).rejects.toThrow('account changed');
 expect(requests).toEqual(['challenge']);
});

it('rejects an account switch, wallet provider switch or wrong chain even with the same component identity',async()=>{
 const original=state.provider.request;state.provider.request=async(input:any)=>input.method==='eth_accounts'?[bob.address]:original(input);
 await expect(signDailyActivity(alice.address,()=>true)).rejects.toThrow('account changed');
 state.provider.request=async(input:any)=>input.method==='eth_chainId'?'0x38':original(input);
 await expect(signDailyActivity(alice.address,()=>true)).rejects.toThrow('configured network');
 state.provider.request=original;
 await expect(signDailyActivity(alice.address,()=>true,(async()=>{state.provider={request:original};return challenge();}) as any)).rejects.toThrow('account changed');
});

it('accepts the official www origin alias and rejects a mismatched recorded account',async()=>{
 vi.stubGlobal('window',{location:{origin:'https://www.globaldroptrade.com'}});
 expect((await signDailyActivity(alice.address,()=>true,(async(route:string)=>route==='challenge'?challenge():status()) as any)).recorded).toBe(true);
 expect(()=>requireDailyActivityStatus({...status(),wallet:bob.address},alice.address)).toThrow('does not match');
 await expect(signDailyActivity(alice.address,()=>true,(async(route:string)=>route==='challenge'?challenge():{...status(),recorded:false}) as any)).rejects.toThrow('was not confirmed');
});

it('treats an HTML fallback as unavailable and preserves an explicit API rejection',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>Old website</html>',{status:200})));
 await expect(dailyActivityApi('status')).rejects.toMatchObject({status:503});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Activity signature expired'}),{status:401})));
 await expect(dailyActivityApi('check-in','POST',{})).rejects.toMatchObject({status:401,message:'Activity signature expired'});
});

it('can display a dated, unavailable allocation report without labeling it a user payout',async()=>{
 const body={version:1,status:'stale',chainId:97,vaultAddress:contract,checkedAt:'2026-11-07T00:00:00Z',fresh:false,lastCredit:{epoch:4,batches:[{transactionHash:'0x'+'b'.repeat(64),block:100,blockHash:'0x'+'a'.repeat(64)}]}};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body),{status:503})));
 expect((await readAllocationStatus()).fresh).toBe(false);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...body,vaultAddress:bob.address}),{status:200})));
 await expect(readAllocationStatus()).rejects.toThrow('unavailable');
});

it('validates optional index snapshot values before displaying them',async()=>{
 const body={version:1,status:'running',chainId:97,vaultAddress:contract,checkedAt:'2026-11-07T00:00:00Z',fresh:true,lastCredit:null,indexProgress:{memberThrough:100,positionThrough:99,target:101,memberCount:1,positionCount:2},lastCreditBlockTimestamp:null};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body))));
 expect((await readAllocationStatus()).indexProgress?.target).toBe(101);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...body,indexProgress:{...body.indexProgress,target:'fake'}}))));
 await expect(readAllocationStatus()).rejects.toThrow('Index status is unavailable');
});
