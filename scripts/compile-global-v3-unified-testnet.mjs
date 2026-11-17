// Compile-only release guard for the EXPERIMENTAL unified testnet contracts.
// This does not deploy, verify a deployment, migrate accounts or change a site.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';

const FILE='contracts/v3/GlobalV3UnifiedTestnet.sol';
const COMPONENTS=[
 [FILE,'GlobalV3UnifiedTestnet'],
 ['contracts/v3/UnifiedNetworkPlan.sol','UnifiedNetworkPlan'],
 ['contracts/v3/UnifiedReinvestmentBook.sol','UnifiedReinvestmentBook']
];
export function compileUnifiedTestnet(){
 if(!solc.version().startsWith('0.8.30+commit.73712a01.'))throw Error('GLOBAL_V3_SOLC_0_8_30_REQUIRED');
 const input={language:'Solidity',sources:{[FILE]:{content:fs.readFileSync(FILE,'utf8')}},settings:{
  optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
 }};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{return {contents:fs.readFileSync(path.resolve(name.startsWith('contracts/')?name:path.join('node_modules',name)),'utf8')};}
  catch{return {error:'Missing import '+name};}
 }}));
 const errors=(out.errors||[]).filter(item=>item.severity==='error');
 if(errors.length)throw Error(errors.map(item=>item.formattedMessage).join('\n'));
 const artifacts={};
 for(const [file,name] of COMPONENTS){
  const a=out.contracts[file]?.[name];
  if(!a?.evm?.bytecode?.object||!a?.evm?.deployedBytecode?.object)throw Error('UNIFIED_COMPONENT_MISSING_'+name);
  const runtimeBytes=a.evm.deployedBytecode.object.length/2,creationBytes=a.evm.bytecode.object.length/2;
  if(runtimeBytes>24576||creationBytes>49152)throw Error('UNIFIED_EVM_SIZE_LIMIT_'+name);
  artifacts[name]=a;
 }
 return Object.freeze(artifacts);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{
  const artifacts=compileUnifiedTestnet();
  const sizes=Object.fromEntries(Object.entries(artifacts).map(([name,a])=>[name,{
   runtimeBytes:a.evm.deployedBytecode.object.length/2,creationBytes:a.evm.bytecode.object.length/2
  }]));
  console.log('V3_UNIFIED_COMPILE_ONLY_PASS '+JSON.stringify({chainId:97,sizes,deployed:false,siteUpdated:false}));
 }catch(error){console.error('V3_UNIFIED_COMPILE_BLOCKED '+String(error?.message||error));process.exitCode=1;}
}
