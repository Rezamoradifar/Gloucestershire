import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Wallet} from 'ethers';
const wallet=Wallet.createRandom(),contract='0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522';
const state=vi.hoisted(()=>({provider:null as any}));
vi.mock('../src/config',()=>({configured:true,chainId:97,vaultAddress:'0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522'}));
vi.mock('../src/wallet',()=>({getWalletProvider:()=>state.provider}));
import {CommunityApiError,communityApi,signInSupport,withSupportSession} from '../src/community-client';
let methods:string[],nonce:string;
beforeEach(()=>{
 methods=[];nonce='ab'.repeat(24);
 vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com'}});
 state.provider={request:vi.fn(async({method,params}:any)=>{
  methods.push(method);
  if(method==='eth_chainId')return '0x61';
  if(method==='eth_accounts'||method==='eth_requestAccounts')return [wallet.address];
  if(method==='personal_sign')return wallet.signMessage(Buffer.from(params[0].slice(2),'hex'));
  throw Error('Contract RPC must not be required for support: '+method);
 })};
});
afterEach(()=>vi.unstubAllGlobals());
function challenge(){return {nonce,message:`GlobalDropTrade support sign-in\nOrigin: https://globaldroptrade.com\nChain: 97\nContract: ${contract}\nWallet: ${wallet.address}\nNonce: ${nonce}\nExpires: ${new Date(Date.now()+300000).toISOString()}\nThis signature authenticates support access only. It does not authorize a transaction.`};}
it('authenticates with a real wallet message without contract RPC or transactions',async()=>{
 const request=vi.fn(async(route:string,_method:any,body:any)=>{
  if(route==='challenge')return challenge();
  expect(body.nonce).toBe(nonce);expect(body.signature).toMatch(/^0x/);return {token:'private-session'};
 });
 expect(await signInSupport(wallet.address,()=>true,request as any)).toBe('private-session');
 expect(methods).toContain('personal_sign');expect(methods).not.toContain('eth_call');expect(methods).not.toContain('eth_sendTransaction');
});
it.each(['origin','contract','wallet','nonce'])('rejects a mismatched %s before asking for a signature',async(field)=>{
 const c=challenge();c.message=c.message.replace(field==='origin'?'https://globaldroptrade.com':field==='contract'?contract:field==='wallet'?wallet.address:nonce,field==='nonce'?'ff'.repeat(24):'untrusted');
 await expect(signInSupport(wallet.address,()=>true,(async()=>c) as any)).rejects.toThrow('does not match');expect(methods).not.toContain('personal_sign');
});
it('stops an abandoned account request before signing',async()=>{
 let valid=true;
 await expect(signInSupport(wallet.address,()=>valid,(async()=>{valid=false;return challenge();}) as any)).rejects.toThrow('account changed');expect(methods).not.toContain('personal_sign');
});
it('clears an expired token without replaying a possibly completed multi-request action',async()=>{
 const authenticate=vi.fn(async()=> 'new'),remember=vi.fn(),action=vi.fn(async()=>{throw new CommunityApiError('Sign in',401);});
 await expect(withSupportSession('expired',authenticate,remember,action)).rejects.toThrow('Sign in again');
 expect(remember).toHaveBeenCalledWith('');expect(action).toHaveBeenCalledTimes(1);expect(authenticate).not.toHaveBeenCalled();
 await withSupportSession('',authenticate,remember,async token=>expect(token).toBe('new'));expect(authenticate).toHaveBeenCalledTimes(1);
});
it('retains sessions for permission failures and exposes HTTP errors',async()=>{
 const remember=vi.fn();await expect(withSupportSession('valid',vi.fn(),remember,async()=>{throw new CommunityApiError('Forbidden',403);})).rejects.toThrow('Forbidden');expect(remember).not.toHaveBeenCalled();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Sign in'}),{status:401})));
 await expect(communityApi('tickets')).rejects.toMatchObject({status:401});
});

it('reports an HTML fallback page as unavailable instead of crashing the ticket list',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>Website fallback</html>',{status:200})));
 await expect(communityApi('tickets')).rejects.toMatchObject({status:503});
});
it('supports the official www alias while keeping the canonical support origin bound',async()=>{
 vi.stubGlobal('window',{location:{origin:'https://www.globaldroptrade.com'}});
 const request=async(route:string)=>route==='challenge'?challenge():{token:'private-session'};
 expect(await signInSupport(wallet.address,()=>true,request as any)).toBe('private-session');
 vi.stubGlobal('window',{location:{origin:'https://untrusted.invalid'}});
 await expect(signInSupport(wallet.address,()=>true,request as any)).rejects.toThrow('does not match');
});
