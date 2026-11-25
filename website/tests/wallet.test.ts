import {afterEach,describe,expect,it,vi} from 'vitest';
import {WalletConnection,wallets,switchWalletNetwork,selectInjectedWalletProvider,walletConnectOptionalMethods,type WalletProvider} from '../src/wallet';
import {session} from '../src/chain';

vi.mock('../src/config',()=>({chainId:97,chainName:'BNB Testnet',explorer:'https://testnet.bscscan.com',configured:true,vaultAddress:'0x7f19354B765920B9b17003d0840EEaA133883DcA',feeWallets:[]}));
const address='0xeBfbE2348a0edD7D643ffA441cF6F7B1F2425Be5';
function browserStorage(){
 const entries=new Map<string,string>();
 vi.stubGlobal('window',{localStorage:{
  getItem:(key:string)=>entries.get(key)??null,
  setItem:(key:string,value:string)=>entries.set(key,value),
  removeItem:(key:string)=>entries.delete(key),
 }});
 return entries;
}
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
 it('connects to a nested mobile wallet when the injected provider registry has no request method',()=>{
  const nested=provider();
  const registry={providers:[nested]} as unknown as WalletProvider;
  expect(selectInjectedWalletProvider({ethereum:registry})).toBe(nested);
 });
 it('proposes personal_sign for optional-chain WalletConnect sessions',async()=>{
  // WalletConnect 2.26 uses no required-method defaults when no required
  // chains are configured; the optional list must request message signing.
  const {EthereumProvider}=await import('@walletconnect/ethereum-provider');
  const p=new EthereumProvider();
  const config=(p as any).getRpcConfig({projectId:'a'.repeat(32),optionalChains:[97],
   optionalMethods:[...walletConnectOptionalMethods],rpcMap:{97:'https://example.invalid'}});
  expect(config.chains).toEqual([]);
  expect(config.methods).toEqual([]);
  expect(config.optionalChains).toEqual(['eip155:97']);
  expect(config.optionalMethods).toContain('personal_sign');
  expect(config.optionalMethods).toContain('eth_sendTransaction');
 });
 it('does not contact wallets until the user chooses a connection',()=>{
  const injected=provider(),mobile=vi.fn();const connection=new WalletConnection(()=>injected,mobile);
  expect(connection.getProvider()).toBeNull();expect(injected.request).not.toHaveBeenCalled();expect(mobile).not.toHaveBeenCalled();
 });
 it('restores an authorized injected wallet after a reload and honors explicit disconnect',async()=>{
  const saved=browserStorage(),injected=provider(),mobile=vi.fn();
  const visit=()=>new WalletConnection(()=>injected,mobile);
  await visit().restore();
  expect(injected.request).not.toHaveBeenCalled();
  await visit().connect('injected');
  expect([...saved.values()]).toEqual(['injected']);
  injected.request.mockClear();
  const reloaded=visit();await reloaded.restore();
  expect(reloaded.getProvider()).toBe(injected);
  expect(injected.request).toHaveBeenCalledExactlyOnceWith({method:'eth_accounts'});
  await reloaded.disconnect();injected.request.mockClear();
  await visit().restore();
  expect(saved.size).toBe(0);expect(injected.request).not.toHaveBeenCalled();
  expect(mobile).not.toHaveBeenCalled();
 });
 it('waits for an injected wallet that appears late, is locked, or is briefly offline',async()=>{
  browserStorage();const injected=provider(),mobile=vi.fn();
  await new WalletConnection(()=>injected,mobile).connect('injected');
  let available=false;
  const reloaded=new WalletConnection(()=>available?injected:undefined,mobile);
  await reloaded.restore();expect(reloaded.getProvider()).toBeNull();
  available=true;
  injected.request.mockClear().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([]);
  await reloaded.restore();await reloaded.restore();expect(reloaded.getProvider()).toBeNull();
  await reloaded.restore();expect(reloaded.getProvider()).toBe(injected);
  expect(injected.request.mock.calls.map(([call])=>call.method)).toEqual(Array(3).fill('eth_accounts'));
 });
 it('only restores live WalletConnect sessions with the selected account on the configured chain',async()=>{
  browserStorage();
  const session={expiry:Math.floor(Date.now()/1000)+300,namespaces:{eip155:{accounts:['eip155:97:'+address]}}};
  const mobile={...provider(),session},injected=vi.fn();
  const visit=()=>new WalletConnection(injected,async()=>mobile);
  await visit().connect('walletconnect');mobile.enable.mockClear();
  const reloaded=visit(),expiry=session.expiry;
  session.expiry=1;await reloaded.restore();
  expect(mobile.request).not.toHaveBeenCalled();
  session.expiry=expiry;session.namespaces.eip155.accounts=['eip155:56:'+address];
  await reloaded.restore();expect(reloaded.getProvider()).toBeNull();
  session.namespaces.eip155.accounts=['eip155:97:'+address];
  mobile.request.mockResolvedValueOnce([address]).mockResolvedValueOnce('0x38');
  await reloaded.restore();expect(reloaded.getProvider()).toBeNull();
  await reloaded.restore();expect(reloaded.getProvider()).toBe(mobile);
  expect(mobile.enable).not.toHaveBeenCalled();expect(injected).not.toHaveBeenCalled();
  expect(mobile.request.mock.calls.every(([call])=>['eth_accounts','eth_chainId'].includes(call.method))).toBe(true);
 });
 it('can retry a stalled restore without letting its late answer replace the selected wallet',async()=>{
  browserStorage();const injected=provider(),mobile=provider();
  await new WalletConnection(()=>injected,async()=>mobile).connect('injected');
  let finish!:(accounts:string[])=>void;
  injected.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const reloaded=new WalletConnection(()=>injected,async()=>mobile);
  vi.useFakeTimers();
  try{
   const pending=reloaded.restore();
   await vi.advanceTimersByTimeAsync(8_001);await pending;
   expect(reloaded.getProvider()).toBeNull();
   await reloaded.connect('walletconnect');
   finish([address]);await Promise.resolve();
   expect(reloaded.getProvider()).toBe(mobile);
   expect(injected.request.mock.calls.filter(([call])=>call.method==='eth_requestAccounts')).toHaveLength(1);
  }finally{vi.useRealTimers();}
 });
 it('does not resurrect a pending restore after disconnect or replace a new explicit connection',async()=>{
  browserStorage();const injected=provider(),mobile=provider();
  const visit=()=>new WalletConnection(()=>injected,async()=>mobile);
  const first=visit();await first.connect('injected');
  for(const replacement of [false,true]){
   const reloaded=visit();await first.connect('injected');
   let resolve!:(accounts:string[])=>void;
   injected.request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
   const restoring=reloaded.restore();
   if(replacement)await reloaded.connect('walletconnect');else await reloaded.disconnect();
   resolve([address]);await restoring;
   expect(reloaded.getProvider()).toBe(replacement?mobile:null);
  }
 });
 it('connects to the SafePal browser provider when no generic Ethereum injection exists',async()=>{
  const safePal=provider();vi.stubGlobal('window',{safepalProvider:safePal});
  await wallets.connect('injected');expect(wallets.getProvider()).toBe(safePal);
  expect(safePal.request).toHaveBeenCalledExactlyOnceWith({method:'eth_requestAccounts'});
 });
 it('selects SafePal from a multi-wallet injection and retains the generic wallet fallback',()=>{
  const generic=provider(),safePal={...provider(),isSafePal:true};
  expect(selectInjectedWalletProvider({ethereum:{...generic,providers:[safePal]}})).toBe(safePal);
  expect(selectInjectedWalletProvider({ethereum:generic})).toBe(generic);
  expect(selectInjectedWalletProvider({})).toBeUndefined();
  expect(generic.request).not.toHaveBeenCalled();expect(safePal.request).not.toHaveBeenCalled();
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
