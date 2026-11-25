import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {signInSupport} from '../src/support-sign-in';
import {portfolioSupport} from '../src/v3-support';
const current=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/wallet',()=>({getWalletProvider:()=>current}));
const vault='0x'+'11'.repeat(20),member='0x'+'22'.repeat(20),nonce='ab'.repeat(24),token='cd'.repeat(32);
const origin='https://globaldroptrade.com';
beforeEach(()=>vi.stubGlobal('window',{location:{origin}}));
const challenge=()=>['GlobalDropTrade support sign-in','Origin: '+origin,'Chain: 97','Contract: '+vault,
 'Wallet: '+member,'Nonce: '+nonce,'Expires: '+new Date(Date.now()+300000).toISOString(),
 'This signature authenticates support access only. It does not authorize a transaction.'].join('\n');
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('portfolio wallet support',()=>{
 it.each([['Origin: '+origin,'Origin: https://elsewhere.example'],['Chain: 97','Chain: 56'],
  ['Contract: '+vault,'Contract: '+member],['Wallet: '+member,'Wallet: '+vault],['Nonce: '+nonce,'Nonce: 1'],
  ['This signature authenticates support access only.','Send a payment.']])('rejects a mismatched support challenge before opening the signer',async(from,to)=>{
  current.request.mockImplementation(async({method})=>method==='eth_chainId'?'0x61':[member]);
  const request=vi.fn().mockResolvedValue({message:challenge().replace(from,to),nonce});
  await expect(signInSupport(member,vault,97,()=>true,request)).rejects.toThrow('does not match');
  expect(current.request.mock.calls.map(([q])=>q.method)).not.toContain('personal_sign');
 });
 it('uses wallet-scoped same-origin requests and does not reuse a token when the selected wallet changes',async()=>{
  current.request.mockImplementation(async({method})=>method==='eth_chainId'?'0x61':[member]);
  const session={token},client=portfolioSupport(vault,member,session);
  await expect(client.authenticate(()=>true)).resolves.toBe(token);
  current.request.mockImplementation(async({method})=>method==='eth_chainId'?'0x61':[vault]);
  await expect(client.authenticate(()=>true)).rejects.toMatchObject({status:401});expect(session.token).toBe('');
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({chainId:97,vault,items:[]})));
  vi.stubGlobal('fetch',fetcher);
  await client.request('announcements');
  expect(fetcher.mock.calls[0][0]).toBe('/api/v3/community/'+vault+'/announcements');
  expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',headers:{}});
  fetcher.mockResolvedValue(new Response(JSON.stringify({chainId:97,vault:member,items:[]})));
  await expect(client.request('announcements')).rejects.toThrow('does not match');
 });
});
