#!/usr/bin/env node
// Read-only diagnostics of the on-chain V2 bytecode identity. Never authorizes cutover.
import fs from 'node:fs';
import {FetchRequest, JsonRpcProvider, getAddress, keccak256} from 'ethers';

const ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const RPC=process.env.V2_RPC_URL||'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const ARTIFACTS=['FastNewDeployerTestnetVault','AutomaticGroupVault','DropshippingVault','DeferredRewardsVault','FastTestnetVault','FastNewDeployerTestnetVault'];
const fail=msg=>{throw Error(msg);};
const size=h=>(h.length-2)/2;
const hex=v=>String(v||'').replace(/^0x/,'').toLowerCase();
const firstMismatch=(a,b)=>{
 const x=hex(a),y=hex(b);let i=0;
 while(i<Math.min(x.length,y.length)&&x[i]===y[i])i++;
 return i===Math.min(x.length,y.length)&&x.length===y.length?null:Math.floor(i/2);
};
const artifact=name=>{
 const file='artifacts/'+name+'.json';
 if(!fs.existsSync(file))return null;
 const a=JSON.parse(fs.readFileSync(file,'utf8'));
 return {name,create:'0x'+a.evm?.bytecode?.object,runtime:'0x'+a.evm?.deployedBytecode?.object,
  compiler:a.compiler||'unknown',refs:a.evm?.deployedBytecode?.immutableReferences||{}};
};
const mask=(h,refs)=>{
 const out=hex(h).split('');
 for(const group of Object.values(refs)){
  for(const {start,length} of group){
   if(!Number.isInteger(start)||!Number.isInteger(length)||(start+length)*2>out.length)fail('Invalid immutable offsets');
   out.fill('?',start*2,(start+length)*2);
  }
 }
 return out.join('');
};
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--check')fail('Usage: node scripts/diagnose-v2-runtime.mjs --check');
 if(!RPC.startsWith('https://'))fail('HTTPS RPC required');
 const req=new FetchRequest(RPC);req.timeout=12000;
 const p=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  if(Number(BigInt(await p.send('eth_chainId',[])))!==97)fail('Wrong chain');
  const live=await p.getCode(ADDRESS);
  if(live==='0x')fail('No contract deployed at address');
  console.log('V2_LIVE_ADDRESS:',ADDRESS);
  console.log('V2_LIVE_RUNTIME_BYTES:',size(live));
  console.log('V2_LIVE_RUNTIME_HASH:',keccak256(live));
  const distinct=[...new Set(ARTIFACTS)];
  for(const name of distinct){
   const a=artifact(name);if(!a?.runtime||a.runtime==='0xundefined')continue;
   const sameLength=size(a.runtime)===size(live);
   const sameRuntime=sameLength&&mask(a.runtime,a.refs)===mask(live,a.refs);
   console.log(JSON.stringify({artifact:name,compiler:a.compiler,artifactRuntimeBytes:size(a.runtime),
    matchingRuntimeLength:sameLength,matchOutsideImmutables:sameRuntime,
    firstDifferentByte:firstMismatch(a.runtime,live),artifactRuntimeHash:keccak256(a.runtime)}));
  }
  const stateFile='/var/lib/globaldroptrade/v2-prototype/deployment.json';
  if(fs.existsSync(stateFile)){
   const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
   if(typeof state.txHash==='string'){
    const tx=await p.send('eth_getTransactionByHash',[state.txHash]);
    if(tx){
     console.log('DEPLOYMENT_TX_MINED:',tx.blockNumber!==null);
     console.log('DEPLOYMENT_TX_TARGET:',tx.to||'contract creation');
     console.log('DEPLOYMENT_INIT_BYTES:',size(tx.input));
     for(const name of distinct){
      const a=artifact(name);if(!a?.create||a.create==='0xundefined')continue;
      console.log('DEPLOYMENT_CREATION_PREFIX_'+name+':',
       hex(tx.input).startsWith(hex(a.create))?'MATCH':'DIFFERENT');
     }
    }else console.log('DEPLOYMENT_TRANSACTION: unavailable');
   }
  }
  console.log('V2_DIAGNOSIS_ONLY: mismatch is a release blocker; no site or API changed.');
 }finally{p.destroy();}
}
main().catch(e=>{console.error('V2_DIAGNOSIS_FAILED:',e.message);process.exitCode=1;});
