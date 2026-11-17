import {describe,expect,it,vi} from 'vitest';
import ganache from 'ganache';
import fs from 'node:fs';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../../scripts/compile-global-v3-unified-testnet.mjs';

const shared=vi.hoisted(()=>({rpc:null as any}));
vi.mock('ethers',async(importOriginal)=>{
 const real=await importOriginal<typeof import('ethers')>();
 class LocalReader extends real.BrowserProvider {
  constructor(){super(shared.rpc,undefined,{cacheTimeout:-1});this.pollingInterval=20;}
 }
 return {...real,JsonRpcProvider:LocalReader};
});

describe('unified testnet read-only site preview on local EVM',()=>{
 it('verifies all components and reads one position, and blocks wallet writes',async()=>{
  vi.stubEnv('VITE_V3_HOURLY_TEST','isolated-1h');
  const {readV3Snapshot}=await import('../src/v3-chain');
  const {sendV3Action}=await import('../src/v3-actions');
  const previous=process.cwd();let artifact;
  try{process.chdir('..');artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;}finally{process.chdir(previous);}
  const mock='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  const manager='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  const fee='0x74015dedf36677485793f1714ec7bd4893907b26';
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
   miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
  shared.rpc=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});rpc.pollingInterval=20;
  try{
   const deployer=await rpc.getSigner(0),user=await rpc.getSigner(1),wallet=await user.getAddress();
   const tokenOriginal=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,deployer).deploy(18);
   await tokenOriginal.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[mock,await rpc.getCode(await tokenOriginal.getAddress())]});
   const token=new Contract(mock,tokenArtifact.abi,deployer);
   const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,deployer)
    .deploy(manager,mock,fee,{gasLimit:25000000});
   await vault.waitForDeployment();
   await (await token.mint(wallet,parseEther('1000'))).wait();
   await (await token.connect(user).getFunction('approve')(await vault.getAddress(),parseEther('1000'))).wait();
   await (await vault.connect(user).getFunction('deposit')(parseEther('1000'),ZeroAddress)).wait();
   await (await vault.connect(user).getFunction('checkIn')()).wait();
   await eip.request({method:'evm_increaseTime',params:[3601]});await eip.request({method:'evm_mine',params:[]});
   await (await vault.getFunction('accrueDaily')(wallet,0)).wait();
   await (await vault.connect(user).getFunction('reinvest')(0,parseEther('3'))).wait();
   for(let i=0;i<5;i++)await eip.request({method:'evm_mine',params:[]});
   const address=await vault.getAddress(),book=await vault.reinvestmentBook(),network=await vault.networkPlan();
   const config={address,runtimeHash:keccak256(await rpc.getCode(address)),deploymentTx:vault.deploymentTransaction()!.hash,
    unified:{book,bookRuntimeHash:keccak256(await rpc.getCode(book)),network,networkRuntimeHash:keccak256(await rpc.getCode(network))}};
   const walletProvider={request:async({method,params}:any)=>eip.request({method,params:params||[]})};
   const snapshot=await readV3Snapshot(walletProvider as any,wallet,config,{branches:0,groups:0});
   expect(snapshot.positions).toHaveLength(2);
   expect(snapshot.unifiedPage?.positionId).toBe(1);
   expect(snapshot.unifiedPage?.totalLots).toBe(1);
   expect(snapshot.unifiedPage?.principal).toBe(parseEther('3'));
   expect(snapshot.unifiedPage?.lots[0].principal).toBe(parseEther('3'));
   expect(snapshot.qualifiedDirects).toBe(0);
   await expect(readV3Snapshot(walletProvider as any,wallet,{...config,unified:{...config.unified,bookRuntimeHash:'0x'+'00'.repeat(32)}}))
    .rejects.toThrow('Verified V3 BNB Testnet reads unavailable');
   await expect(sendV3Action(walletProvider as any,wallet,{kind:'reinvest',positionId:0,amount:parseEther('1')},config))
    .rejects.toThrow(/read-only preview/);
  }finally{rpc.destroy();await (eip as any).disconnect();vi.unstubAllEnvs();}
 },120000);
});
