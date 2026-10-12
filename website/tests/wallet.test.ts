import {afterEach,describe,expect,it,vi} from 'vitest';
import {WalletConnection,wallets,switchWalletNetwork,type WalletProvider} from '../src/wallet';
import {session} from '../src/chain';

vi.mock('../src/config',()=>({chainId:97,chainName:'BNB Testnet',explorer:'https://testnet.bscscan.com',configured:true,vaultAddress:'0x7f19354B765920B9b17003d0840EEaA133883DcA',feeWallets:[]}));
const address='0xeBfbE2348a0edD7D643ffA441cF6F7B1F2425Be5';
function provider(){
 const events=new Map<string,Set<(...args:unknown[])=>void>>();
 return {
  request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x61':[address]),
  enable:vi.fn(async()=>[address]),disconnect:vi.fn(async()=>{}),
  on(event:string,listener:(...args:unknown[])=>void){if(!events.has(event))events.set(event,new Set());events.get(event)!.add(listener);},
  removeListener(event:string,listener:(...args:unknown[])=>void){events.get(event)?.delete(listener);},
  emit(event:string){for(const listener of events.get(event)||[])listener();},
 };
}
afterEach(async()=>{await wallets.disconnect();vi.unstubAllGlobals();});
describe('wallet connection boundaries',()=>{
 it('does not contact wallets until the user chooses a connection',()=>{
  const injected=provider(),mobile=vi.fn();const connection=new WalletConnection(()=>injected,mobile);
  expect(connection.getProvider()).toBeNull();expect(injected.request).not.toHaveBeenCalled();expect(mobile).not.toHaveBeenCalled();
 });
 it('uses the mobile provider for account reads without any browser extension',async()=>{
  const mobile=provider();const connection=new WalletConnection(()=>undefined,async()=>mobile);
  await connection.connect('walletconnect');expect(connection.getProvider()).toBe(mobile);
  expect(await connection.getProvider()!.request({method:'eth_accounts'})).toEqual([address]);
  expect(mobile.request.mock.calls.every(([call])=>!call.method.includes('sign')&&!call.method.includes('send'))).toBe(true);
 });
 it('a rejected connection preserves the existing selected wallet',async()=>{
  const injected=provider(),mobile=provider();mobile.enable.mockRejectedValueOnce({code:4001});
  const connection=new WalletConnection(()=>injected,async()=>mobile);await connection.connect('injected');
  await expect(connection.connect('walletconnect')).rejects.toEqual({code:4001});expect(connection.getProvider()).toBe(injected);
 });
 it('only the selected provider can invalidate account and chain data',async()=>{
  const injected=provider(),mobile=provider();const changed=vi.fn();const connection=new WalletConnection(()=>injected,async()=>mobile);
  const unsubscribe=connection.subscribe(changed);await connection.connect('injected');await connection.connect('walletconnect');changed.mockClear();
  injected.emit('accountsChanged');injected.emit('disconnect');expect(changed).not.toHaveBeenCalled();expect(connection.getProvider()).toBe(mobile);
  mobile.emit('chainChanged');mobile.emit('accountsChanged');expect(changed).toHaveBeenCalledTimes(2);
  mobile.emit('disconnect');expect(connection.getProvider()).toBeNull();unsubscribe();
 });
 it('explicit disconnect closes the mobile session without falling back to an extension',async()=>{
  const mobile=provider();const connection=new WalletConnection(()=>provider(),async()=>mobile);
  await connection.connect('walletconnect');await connection.disconnect();expect(mobile.disconnect).toHaveBeenCalledOnce();expect(connection.getProvider()).toBeNull();
 });
 it('deduplicates prompts and prevents a late connection from undoing disconnect',async()=>{
  const mobile=provider();let finish!:(accounts:string[])=>void;mobile.enable.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const connection=new WalletConnection(()=>undefined,async()=>mobile);const pending=connection.connect('walletconnect');expect(connection.connect('walletconnect')).toBe(pending);
  await vi.waitFor(()=>expect(mobile.enable).toHaveBeenCalledOnce());await connection.disconnect();finish([address]);await pending;
  expect(connection.getProvider()).toBeNull();expect(mobile.disconnect).toHaveBeenCalledOnce();
 });
 it('requests only the configured testnet when adding a missing wallet network',async()=>{
  const injected=provider();vi.stubGlobal('window',{ethereum:injected});await wallets.connect('injected');injected.request.mockClear();
  injected.request.mockRejectedValueOnce({code:4902});await switchWalletNetwork();
  const calls=injected.request.mock.calls.map(([call])=>call) as {method:string;params:{chainId:string}[]}[];
  expect(calls.map(x=>x.method)).toEqual(['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain']);
  expect(calls.every(x=>x.params[0].chainId==='0x61')).toBe(true);
 });
 it('blocks the transaction session on the wrong chain before requesting a signer',async()=>{
  const injected=provider();vi.stubGlobal('window',{ethereum:injected});await wallets.connect('injected');injected.request.mockClear();injected.request.mockResolvedValue('0x38');
  await expect(session(address)).rejects.toThrow('different network');expect(injected.request).toHaveBeenCalledExactlyOnceWith({method:'eth_chainId'});
 });
 it('blocks the transaction session after disconnect',async()=>{
  await expect(session(address)).rejects.toThrow('Connect your wallet');
 });
});
