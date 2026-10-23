import {describe,it,expect,vi} from 'vitest';
import {TransactionSession,requireContractTarget} from '../src/transaction-session';
const target={chainId:97,vaultAddress:'0x1111111111111111111111111111111111111111'};
const identity={...target,who:'0x2222222222222222222222222222222222222222',provider:{}};
describe('transaction results belong to the reviewed wallet and contract',()=>{
 it('rejects a reviewed snapshot from another chain or contract',()=>{
  expect(()=>requireContractTarget(target,{...target,chainId:56})).toThrow('contract changed');
  expect(()=>requireContractTarget(target,{...target,vaultAddress:identity.who})).toThrow('contract changed');
  expect(()=>requireContractTarget(target,{...target,vaultAddress:target.vaultAddress.toUpperCase()})).not.toThrow();
 });
 it('discards delayed receipts after a wallet event, even when the same account reconnects',async()=>{
  const session=new TransactionSession(),pending=session.capture(identity),writeReceipt=vi.fn();
  let confirm!:(hash:string)=>void;
  const result=new Promise<string>(resolve=>{confirm=resolve;}).then(hash=>{if(pending.current(identity))writeReceipt(hash);});
  session.invalidate();confirm('old-target-receipt');await result;
  expect(writeReceipt).not.toHaveBeenCalled();
  expect(session.capture(identity).current(identity)).toBe(true);
 });
 it('rejects provider, account, network and vault changes before an event arrives',()=>{
  const pending=new TransactionSession().capture(identity);
  for(const changed of [{...identity,provider:{}},{...identity,who:target.vaultAddress},{...identity,chainId:56},{...identity,vaultAddress:identity.who}])expect(pending.current(changed)).toBe(false);
  expect(pending.current({...identity,who:identity.who.toUpperCase()})).toBe(true);
 });
 it('checks the actual wallet again before retaining receipts and rejects changes during that read',async()=>{
  const session=new TransactionSession(),pending=session.capture(identity);
  expect(await pending.verify(async()=>({...identity,chainId:56}))).toBe(false);
  expect(await pending.verify(async()=>({...identity,who:target.vaultAddress}))).toBe(false);
  expect(await pending.verify(async()=>{throw Error('Wallet unavailable');})).toBe(false);
  let resolve!:(value:typeof identity)=>void;
  const checked=pending.verify(()=>new Promise(complete=>{resolve=complete;}));
  session.invalidate();resolve(identity);expect(await checked).toBe(false);
 });
});
