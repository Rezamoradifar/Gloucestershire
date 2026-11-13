#!/usr/bin/env node
// Prepare a reproducible BscScan Standard JSON verification submission.
// No signing, no API key, no publishing, no changes to the deployed vault.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import solc from 'solc';
import {FetchRequest,JsonRpcProvider,keccak256,getAddress} from 'ethers';

const CONTRACT='contracts/v2/GlobalV2Prototype.sol';
const NAME='GlobalV2Prototype';
const ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const TX='0xbcf8142110c4a5e7d33544c4f00a730ad4335e62ec5f2d3f67f49997ba3e854b';
const RPC=process.env.V2_RPC_URL||'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const s=fs.readFileSync(CONTRACT,'utf8');
const sources={[CONTRACT]:{content:s}};
const compilerSettings={optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
 outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}};
const input={language:'Solidity',sources,settings:compilerSettings};
const resolveImport=(name)=>{
 const sourcePath=path.resolve('node_modules',name);
 if(!fs.existsSync(sourcePath))return {error:'Missing import '+name};
 const content=fs.readFileSync(sourcePath,'utf8');
 sources[name]={content};
 return {contents:content};
};
const mask=(hex,refs)=>{
 const out=hex.toLowerCase().replace(/^0x/,'').split('');
 for(const entries of Object.values(refs||{}))for(const {start,length} of entries){
  check(Number.isInteger(start)&&Number.isInteger(length)&&(start+length)*2<=out.length,'Invalid immutable reference');
  out.fill('?',start*2,(start+length)*2);
 }
 return out.join('');
};
async function main(){
 check(process.argv.length===3&&process.argv[2]==='--prepare','Usage: node scripts/prepare-global-v2-bscscan.mjs --prepare');
 check(solc.version().startsWith('0.8.30+commit.73712a01.'),'Expected solc 0.8.30');
 const result=JSON.parse(solc.compile(JSON.stringify(input),{import:resolveImport}));
 const errors=(result.errors||[]).filter(e=>e.severity==='error');
 check(errors.length===0,'Solidity compilation failed');
 const a=result.contracts?.[CONTRACT]?.[NAME];
 check(Boolean(a),'GlobalV2Prototype artifact missing');
 const req=new FetchRequest(RPC);req.timeout=15000;
 const provider=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  check(Number(BigInt(await provider.send('eth_chainId',[])))===97,'Wrong network');
  const receipt=await provider.getTransactionReceipt(TX);
  check(receipt?.status===1&&receipt.contractAddress&&getAddress(receipt.contractAddress)===ADDRESS,'Deployment receipt mismatch');
  const transaction=await provider.getTransaction(TX);
  check(transaction?.to===null,'Not a creation transaction');
  const creation='0x'+a.evm.bytecode.object;
  check(transaction.data.toLowerCase().startsWith(creation.toLowerCase()),'Compiled creation bytecode does not match transaction');
  const args='0x'+transaction.data.slice(creation.length);
  const runtime=await provider.getCode(ADDRESS);
  const compiled='0x'+a.evm.deployedBytecode.object;
  check(runtime.length===compiled.length,'Compiled runtime size mismatch');
  check(mask(runtime,a.evm.deployedBytecode.immutableReferences)===mask(compiled,a.evm.deployedBytecode.immutableReferences),'Compiled runtime bytecode mismatch');
  const target=process.env.V2_VERIFY_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'global-v2-verification-'));
  fs.mkdirSync(target,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(target,'standard-input.json'),JSON.stringify({language:'Solidity',sources,settings:compilerSettings},null,2)+'\n',{mode:0o600});
  fs.writeFileSync(path.join(target,'constructor-arguments.txt'),args.slice(2)+'\n',{mode:0o600});
  console.log(JSON.stringify({result:'V2_BSCSCAN_STANDARD_JSON_READY',address:ADDRESS,chainId:97,contractName:CONTRACT+':'+NAME,compiler:'v0.8.30+commit.73712a01',optimization:true,runs:1,viaIR:true,evmVersion:'shanghai',creationMatches:true,runtimeMatches:true,constructorArgsHexLength:args.length-2,liveRuntimeHash:keccak256(runtime),verificationFiles:target,submission:'Not submitted; open BscScan verification form and use Standard JSON input'},null,2));
 }finally{provider.destroy();}
}
main().catch(e=>{console.error('V2_VERIFICATION_PREPARATION_BLOCKED:',e.message);process.exitCode=1;});
