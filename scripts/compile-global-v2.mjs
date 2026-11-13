// Isolated Solidity 0.8.30 prototype build. This never modifies old artifacts
// and contains no deployment or private signer.
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

if(!solc.version().startsWith('0.8.30+commit.73712a01.'))
 throw Error('GLOBAL_V2_SOLC_0_8_30_REQUIRED');

const file='contracts/v2/GlobalV2Prototype.sol';
const source=fs.readFileSync(file,'utf8');
const input={language:'Solidity',sources:{[file]:{content:source}},settings:{
 optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
 outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
 try{return {contents:fs.readFileSync(path.resolve('node_modules',name),'utf8')};}
 catch{return {error:'Unresolved import '+name};}
}}));
const errors=(output.errors||[]).filter(x=>x.severity==='error');
if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
const artifact=output.contracts[file].GlobalV2Prototype;
if(!artifact)throw Error('GLOBAL_V2_ARTIFACT_MISSING');
const runtime=artifact.evm.deployedBytecode.object.length/2;
const init=artifact.evm.bytecode.object.length/2;
if(runtime>24576||init>49152)
 throw Error('GLOBAL_V2_EVM_SIZE_LIMIT '+runtime+'/'+init);
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/GlobalV2Prototype.json',JSON.stringify({...artifact,compiler:solc.version()},null,2)+'\n');
console.log('GLOBAL_V2_PROTOTYPE_COMPILE_OK runtime='+runtime+' init='+init);
