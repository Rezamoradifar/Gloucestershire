import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

// Compile migration-only candidates separately; preserve every released artifact.
const names=['migrations/TestnetDeferredMigrationVault.sol','migrations/ImportedWithdrawalQueue.sol','DropshippingVault.sol','ThreeLinePlan.sol'];
const sources=Object.fromEntries(names.map(name=>[name,{content:fs.readFileSync('contracts/'+name,'utf8')}]));
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const imports={};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{
 try{const content=fs.readFileSync(path.join('node_modules',p),'utf8');imports[p]={content};return {contents:content};}
 catch{return {error:'Missing '+p};}
}}));
const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
fs.mkdirSync('artifacts',{recursive:true});
for(const name of ['TestnetDeferredMigrationVault','ImportedWithdrawalQueue']){
 const file=name==='ImportedWithdrawalQueue'?'migrations/ImportedWithdrawalQueue.sol':'migrations/TestnetDeferredMigrationVault.sol';
 const a=output.contracts[file][name],size=a.evm.deployedBytecode.object.length/2;
 if(size>24576)throw Error(name+' exceeds EIP-170: '+size);
 fs.writeFileSync('artifacts/'+name+'.json',JSON.stringify({...a,compiler:solc.version()},null,2)+'\n');
 fs.writeFileSync('deployment-console/'+name+'.json',JSON.stringify({abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,compiler:solc.version()},null,2)+'\n');
 console.log(name+' runtime '+size+' bytes; init '+a.evm.bytecode.object.length/2+' bytes');
}
fs.writeFileSync('artifacts/deferred-migration-standard-input.json',JSON.stringify({...input,sources:{...sources,...imports}},null,2)+'\n');
