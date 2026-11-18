import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {getAddress,keccak256} from 'ethers';
import {readPinnedProof,planUnifiedPreviewSite} from '../scripts/v3-unified-site-preview-preflight.mjs';

const A=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const H=n=>'0x'+n.toString(16).padStart(64,'0');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const MANAGER=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const FEE1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const SHA='a'.repeat(40);

function fixture(){
 const state={chain:'0x61',changed:false,bookVault:A(1)};
 const code=['0x6001','0x6002','0x6003'];
 const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:A(1),book:A(2),network:A(3),token:TOKEN,
  manager:MANAGER,feeReceiver:FEE,deploymentBlock:100,deploymentTx:H(15),
  vaultRuntimeHash:keccak256(code[0]),bookRuntimeHash:keccak256(code[1]),networkRuntimeHash:keccak256(code[2])};
 let blockCalls=0;
 const provider={
  send:async(name,args)=>{
   if(name==='eth_chainId')return state.chain;
   assert.equal(name,'eth_getBlockByNumber');
   if(args[0]==='0x64')return {number:'0x64',hash:H(77),timestamp:'0x300'};
   assert.deepEqual(args,['0x76',false]);blockCalls++;
   return {number:'0x76',hash:state.changed&&blockCalls>1?H(100):H(99),timestamp:'0x3e8'};
  },
  getBlockNumber:async()=>120,
  getTransactionReceipt:async()=>({status:1,contractAddress:A(1),blockNumber:100,blockHash:H(77),hash:H(15)}),
  getCode:async(address)=>({[A(1)]:code[0],[A(2)]:code[1],[A(3)]:code[2],[TOKEN]:'0x60'})[address]||'0x'
 };
 const parent={asset:async()=>TOKEN,feeReceiver:async()=>FEE,reinvestmentBook:async()=>A(2),networkPlan:async()=>A(3),
  ACCRUAL_PERIOD:async()=>3600n,ONE_DAY:async()=>86400n,FEE_WALLET_1:async()=>FEE1,
  FEE_WALLET_2:async()=>MANAGER,OPERATIONS_WALLET:async()=>OPERATIONS,DEPOSIT_FEE_EACH_BPS:async()=>1000n,
  MANAGER_ROLE:async()=>H(7),hasRole:async(role,address)=>role===H(7)&&address===MANAGER};
 const makeContract=address=>address===A(1)?parent:{vault:async()=>address===A(2)?state.bookVault:A(1)};
 const check=(extra={})=>planUnifiedPreviewSite({provider,proof,makeContract,sourceSha:SHA,expectedSourceSha:SHA,...extra});
 return {state,proof,check};
}

test('proof must be an owner-only regular file pinned by digest',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-proof-'));
 try{
  const filename=path.join(dir,'proof.json'),raw=JSON.stringify({example:'ok'});
  const digest=createHash('sha256').update(raw).digest('hex');
  fs.writeFileSync(filename,raw,{mode:0o600});
  assert.deepEqual(readPinnedProof(filename,digest),{example:'ok'});
  assert.throws(()=>readPinnedProof(filename,'0'.repeat(64)),/DIGEST_MISMATCH/);
  fs.chmodSync(filename,0o644);
  assert.throws(()=>readPinnedProof(filename,digest),/FILE_UNSAFE/);
  fs.chmodSync(filename,0o600);
  const link=path.join(dir,'link.json');fs.symlinkSync(filename,link);
  assert.throws(()=>readPinnedProof(link,digest),/PROOF_SYMLINK/);
  assert.equal(fs.readFileSync(filename,'utf8'),raw);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('configuration is isolated, pinned and explicitly not releasable',async()=>{
 const f=fixture();const result=await f.check();
 assert.equal(result.routeCandidate,'/unified-test/');
 assert.equal(result.env.VITE_V3_CONTRACT_ADDRESS,f.proof.vault);
 assert.equal(result.env.VITE_V3_UNIFIED_BOOK_HASH,f.proof.bookRuntimeHash);
 assert.equal(result.env.VITE_V3_LANDING_AT_ROOT,'false');
 assert.equal(result.proofRequiresIndependentAuthentication,true);
 for(const key of ['releaseReady','legacySiteChecked','routeVerified','siteUpdated','transactionSent','migrationPerformed','keeperInstalled'])
  assert.equal(result[key],false,key);
 assert.equal(result.readOnlyPreview,true);
});

test('rejects wrong source, legacy targets, wrong role, mainnet, runtime mismatch and reorg',async()=>{
 let f=fixture();
 await assert.rejects(f.check({expectedSourceSha:'b'.repeat(40)}),/SOURCE_SHA_MISMATCH/);
 await assert.rejects(f.check({proof:{...f.proof,vault:getAddress('0x4F2777861cc5bDD0d6AED86014cE1370BF823884')}}),/PROOF_CONFIG_MISMATCH/);
 await assert.rejects(f.check({proof:{...f.proof,manager:A(4)}}),/PROOF_CONFIG_MISMATCH/);
 f.state.chain='0x38';await assert.rejects(f.check(),/TESTNET_CHAIN_REQUIRED/);
 f=fixture();await assert.rejects(f.check({proof:{...f.proof,bookRuntimeHash:H(1)}}),/RUNTIME_MISMATCH/);
 f=fixture();f.state.bookVault=A(4);await assert.rejects(f.check(),/CONFIGURATION_MISMATCH/);
 f=fixture();f.state.changed=true;await assert.rejects(f.check(),/BLOCK_CHANGED/);
});

test('CLI rejects installation and unknown RPC before reading files or reaching network',()=>{
 const script=path.resolve('scripts/v3-unified-site-preview-preflight.mjs');
 for(const args of [['--install'],['--check','--proof','/does-not-exist','--proof-sha256','a'.repeat(64),
  '--source-sha',SHA,'--rpc','https://example.com']]){
  const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.match(result.stderr,/UNIFIED_PREVIEW_CHECK_ARGUMENTS_REQUIRED/);
 }
});
