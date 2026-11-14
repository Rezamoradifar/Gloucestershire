// Deliberately local-only EVM checks. Passing does not prove identity or consent.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import ganache from 'ganache';
import {AbiCoder,BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,
 getBytes,keccak256,parseEther,toUtf8Bytes} from 'ethers';
import {compileIdentityPrototype} from '../scripts/compile-v3-identity-prototype.mjs';

const MOCK='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const TYPEHASH=keccak256(toUtf8Bytes('GlobalIdentity(address who,address referrer,uint64 deadline,uint256 nonce,uint256 chainId,address contractAddress)'));
const code=AbiCoder.defaultAbiCoder();
const done=async p=>{const r=await(await p).wait();assert.equal(r.status,1);return r;};
const sign=async (verifier,{who,referrer,deadline,nonce=0,chainId=97,contract})=>{
 const digest=keccak256(code.encode(['bytes32','address','address','uint64','uint256','uint256','address'],
  [TYPEHASH,who,referrer,deadline,nonce,chainId,contract]));
 return verifier.signMessage(getBytes(digest));
};
test('identity approval is bound and required on both registration paths; trusted verifier remains a policy dependency',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const artifact=compileIdentityPrototype();
 const chain=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:6,defaultBalance:50}});
 const provider=new BrowserProvider(chain,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const s=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
  const a=await Promise.all(s.map(x=>x.getAddress()));
  const tokenInstance=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,s[0]).deploy(18);
  await tokenInstance.waitForDeployment();
  await chain.request({method:'evm_setAccountCode',params:[MOCK,await provider.getCode(tokenInstance.target)]});
  const token=new Contract(MOCK,tokenArtifact.abi,s[0]);
  const verifier=Wallet.createRandom(),fake=Wallet.createRandom();
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,s[0]);
  await assert.rejects(factory.deploy(a[0],MOCK,a[0],a[0]));
  const vault=await factory.deploy(a[0],MOCK,a[0],verifier.address);await vault.waitForDeployment();
  const block=await provider.getBlock('latest'),deadline=block.timestamp+3600;
  await assert.rejects(vault.connect(s[1]).register.staticCall(ZeroAddress));
  await done(token.mint(a[2],parseEther('10')));
  await done(token.connect(s[2]).approve(vault.target,parseEther('10')));
  await assert.rejects(vault.connect(s[2]).deposit.staticCall(parseEther('10'),ZeroAddress));
  const proof={who:a[1],referrer:ZeroAddress,deadline,contract:vault.target};
  const signature=await sign(verifier,proof);
  await assert.rejects(vault.connect(s[2]).submitIdentityApproval.staticCall(a[1],ZeroAddress,deadline,0,signature));
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],ZeroAddress,deadline,0,await sign(fake,proof)));
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],a[0],deadline,0,signature));
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],ZeroAddress,deadline,0,await sign(verifier,{...proof,chainId:56})));
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],ZeroAddress,deadline,0,await sign(verifier,{...proof,contract:a[0]})));
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],ZeroAddress,deadline,0,'0x'));
  const expired=block.timestamp-1;
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],ZeroAddress,expired,0,await sign(verifier,{...proof,deadline:expired})));
  await done(vault.connect(s[1]).submitIdentityApproval(a[1],ZeroAddress,deadline,0,signature));
  await assert.rejects(vault.connect(s[1]).submitIdentityApproval.staticCall(a[1],ZeroAddress,deadline,0,signature));
  await done(vault.connect(s[1]).register(ZeroAddress));
  assert.equal((await vault.identityApproval(a[1])).deadline,0n);
  const child={who:a[2],referrer:a[1],deadline,contract:vault.target};
  await done(vault.connect(s[2]).submitIdentityApproval(a[2],a[1],deadline,0,await sign(verifier,child)));
  await assert.rejects(vault.connect(s[2]).register.staticCall(ZeroAddress));
  await assert.rejects(vault.connect(s[2]).deposit.staticCall(parseEther('10'),ZeroAddress));
  await done(vault.connect(s[2]).deposit(parseEther('10'),a[1]));
  assert.equal((await vault.users(a[2])).referrer,a[1]);
  assert.equal((await vault.identityApproval(a[2])).deadline,0n);
  assert.equal(await vault.rewardGroupCount(a[1]),1n);
  // The trusted verifier CAN approve an unwanted relationship: KYC alone does
  // not prove sponsor consent or protect against multiple verified attackers.
  const unwanted={who:a[3],referrer:a[1],deadline,contract:vault.target};
  await done(vault.connect(s[3]).submitIdentityApproval(a[3],a[1],deadline,0,await sign(verifier,unwanted)));
  await done(vault.connect(s[3]).register(a[1]));
  assert.equal((await vault.rewardProgress(a[1],0)).branches,2n);
  // An approval which was valid on submission must still be live when the
  // registration/deposit transaction actually assigns a group.
  await done(token.mint(a[4],parseEther('10')));
  await done(token.connect(s[4]).approve(vault.target,parseEther('10')));
  const shortDeadline=(await provider.getBlock('latest')).timestamp+10;
  const shortProof={who:a[4],referrer:a[1],deadline:shortDeadline,contract:vault.target};
  await done(vault.connect(s[4]).submitIdentityApproval(a[4],a[1],shortDeadline,0,await sign(verifier,shortProof)));
  await chain.request({method:'evm_increaseTime',params:[20]});
  await chain.request({method:'evm_mine',params:[]});
  await assert.rejects(vault.connect(s[4]).register.staticCall(a[1]));
  await assert.rejects(vault.connect(s[4]).deposit.staticCall(parseEther('10'),a[1]));
  assert.equal((await vault.rewardProgress(a[1],0)).branches,2n);
  assert.ok(artifact.runtimeBytes<=24576);
 }finally{provider.destroy();}
});
