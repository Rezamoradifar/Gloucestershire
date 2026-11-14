// Compile a separate BNB Testnet-only contract. Never alter the existing V3
// contract, deployment proof, website, account state, or production builds.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';

const FILE='contracts/v3/GlobalV3DeferredTestnet.sol';
const MOCK='000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const unique=(source,before,after)=>{
 const parts=source.split(before);
 if(parts.length!==2)throw Error('V3_HOURLY_SOURCE_ANCHOR_CHANGED');
 return parts.join(after);
};

export function hourlyV3Source(source){
 if(typeof source!=='string'||!source.includes('if(block.chainid!=97) revert WrongChain();'))
  throw Error('V3_HOURLY_TESTNET_CHAIN_GUARD_REQUIRED');
 let result=unique(source,'contract GlobalV3DeferredTestnet is',
  'contract GlobalV3HourlyTestnet is');
 result=unique(result,'uint256 public constant ONE_DAY = 1 days;',
  'uint256 public constant ONE_DAY = 1 days;\n    uint256 public constant ACCRUAL_PERIOD = 1 hours;');
 result=unique(result,'uint256(p.lastAccruedAt)+ONE_DAY',
  'uint256(p.lastAccruedAt)+ACCRUAL_PERIOD');
 result=unique(result,'if(manager==address(0)||fees==address(0)||token.code.length==0||',
  `if(token!=address(bytes20(hex"${MOCK}"))||manager==address(0)||fees==address(0)||token.code.length==0||`);
 return result;
}

export function compileHourly(){
 if(!solc.version().startsWith('0.8.30+commit.73712a01.'))
  throw Error('GLOBAL_V3_SOLC_0_8_30_REQUIRED');
 const original=fs.readFileSync(FILE,'utf8');
 const input={language:'Solidity',sources:{[FILE]:{content:hourlyV3Source(original)}},settings:{
  optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
 }};
 const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{return {contents:fs.readFileSync(path.resolve(name.startsWith('contracts/')?name:path.join('node_modules',name)),'utf8')};}
  catch{return {error:'Cannot resolve '+name};}
 }}));
 const errors=(output.errors||[]).filter(x=>x.severity==='error');
 if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
 const artifact=output.contracts[FILE]?.GlobalV3HourlyTestnet;
 if(!artifact)throw Error('V3_HOURLY_ARTIFACT_MISSING');
 const runtime=artifact.evm.deployedBytecode.object.length/2;
 const creation=artifact.evm.bytecode.object.length/2;
 if(runtime>24576||creation>49152)throw Error('V3_HOURLY_EVM_SIZE_LIMIT');
 return {...artifact,compiler:solc.version(),network:'BNB_TESTNET_ONLY',
  accrualPeriodSeconds:3600,checkInValiditySeconds:86400,sourceFile:FILE};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const artifact=compileHourly();
 fs.mkdirSync('artifacts',{recursive:true});
 fs.writeFileSync('artifacts/GlobalV3HourlyTestnet.json',JSON.stringify(artifact,null,2)+'\n');
 console.log('V3_HOURLY_COMPILE_ONLY_PASS '+JSON.stringify({
  chainId:97,accrualPeriodSeconds:3600,checkInValiditySeconds:86400,
  mockTokenOnly:true,noDeployment:true
 }));
}
