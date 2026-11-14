// Prepare a self-contained Standard JSON source package for the existing
// hourly BNB Testnet contract. This script does not access a wallet, network,
// explorer account or private configuration, and sends no transactions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import {AbiCoder,keccak256} from 'ethers';
import {hourlyV3Source} from './compile-global-v3-hourly-testnet.mjs';

export const sourcePath='contracts/v3/GlobalV3DeferredTestnet.sol';
export const contractName=sourcePath+':GlobalV3HourlyTestnet';
export const compilerVersion='v0.8.30+commit.73712a01';
export const expectedCreationHash='0xffd714456c8dfda35333b1bca7707e34010b602252c8ac3127e997331047dfc0';
export const contractAddress='0x4F2777861cc5bDD0d6AED86014cE1370BF823884';
export const constructorAddresses=Object.freeze([
 '0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',
 '0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89',
 '0x74015dedf36677485793f1714ec7bd4893907b26'
]);
export const constructorArguments=AbiCoder.defaultAbiCoder()
 .encode(['address','address','address'],constructorAddresses).slice(2);

function checkedCompile(input,options){
 const output=JSON.parse(solc.compile(JSON.stringify(input),options));
 const failures=(output.errors||[]).filter(e=>e.severity==='error');
 if(failures.length)throw Error('V3_VERIFICATION_COMPILE_FAILED: '+failures.map(e=>e.formattedMessage).join('\n'));
 const artifact=output.contracts?.[sourcePath]?.GlobalV3HourlyTestnet;
 if(!artifact?.evm?.bytecode?.object||!artifact?.evm?.deployedBytecode?.object)
  throw Error('V3_VERIFICATION_ARTIFACT_MISSING');
 return artifact;
}

// Compare both against the deployment-time creation-bytecode pin. A matching
// local build alone is not proof that an explorer or live chain was checked.
export function assertMatchingBuild(original,packaged){
 const a=original?.evm?.bytecode?.object,b=packaged?.evm?.bytecode?.object;
 const ar=original?.evm?.deployedBytecode?.object,br=packaged?.evm?.deployedBytecode?.object;
 if(!a||!b||!ar||!br||a!==b||ar!==br||keccak256('0x'+a)!==expectedCreationHash)
  throw Error('V3_VERIFICATION_BYTECODE_MISMATCH');
}

export function prepareHourlyVerification(){
 if(!solc.version().startsWith('0.8.30+commit.73712a01.'))throw Error('V3_VERIFICATION_COMPILER_MISMATCH');
 const sources={[sourcePath]:{content:hourlyV3Source(fs.readFileSync(sourcePath,'utf8'))}};
 const settings={optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
 const input={language:'Solidity',sources,settings};
 // Record the exact canonical source names and content returned to solc by the
 // same resolver used for the deployed hourly release.
 const original=checkedCompile(input,{import:name=>{
  try{
   const resolved=path.resolve(name.startsWith('contracts/')?name:path.join('node_modules',name));
   const content=fs.readFileSync(resolved,'utf8');
   sources[name]={content};
   return {contents:content};
  }catch{return {error:'Cannot resolve '+name};}
 }});
 const packaged=checkedCompile(input);
 assertMatchingBuild(original,packaged);
 return input;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--out')throw Error('Use --out followed by a new output file path.');
  const output=path.resolve(process.argv[3]);
  const input=prepareHourlyVerification();
  // Never replace an existing file or follow an existing output symlink.
  fs.writeFileSync(output,JSON.stringify(input,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('V3_HOURLY_VERIFICATION_PACKAGE '+JSON.stringify({output,chainId:97,
   contract:contractAddress,contractName,compilerVersion,constructorArguments,
   creationBytecodeHash:expectedCreationHash,sourceCount:Object.keys(input.sources).length,
   optimizerRuns:1,viaIR:true,evmVersion:'shanghai',explorerSubmission:false,
   liveChainChecked:false,transactionSent:false}));
 }catch(error){console.error('V3_HOURLY_VERIFICATION_PACKAGE_ERROR '+String(error?.message||error));process.exitCode=1;}
}
