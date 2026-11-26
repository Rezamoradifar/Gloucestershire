import {afterEach,describe,expect,it,vi} from 'vitest';
import {Transaction,Wallet,id,type Eip1193Provider} from 'ethers';
import {sendSponsoredCheckIn} from '../src/v3-sponsored-checkin';
import {confirmV3Transaction} from '../src/v3-actions';

vi.mock('../src/v3-actions',async importOriginal=>({
 ...await importOriginal<typeof import('../src/v3-actions')>(),confirmV3Transaction:vi.fn()
}));
const member=Wallet.createRandom(),address=Wallet.createRandom().address,other=Wallet.createRandom();
const config={address,runtimeHash:'test',deploymentTx:'test',unified:{portfolio:true as const,
 book:'test',network:'test',bookRuntimeHash:'test',networkRuntimeHash:'test'}};
const gasLimit=75000n,nonce=4;
function fixture(sponsorable:boolean,change:Record<string,unknown>={},useOtherSigner=false){
 const relay=vi.fn(async (_endpoint:RequestInfo|URL,options?:RequestInit)=>{
  const {method,params}=JSON.parse(String(options?.body));
  const result=method==='pm_isSponsorable'?{sponsorable}:Transaction.from(params[0]).hash;
  return Response.json({jsonrpc:'2.0',id:1,result});
 });
 vi.stubGlobal('fetch',relay);
 const request=vi.fn(async ({method,params}:any)=>{
  if(method==='eth_chainId')return '0x61';
  if(method==='eth_accounts')return [member.address];
  if(method!=='eth_signTransaction')throw Error('Unexpected wallet method');
  const {gas,from,...tx}=params[0];
  expect(from).toBe(member.address);
  return (useOtherSigner?other:member).signTransaction({...tx,gasLimit:gas,...change});
 });
 return {request,relay,send:()=>sendSponsoredCheckIn({request} as Eip1193Provider,member.address,config,gasLimit,nonce)};
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('sponsored portfolio activity',()=>{
 it('does not open the wallet or submit anything when there is no sponsorship',async()=>{
  const {request,relay,send}=fixture(false);
  await expect(send()).rejects.toThrow('A funded sponsor is required');
  expect(request).not.toHaveBeenCalled();
  expect(relay).toHaveBeenCalledTimes(1);
  expect(confirmV3Transaction).not.toHaveBeenCalled();
 });
 it('submits only the member-signed zero-fee call and verifies its own hash',async()=>{
  const {request,relay,send}=fixture(true);
  await send();
  const calls=relay.mock.calls.map(call=>JSON.parse(String(call[1]?.body)));
  expect(calls.map(call=>call.method)).toEqual(['pm_isSponsorable','eth_sendRawTransaction']);
  const signed=Transaction.from(calls[1].params[0]);
  expect(signed).toMatchObject({from:member.address,to:address,value:0n,gasPrice:0n,
   type:0,data:id('checkIn()').slice(0,10),chainId:97n,gasLimit,nonce});
  expect(confirmV3Transaction).toHaveBeenCalledWith(expect.anything(),member.address,config,
   address,signed.data,signed.hash,'Sponsored renewal','check_in',undefined,true);
  expect(request.mock.calls.map(([call])=>call.method)).not.toContain('eth_sendTransaction');
 });
 it.each([{gasPrice:1n},{value:1n},{data:'0x01'},{to:other.address},{chainId:56n},{nonce:5},{gasLimit:80000n}])(
  'rejects a wallet-modified renewal before the relay receives it (%o)',async change=>{
   const {relay,send}=fixture(true,change);
   await expect(send()).rejects.toThrow('changed the requested');
   expect(relay).toHaveBeenCalledTimes(1);
   expect(confirmV3Transaction).not.toHaveBeenCalled();
 });
 it('rejects a signature by a different account',async()=>{
  const {relay,send}=fixture(true,{},true);
  await expect(send()).rejects.toThrow('changed the requested');
  expect(relay).toHaveBeenCalledTimes(1);
 });
});
