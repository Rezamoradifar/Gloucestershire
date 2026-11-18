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

describe('unified team actions on a local EVM',()=>{
 it('routes team actions to their verified components and verifies stage claims',async()=>{
  vi.stubEnv('VITE_V3_HOURLY_TEST','isolated-1h');
  const {sendUnifiedNetworkAction}=await import('../src/v3-unified-network');
  const previous=process.cwd();let artifact;
  try{process.chdir('..');artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;}finally{process.chdir(previous);}
  const mock='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  const manager='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  const fee='0x74015dedf36677485793f1714ec7bd4893907b26';
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
   miner:{blockGasLimit:30000000},wallet:{totalAccounts:4,defaultBalance:50}});
  shared.rpc=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});rpc.pollingInterval=20;
  try{
   const deployer=await rpc.getSigner(0),user=await rpc.getSigner(1),other=await rpc.getSigner(2);
   const wallet=await user.getAddress(),direct1=await other.getAddress(),sibling=await rpc.getSigner(3),direct2=await sibling.getAddress();
   const tokenSource=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,deployer).deploy(18);
   await tokenSource.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[mock,await rpc.getCode(await tokenSource.getAddress())]});
   const token=new Contract(mock,tokenArtifact.abi,deployer);
   const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,deployer)
    .deploy(manager,mock,fee,{gasLimit:25000000});
   await vault.waitForDeployment();

   for(const [sender,referrer] of [[user,ZeroAddress],[other,wallet],[sibling,wallet]] as const){
    const account=await sender.getAddress();
    await (await token.mint(account,parseEther('400'))).wait();
    await (await token.connect(sender).getFunction('approve')(vault.target,parseEther('400'))).wait();
    await (await vault.connect(sender).getFunction('deposit')(parseEther('400'),referrer)).wait();
   }
   const mine=async()=>{for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});};
   await mine();
   const address=await vault.getAddress(),book=await vault.reinvestmentBook(),network=await vault.networkPlan();
   const config={address,runtimeHash:keccak256(await rpc.getCode(address)),deploymentTx:vault.deploymentTransaction()!.hash,
    unified:{book,bookRuntimeHash:keccak256(await rpc.getCode(book)),network,networkRuntimeHash:keccak256(await rpc.getCode(network))}};
   const destinations:string[]=[];
   const connected={request:async({method,params}:any)=>{
    if(method==='eth_sendTransaction')destinations.push(params[0].to.toLowerCase());
    const result=await eip.request({method,params:params||[]});
    if(method==='eth_sendTransaction')await mine();
    return result;
   }};
   const send=(action:Parameters<typeof sendUnifiedNetworkAction>[2])=>sendUnifiedNetworkAction(connected,wallet,action,config,{enabled:true});
   await expect(sendUnifiedNetworkAction(connected,wallet,{kind:'createRewardGroup',branches:[direct1]},config)).rejects.toThrow(/read-only/);
   await expect(send({kind:'createRewardGroup',branches:[wallet]})).rejects.toThrow(/direct referral/);
   expect(destinations).toEqual([]);
   await send({kind:'createRewardGroup',branches:[direct1]});
   await expect(send({kind:'addRewardBranches',group:0,branches:[direct1]})).rejects.toThrow(/already in a reward group/);
   await send({kind:'addRewardBranches',group:0,branches:[direct2]});
   await expect(send({kind:'prepareNetworkReward',group:0,stage:1,steps:64})).rejects.toThrow(/stage changed/);
   await send({kind:'prepareNetworkReward',group:0,stage:0,steps:64});
   await expect(send({kind:'claimNetworkRewards',group:0,stage:0,count:1})).rejects.toThrow(/not currently eligible/);
   await (await vault.connect(user).getFunction('checkIn')()).wait();await mine();
   await send({kind:'claimNetworkRewards',group:0,stage:0,count:1});
   expect(await vault.networkAvailable(wallet)).toBe(parseEther('35'));
   expect(destinations).toEqual([network,network,address,address].map(to=>to.toLowerCase()));
  }finally{rpc.destroy();await (eip as any).disconnect();vi.unstubAllEnvs();}
 },240000);
});
