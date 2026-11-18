import {describe,expect,it,vi} from 'vitest';
import ganache from 'ganache';
import fs from 'node:fs';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../../scripts/compile-global-v3-unified-testnet.mjs';

const shared=vi.hoisted(()=>({rpc:null as any}));
vi.mock('ethers',async importOriginal=>{
 const real=await importOriginal<typeof import('ethers')>();
 class LocalReader extends real.BrowserProvider{
  constructor(){super(shared.rpc,undefined,{cacheTimeout:-1});this.pollingInterval=20;}
 }
 return {...real,JsonRpcProvider:LocalReader};
});

describe('unified testnet withdrawal adapter on a local EVM',()=>{
 it('checks one group page and verifies profit and matured-principal requests',async()=>{
  vi.stubEnv('VITE_V3_HOURLY_TEST','isolated-1h');
  const {sendV3UnifiedPageWithdrawal}=await import('../src/v3-actions');
  const {readV3Snapshot}=await import('../src/v3-chain');
  const {planV3AccountWithdrawal}=await import('../src/v3-account-withdrawal');
  const previous=process.cwd();let artifact;
  try{process.chdir('..');artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;}finally{process.chdir(previous);}
  const mock='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  const manager='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  const fee='0x74015dedf36677485793f1714ec7bd4893907b26';
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
   miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50,unlockedAccounts:[manager]}});
  shared.rpc=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});rpc.pollingInterval=20;
  try{
   const deployer=await rpc.getSigner(0),user=await rpc.getSigner(1),wallet=await user.getAddress();
   const original=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,deployer).deploy(18);
   await original.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[mock,await rpc.getCode(await original.getAddress())]});
   const token=new Contract(mock,tokenArtifact.abi,deployer);
   const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,deployer)
    .deploy(manager,mock,fee,{gasLimit:25000000});
   await vault.waitForDeployment();
   await (await token.mint(wallet,parseEther('1000'))).wait();
   await (await token.connect(user).getFunction('approve')(vault.target,parseEther('1000'))).wait();
   await (await vault.connect(user).getFunction('deposit')(parseEther('1000'),ZeroAddress)).wait();
   await (await vault.connect(user).getFunction('checkIn')()).wait();
   await eip.request({method:'evm_increaseTime',params:[3601]});await eip.request({method:'evm_mine',params:[]});
   await (await vault.accrueDaily(wallet,0)).wait();
   await (await vault.connect(user).getFunction('reinvest')(0,parseEther('3'))).wait();
   const remainingProfit=(await vault.positionOf(wallet,0)).availableProfit;
   await (await vault.connect(user).getFunction('reinvest')(0,remainingProfit)).wait();
   await eip.request({method:'evm_increaseTime',params:[3601]});await eip.request({method:'evm_mine',params:[]});
   await (await vault.accrueReinvestmentPage(wallet,0,8)).wait();
   for(let i=0;i<5;i++)await eip.request({method:'evm_mine',params:[]});
   const address=await vault.getAddress(),book=await vault.reinvestmentBook(),network=await vault.networkPlan();
   const config={address,runtimeHash:keccak256(await rpc.getCode(address)),deploymentTx:vault.deploymentTransaction()!.hash,
    unified:{book,bookRuntimeHash:keccak256(await rpc.getCode(book)),network,networkRuntimeHash:keccak256(await rpc.getCode(network))}};
   let sends=0;
   const walletProvider={request:async({method,params}:any)=>{
    if(method==='eth_sendTransaction')sends++;
    const result=await eip.request({method,params:params||[]});
    if(method==='eth_sendTransaction')for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
    return result;
   }};
   const send=(kind:'profit'|'principal',start:number,amount:string,enabled=true)=>
    sendV3UnifiedPageWithdrawal(walletProvider as any,wallet,kind,1,start,parseEther(amount),config,{enabled});
   await expect(send('profit',0,'0.01',false)).rejects.toThrow(/read-only/);
   await expect(send('profit',2,'0.01')).rejects.toThrow(/page/);
   await expect(send('principal',0,'0.5')).rejects.toThrow(/unlocked principal/);
   expect(sends).toBe(0);
   const before=await token.balanceOf(wallet);
   const snapshot=await readV3Snapshot(walletProvider as any,wallet,config,null,0,true);
   expect(snapshot.unifiedWithdrawalPages).toHaveLength(1);
   expect(snapshot.unifiedWithdrawalPages?.[0].totalLots).toBe(2);
   const plan=planV3AccountWithdrawal(snapshot,'0.01','profit',true);
   if(plan.source!=='book')throw Error('Expected the verified reinvestment account to be selected.');
   const switched={request:async(request:any)=>request.method==='eth_accounts'?[await deployer.getAddress()]:walletProvider.request(request)};
   await expect(sendV3UnifiedPageWithdrawal(switched,wallet,plan.kind,plan.page.positionId,plan.page.start,plan.amount,config,{enabled:true}))
    .rejects.toThrow(/wallet|account/i);
   expect(sends).toBe(0);
   const request=await sendV3UnifiedPageWithdrawal(walletProvider as any,wallet,plan.kind,
    plan.page.positionId,plan.page.start,plan.amount,config,{enabled:true});
   expect(request.id).toBe(0n);expect(request.fee).toBe(parseEther('0.0003'));
   expect((await vault.withdrawalOf(0)).positionId).toBe(1n);
   expect((await vault.positionOf(wallet,1)).reservedProfit).toBe(parseEther('0.01'));
   expect(await token.balanceOf(wallet)).toBe(before);
   await expect(send('profit',0,'0.001')).rejects.toThrow(/pending/);
   expect(sends).toBe(1);
   await eip.request({method:'evm_increaseTime',params:[90*86400+1]});
   for(let i=0;i<5;i++)await eip.request({method:'evm_mine',params:[]});
   const {sendUnifiedWithdrawal}=await import('../src/v3-unified-settlement');
   const withdraw=(account:string,action:Parameters<typeof sendUnifiedWithdrawal>[2],enabled=true)=>
    sendUnifiedWithdrawal(walletProvider as any,account,action,config,{enabled});
   await expect(withdraw(wallet,{kind:'cancelWithdrawal',id:0},false)).rejects.toThrow(/read-only/);
   await withdraw(wallet,{kind:'cancelWithdrawal',id:0});
   for(let i=0;i<5;i++)await eip.request({method:'evm_mine',params:[]});
   const principal=await send('principal',0,'0.5');
   expect(principal.id).toBe(1n);expect(principal.fee).toBe(parseEther('0.15'));
   expect((await vault.withdrawalOf(1)).kind).toBe(1n);
   expect((await vault.positionOf(wallet,1)).reservedPrincipal).toBe(parseEther('0.5'));
   expect(await token.balanceOf(wallet)).toBe(before);
   await eip.request({method:'evm_setAccountBalance',params:[manager,'0x56bc75e2d63100000']});
   await (await token.mint(manager,parseEther('10'))).wait();
   for(let i=0;i<5;i++)await eip.request({method:'evm_mine',params:[]});
   await expect(withdraw(wallet,{kind:'approveWithdrawal',id:1})).rejects.toThrow();
   await withdraw(manager,{kind:'approveWithdrawal',id:1});
   await expect(withdraw(manager,{kind:'fundWithdrawal',id:1,gross:parseEther('1'),beneficiary:wallet})).rejects.toThrow(/does not match/);
   await withdraw(manager,{kind:'fundWithdrawal',id:1,gross:parseEther('0.5'),beneficiary:wallet});
   await withdraw(wallet,{kind:'payWithdrawal',id:1});
   expect(await token.balanceOf(wallet)).toBe(before+parseEther('0.35'));
   expect(await token.allowance(manager,address)).toBe(0n);
   await eip.request({method:'evm_increaseTime',params:[72*3600+1]});
   for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
   await expect(withdraw(wallet,{kind:'requestPrincipal',positionId:1,amount:parseEther('1')})).rejects.toThrow(/additions page/);
   await withdraw(wallet,{kind:'requestPrincipal',positionId:0,amount:parseEther('1')});
   await withdraw(manager,{kind:'rejectWithdrawal',id:2});
   expect((await vault.withdrawalOf(2)).status).toBe(4n);
  }finally{rpc.destroy();await (eip as any).disconnect();vi.unstubAllEnvs();}
 },240000);
});
