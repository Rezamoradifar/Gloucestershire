import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,ZeroAddress} from 'ethers';
import {readManagerVip,sendManagerVip,vipMemberAddress,type VipChange} from '../src/v3-manager-vip';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';

const mock=vi.hoisted(()=>({session:vi.fn(),gas:vi.fn(),submit:vi.fn()}));
vi.mock('../src/v3-actions',()=>({checkedGas:mock.gas,submitVerified:mock.submit}));
vi.mock('../src/v3-chain',()=>({v3ReadSession:mock.session}));
const manager='0x1111111111111111111111111111111111111111',member='0x2222222222222222222222222222222222222222';
const address='0x3333333333333333333333333333333333333333',hash='0x'+'ab'.repeat(32),tx='0x'+'cd'.repeat(32);
const config={address,unified:{portfolio:true}} as V3SiteReleaseConfig;
const wallet={request:async({method}:{method:string})=>method==='eth_chainId'?'0x61':[manager]};
const change:VipChange={kind:'setVipKyc',member,previous:false,approved:true};
const abi=new Interface(['function setVipKyc(address,bool)']);
const readUsers=vi.fn(),hasRole=vi.fn(),canonical=vi.fn(),destroy=vi.fn();
const role='0x'+'ee'.repeat(32),session={block:{number:42,timestamp:123,hash},options:{blockTag:42},
 provider:{send:canonical,destroy},vault:{MANAGER_ROLE:async()=>role,hasRole,users:readUsers,interface:abi}};

beforeEach(()=>{
 vi.clearAllMocks();
 mock.session.mockResolvedValue(session);hasRole.mockResolvedValue(true);
 readUsers.mockImplementation(async(_:string,at:{blockTag:number})=>({registered:true,vipKyc:at.blockTag===46}));
 canonical.mockImplementation(async(_:string,[tag]:string[])=>({number:tag,hash}));
 mock.gas.mockResolvedValue({gasLimit:50000n,gasPrice:1n});mock.submit.mockResolvedValue({hash:tx,blockNumber:46,blockHash:hash});
});

describe('manager VIP verification',()=>{
 it('checks the manager role before looking up the precise registered wallet at one confirmed block',async()=>{
  await expect(readManagerVip(wallet,manager,member,config)).resolves.toEqual({member,registered:true,approved:false,block:42,timestamp:123});
  expect(mock.session).toHaveBeenCalledWith(wallet,manager,config,true);
  expect(hasRole).toHaveBeenCalledWith(role,manager,{blockTag:42});expect(readUsers).toHaveBeenCalledWith(member,{blockTag:42});
  hasRole.mockResolvedValue(false);readUsers.mockClear();
  await expect(readManagerVip(wallet,manager,member,config)).rejects.toThrow(/manager role/);
  expect(readUsers).not.toHaveBeenCalled();
 });
 it('rejects shortened, invalid or zero addresses and configurations outside the portfolio release',async()=>{
  for(const invalid of ['0x123',ZeroAddress,'example.eth','1'.repeat(40)])expect(()=>vipMemberAddress(invalid)).toThrow();
  await expect(readManagerVip(wallet,manager,member,{address} as V3SiteReleaseConfig)).rejects.toThrow(/portfolio/);
  await expect(sendManagerVip(wallet,manager,change,config,false)).rejects.toThrow(/not enabled/);
  expect(mock.session).not.toHaveBeenCalled();
 });
 it('refuses to sign for a non-manager, unregistered wallet or changed prior status',async()=>{
  hasRole.mockResolvedValue(false);
  await expect(sendManagerVip(wallet,manager,change,config,true)).rejects.toThrow(/manager role/);
  hasRole.mockResolvedValue(true);readUsers.mockResolvedValue({registered:false,vipKyc:false});
  await expect(sendManagerVip(wallet,manager,change,config,true)).rejects.toThrow(/not registered/);
  readUsers.mockResolvedValue({registered:true,vipKyc:true});
  await expect(sendManagerVip(wallet,manager,change,config,true)).rejects.toThrow(/status changed/);
  expect(mock.submit).not.toHaveBeenCalled();
 });
 it.each([true,false])('simulates exact vault/member/value and independently checks the resulting status (%s)',async approved=>{
  readUsers.mockImplementation(async(_:string,at:{blockTag:number})=>({registered:true,vipKyc:at.blockTag===46?approved:!approved}));
  await expect(sendManagerVip(wallet,manager,{...change,previous:!approved,approved},config,true)).resolves.toBe(tx);
  expect(mock.gas).toHaveBeenCalledWith(session,session.vault,'setVipKyc',[member,approved],manager);
  const call=mock.submit.mock.calls[0];
  expect(call[1]).toBe(manager);expect(call[4]).toBe(address);expect(call[5]).toBe(abi.encodeFunctionData('setVipKyc',[member,approved]));
  expect(readUsers).toHaveBeenCalledWith(member,{blockTag:46});expect(destroy).toHaveBeenCalled();
 });
 it('withholds a success result if the receipt-block state or block hash differs',async()=>{
  readUsers.mockResolvedValue({registered:true,vipKyc:false});
  await expect(sendManagerVip(wallet,manager,change,config,true)).rejects.toThrow(/Check wallet history before retrying/);
  canonical.mockResolvedValue({number:'0x2a',hash:'0x'+'ef'.repeat(32)});
  await expect(sendManagerVip(wallet,manager,change,config,true)).rejects.toThrow(/confirmed block changed/);
  expect(mock.submit).toHaveBeenCalledTimes(1);
 });
});
