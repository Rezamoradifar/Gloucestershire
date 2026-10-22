import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
export function compile() {
 const sources=Object.fromEntries(fs.readdirSync('contracts').filter(x=>x.endsWith('.sol')).map(x=>[x,{content:fs.readFileSync('contracts/'+x,'utf8')}]));
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
 const imported={};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{const contents=fs.readFileSync(path.join('node_modules',p),'utf8');imported[p]={content:contents};return {contents}}catch{return {error:'Missing '+p}}}}));
 const errors=(out.errors||[]).filter(x=>x.severity==='error'); if(errors.length) throw Error(errors.map(x=>x.formattedMessage).join('\n'));
 fs.mkdirSync('artifacts',{recursive:true});
 fs.writeFileSync('artifacts/standard-input.json',JSON.stringify({...input,sources:{...input.sources,...imported}},null,2));
 for(const [file,contracts] of Object.entries(out.contracts)) if(!file.startsWith('@')) for(const [name,c] of Object.entries(contracts)) fs.writeFileSync('artifacts/'+name+'.json',JSON.stringify({...c,compiler:solc.version()},null,2));
 // Existing testnet mock feeds use the original Paris/200 build. Preserve their exact runtime identity.
 const mockImports={};
 const mockInput={...input,sources:{'TestMocks.sol':sources['TestMocks.sol']},settings:{...input.settings,optimizer:{enabled:true,runs:200},evmVersion:'paris'}};
 const mocks=JSON.parse(solc.compile(JSON.stringify(mockInput),{import:p=>{try{const content=fs.readFileSync(path.join('node_modules',p),'utf8');mockImports[p]={content};return {contents:content};}catch{return {error:'Missing '+p};}}}));
 const mockErrors=(mocks.errors||[]).filter(e=>e.severity==='error');if(mockErrors.length)throw Error(mockErrors.map(e=>e.formattedMessage).join('\n'));
 fs.writeFileSync('artifacts/mock-standard-input.json',JSON.stringify({...mockInput,sources:{...mockInput.sources,...mockImports}},null,2));
 out.contracts['TestMocks.sol']=mocks.contracts['TestMocks.sol'];
 for(const [name,c] of Object.entries(mocks.contracts['TestMocks.sol']))fs.writeFileSync('artifacts/'+name+'.json',JSON.stringify({...c,compiler:solc.version()},null,2));
 const vault=out.contracts['DropshippingVault.sol'].DropshippingVault;
 const size=vault.evm.deployedBytecode.object.length/2;
 if(size>24576) throw Error('Contract exceeds EIP-170: '+size);
 for(const name of ['DeferredRewardsVault','TestnetMigratedRewardsVault']){const bytes=out.contracts[name+'.sol'][name].evm.deployedBytecode.object.length/2;if(bytes>24576)throw Error(name+' exceeds EIP-170: '+bytes);console.log(name+' runtime '+bytes+' bytes');}
 console.log('Compiled Solidity '+solc.version()+'; vault runtime '+size+' bytes');
 return out;
}
if(process.argv[1]?.endsWith('/compile.mjs')) compile();
