import {beforeAll,beforeEach,afterAll,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther as E} from 'ethers';
const fast=JSON.parse(fs.readFileSync(new URL('../../config/fresh-fast-testnet.json',import.meta.url),'utf8'));
let rpc:any,provider:BrowserProvider,vault:any,queue:any,token:any,owner:any,user:any,other:any,selected:string,snapshot:string,writes:number;
let actions:typeof import('../src/withdrawal-queue'),wallets:typeof import('../src/wallet');
const send=async(p:Promise<any>)=>(await p).wait();
beforeAll(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:5,defaultBalance:1000,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 owner=await provider.getSigner(fast.owner);user=await provider.getSigner(0);other=await provider.getSigner(1);const operator=await provider.getSigner(fast.deployer);
 const deploy=async(name:string,args:unknown[],signer=owner)=>{const a=JSON.parse(fs.readFileSync(new URL('../../artifacts/'+name+'.json',import.meta.url),'utf8')),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('FastTestnetVault',[fast.owner,token.target,feed.target,feed.target,86400,fast.partners,await other.getAddress()],operator);
 const {Contract}=await import('ethers');const queueAbi=(await import('../src/reward-mode')).queueAbi;queue=new Contract(await vault.withdrawalQueue(),queueAbi,owner);
 await send(token.mint(await user.getAddress(),E('1000')));await send(token.connect(user).approve(vault.target,E('1000')));await send(vault.connect(user).deposit(token.target,E('1000'),ZeroAddress));
 await send(token.mint(fast.owner,E('1000')));await send(token.approve(vault.target,E('1000')));await send(vault.connect(owner).fundRewards(token.target,E('1000')));
 await send(vault.batchProfit('0x'+'12'.repeat(32),token.target,[await user.getAddress()],[E('100')]));
 vi.stubEnv('VITE_CHAIN_ID','97');vi.stubEnv('VITE_VAULT_ADDRESS',vault.target);vi.resetModules();
 vi.stubGlobal('window',{ethereum:{request:async({method,params=[]}:any)=>{
  if(['eth_accounts','eth_requestAccounts'].includes(method))return [selected];
  if(method==='eth_sendTransaction')writes++;
  return rpc.request({method,params});
 }}});
 actions=await import('../src/withdrawal-queue');wallets=await import('../src/wallet');
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
},60000);
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});writes=0;selected=await user.getAddress();await wallets.wallets.connect('injected');});
afterAll(async()=>{await wallets?.wallets.disconnect();vi.unstubAllGlobals();vi.unstubAllEnvs();provider?.destroy();await rpc?.disconnect();});
it('the user inbox, owner approval and exact cash payment work through the real frontend methods',async()=>{
 await send(vault.connect(user).withdrawProfit(token.target,E('10')));
 const who=await user.getAddress(),before=await token.balanceOf(who),loaded=await actions.readQueue(who,0n,false);
 expect(loaded.approvalRequired).toBe(true);expect(loaded.count).toBe(1n);expect(loaded.rows[0]).toMatchObject({id:0n,gross:E('10'),fee:E('0.5'),status:0,symbol:'USDT',principal:false});
 await expect(actions.executeQueue(who,{kind:'approve',id:0n})).rejects.toThrow('current administrator');expect(writes).toBe(0);expect(await token.balanceOf(who)).toBe(before);
 selected=await other.getAddress();expect((await actions.readQueue(selected,0n,false)).rows).toHaveLength(0);
 selected=fast.owner;const hash=await actions.executeQueue(selected,{kind:'approveAndPay',id:0n});expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);expect(writes).toBe(1);
 expect(await token.balanceOf(who)).toBe(before+E('9.5'));expect((await queue.requests(0n)).status).toBe(1n);
 const count=writes;await expect(actions.executeQueue(selected,{kind:'pay',id:0n})).rejects.toThrow();expect(writes).toBe(count);expect(await token.balanceOf(who)).toBe(before+E('9.5'));
 selected=who;expect((await actions.readQueue(who,0n,false)).rows[0].status).toBe(1);
},60000);
it('an overdue request can be cancelled only by its user and restores the recorded profit',async()=>{
 await send(vault.connect(user).withdrawProfit(token.target,E('10')));const who=await user.getAddress(),profit=(await vault.accounts(who,token.target)).profit;
 await rpc.request({method:'evm_increaseTime',params:[72*3600+1]});await rpc.request({method:'evm_mine',params:[]});
 selected=await other.getAddress();await expect(actions.executeQueue(selected,{kind:'cancel',id:0n})).rejects.toThrow();expect(writes).toBe(0);
 selected=who;await actions.executeQueue(who,{kind:'cancel',id:0n});expect((await queue.requests(0n)).status).toBe(2n);expect((await vault.accounts(who,token.target)).profit).toBe(profit+E('10'));
},60000);
