import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {keccak256} from 'ethers';

// Independent source snapshot: never rebuild or overwrite an earlier release artifact.
const files=['ThreeLinePlan.sol','DropshippingVault.sol','DeferredRewardsVault.sol','ProfitWithdrawalQueue.sol','AutomaticGroupVault.sol'];
const sources=Object.fromEntries(files.map(file=>['fresh/'+file,{content:fs.readFileSync('contracts/fresh/'+file,'utf8')}]));
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const imports={};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
 try{const content=fs.readFileSync(path.join('node_modules',name),'utf8');imports[name]={content};return {contents:content};}
 catch{return {error:'Missing '+name};}
}}));
const errors=(output.errors||[]).filter(error=>error.severity==='error');
if(errors.length)throw Error(errors.map(error=>error.formattedMessage).join('\n'));
const artifact=output.contracts['fresh/AutomaticGroupVault.sol'].AutomaticGroupVault;
const size=artifact.evm.deployedBytecode.object.length/2;
if(size>24576)throw Error('AutomaticGroupVault exceeds EIP-170: '+size);
if(artifact.evm.bytecode.object.length/2>49152)throw Error('AutomaticGroupVault exceeds the initcode limit');
fs.mkdirSync('artifacts',{recursive:true});
fs.mkdirSync('deployment-console',{recursive:true});
fs.writeFileSync('artifacts/AutomaticGroupVault.json',JSON.stringify({...artifact,compiler:solc.version()},null,2)+'\n');
fs.writeFileSync('deployment-console/AutomaticGroupVault.json',JSON.stringify({abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,compiler:solc.version()},null,2)+'\n');
fs.writeFileSync('artifacts/fresh-start-standard-input.json',JSON.stringify({...input,sources:{...sources,...imports}},null,2)+'\n');
console.log('AutomaticGroupVault runtime '+size+' bytes; init '+artifact.evm.bytecode.object.length/2+' bytes');
console.log('AUTOMATIC_GROUP_BYTECODE_HASH='+keccak256('0x'+artifact.evm.bytecode.object));
