// Compile only the isolated V3 local TESTNET prototype. No deployment or signer.
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

if(!solc.version().startsWith('0.8.30+commit.73712a01.'))
 throw Error('GLOBAL_V3_SOLC_0_8_30_REQUIRED');
const file='contracts/v3/GlobalV3DeferredTestnet.sol';
const input={language:'Solidity',sources:{[file]:{content:fs.readFileSync(file,'utf8')}},settings:{
 optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
 outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
 try{return {contents:fs.readFileSync(path.resolve('node_modules',name),'utf8')};}
 catch{return {error:'Cannot resolve '+name};}
}}));
const errors=(output.errors||[]).filter(x=>x.severity==='error');
if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
const artifact=output.contracts[file]?.GlobalV3DeferredTestnet;
if(!artifact)throw Error('GLOBAL_V3_ARTIFACT_MISSING');
const runtime=artifact.evm.deployedBytecode.object.length/2;
const creation=artifact.evm.bytecode.object.length/2;
if(runtime>24576||creation>49152)
 throw Error('GLOBAL_V3_EVM_SIZE_LIMIT '+runtime+'/'+creation);
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/GlobalV3DeferredTestnet.json',JSON.stringify({
 ...artifact,compiler:solc.version(),deploymentAuthorization:'NONE_TESTNET_PROTOTYPE'
},null,2)+'\n');
console.log('GLOBAL_V3_COMPILE_ONLY_PASS '+JSON.stringify({
 runtime,creation,compiler:solc.version(),chainId:97,noDeployment:true
}));
