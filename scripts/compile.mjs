import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
export function compile() {
 const sources=Object.fromEntries(fs.readdirSync('contracts').filter(x=>x.endsWith('.sol')).map(x=>[x,{content:fs.readFileSync('contracts/'+x,'utf8')}]));
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
 const imported={};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{const contents=fs.readFileSync(path.join('node_modules',p),'utf8');imported[p]={content:contents};return {contents}}catch{return {error:'Missing '+p}}}}));
 const errors=(out.errors||[]).filter(x=>x.severity==='error'); if(errors.length) throw Error(errors.map(x=>x.formattedMessage).join('\n'));
 fs.mkdirSync('artifacts',{recursive:true});
 fs.writeFileSync('artifacts/standard-input.json',JSON.stringify({...input,sources:{...input.sources,...imported}},null,2));
 for(const [file,contracts] of Object.entries(out.contracts)) if(!file.startsWith('@')) for(const [name,c] of Object.entries(contracts)) fs.writeFileSync('artifacts/'+name+'.json',JSON.stringify({...c,compiler:solc.version()},null,2));
 const vault=out.contracts['DropshippingVault.sol'].DropshippingVault;
 const size=vault.evm.deployedBytecode.object.length/2;
 if(size>24576) throw Error('Contract exceeds EIP-170: '+size);
 console.log('Compiled Solidity '+solc.version()+'; vault runtime '+size+' bytes');
 return out;
}
if(process.argv[1]?.endsWith('/compile.mjs')) compile();
