import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Wallet,parseEther} from 'ethers';
import {validateV2DeployRelease,validateV2DeployArtifact,verifyV2TestnetContext,verifyV2Deployed,deployV2OnTestnet} from '../scripts/deploy-global-v2-testnet.mjs';

const identity='global-new-deployer-testnet-v1';
let rpc,provider,signers,owner,signer,token,feedA,feedB,old,release,artifact;
const transaction=async x=>(await x).wait();
async function deploy(name,args=[]){
 const a=JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
 const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);
 await c.waitForDeployment();return c;
}
before(async()=>{
 execFileSync(process.execPath,['scripts/compile-global-v2.mjs'],{stdio:'pipe'});
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:16},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:16},(_,i)=>provider.getSigner(i)));
 owner=await signers[0].getAddress();
 const signer0=Wallet.createRandom();signer=new Wallet(signer0.privateKey,provider);
 await transaction(signers[0].sendTransaction({to:signer.address,value:parseEther('0.5')}));
 token=await deploy('MockToken',[18]);
 feedA=await deploy('MockFeed',[100000000n]);
 feedB=await deploy('MockFeed',[100000000n]);
 old=await deploy('MockToken',[18]); // only a nonempty deployed code stub for test
 artifact=JSON.parse(fs.readFileSync('artifacts/GlobalV2Prototype.json','utf8'));
 const addresses=await Promise.all([signers[5].getAddress(),signers[6].getAddress()]);
 release={version:1,chainId:97,releaseId:identity,artifact:'FastNewDeployerTestnetVault',testMode:true,
  owner,deployer:signer.address,token:await token.getAddress(),
  bnbFeed:await feedA.getAddress(),tokenFeed:await feedB.getAddress(),
  operations:addresses[0],age:'86400'};
});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('validates exact testnet release identity, fee ABI and artifact size before signing',()=>{
 const p=validateV2DeployRelease(release);
 assert.equal(p.owner,owner);assert.equal(p.deployer,signer.address);
 const code=validateV2DeployArtifact(artifact);
 assert.ok(code.init<49152);assert.ok(code.runtime<24576);
 for(const override of [{chainId:56},{testMode:false},{age:'0'},{deployer:owner},{owner:'bad'}]){
  assert.throws(()=>validateV2DeployRelease({...release,...override}));
 }
 assert.throws(()=>validateV2DeployArtifact({...artifact,compiler:'0.8.24'}));
});

test('preflight rejects wrong network and verifies expected legacy code',async()=>{
 const x=await verifyV2TestnetContext({provider,release,artifact,legacyVault:old.target});
 assert.equal(x.chainId,97);
 assert.equal(x.tokenDecimals,18);
 assert.ok(x.bytecodeHash.startsWith('0x'));
 await assert.rejects(verifyV2TestnetContext({provider,release,artifact,legacyVault:'0x000000000000000000000000000000000000dEaD'}),
  /V2_EXPECTED_LEGACY_CONTRACT_MISSING/);
 const wrong={send:async()=> '0x38'};
 await assert.rejects(verifyV2TestnetContext({provider:wrong,release,artifact,legacyVault:old.target}),
  /V2_TESTNET_CHAIN_97_ONLY/);
});

test('testnet EOA deployment is one-shot, verified and admin does not grant deployer KYC role',async()=>{
 let marker=null;
 const deployment=await deployV2OnTestnet({
  provider,release,artifact,key:signer.privateKey,legacyVault:old.target,confirmations:1,
  existing:()=>marker,save:m=>{marker=m;}
 });
 assert.ok(marker);
 assert.equal(deployment.address,marker.predictedAddress);
 assert.equal(marker.txHash,deployment.txHash);
 assert.equal(deployment.chainId,97);
 assert.equal(deployment.feeBps,300);
 assert.equal(deployment.cooldownSeconds,259200);
 assert.equal(deployment.admin,owner);
 const vault=new (await import('ethers')).Contract(deployment.address,artifact.abi,provider);
 assert.equal(await vault.hasRole(await vault.KYC_ADMIN_ROLE(),signer.address),false);
 assert.equal(await vault.hasRole(await vault.WITHDRAWAL_APPROVER_ROLE(),signer.address),false);
 const verification=await verifyV2Deployed({provider,address:deployment.address,release,artifact});
 assert.equal(verification.codeHash,deployment.codeHash);
 await assert.rejects(deployV2OnTestnet({
   provider,release,artifact,key:signer.privateKey,legacyVault:old.target,confirmations:1,
   existing:()=>marker,save:()=>{throw Error('MUST_NOT_REDEPLOY');}
 }),/V2_DEPLOYMENT_ALREADY_STARTED_RECONCILE_FIRST/);
});
