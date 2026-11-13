#!/usr/bin/env node
// Read-only deployment identity and UI contract-compatibility gate for isolated BNB Testnet V2.
import fs from 'node:fs';
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,getAddress,isAddress,keccak256} from 'ethers';

const CHAIN_ID=97;
const V2=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const OLD=getAddress('0x4C0F6141b18971db4b14e45c0bE8CddB09febc14');
const DEFAULT_RPC='https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const requireCheck=(ok,msg)=>{if(!ok)throw Error(msg);};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const fingerprint=(value)=>keccak256(value);
const signatures=(abi)=>new Set(new Interface(abi.filter(x=>x.type==='function')).fragments.map(f=>f.format('sighash')));

function maskImmutables(hex,refs){
 const bytes=hex.toLowerCase().replace(/^0x/,'').split('');
 for(const slots of Object.values(refs||{})){
  for(const {start,length} of slots){
   requireCheck(Number.isSafeInteger(start)&&Number.isSafeInteger(length)&&start>=0&&length>0,'Invalid immutable reference');
   requireCheck((start+length)*2<=bytes.length,'Invalid immutable reference bounds');
   bytes.fill('?',start*2,(start+length)*2);
  }
 }
 return bytes.join('');
}

async function main(){
 requireCheck(process.argv.length===3&&process.argv[2]==='--check','Usage: node scripts/verify-v2-site-contract.mjs --check');
 const a=json('artifacts/FastNewDeployerTestnetVault.json');
 const ui=json('website/src/vault-abi.json');
 const deployed=a.evm?.deployedBytecode;
 requireCheck(typeof deployed?.object==='string'&&deployed.object.length>1000,'No compiled runtime artifact');
 const uiSigs=signatures(ui),chainSigs=signatures(a.abi);
 const missing=[...uiSigs].filter(s=>!chainSigs.has(s));
 requireCheck(missing.length===0,'The V2 artifact is missing UI ABI functions: '+missing.join(', '));
 // The UI also imports the dynamic reward/withdrawal ABI from reward-mode.ts.
 for(const name of ['REWARD_ACCRUAL_VERSION','AUTO_REWARD_GROUP_VERSION','withdrawalQueue','claimNetworkRewards']){
  requireCheck(a.abi.some(f=>f.type==='function'&&f.name===name),'V2 reward feature missing: '+name);
 }
 const url=process.env.V2_RPC_URL||DEFAULT_RPC;
 requireCheck(/^https:\/\//.test(url),'Use an HTTPS V2_RPC_URL');
 const req=new FetchRequest(url);req.timeout=12000;
 const provider=new JsonRpcProvider(req,CHAIN_ID,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  const actual=Number(BigInt(await provider.send('eth_chainId',[])));
  requireCheck(actual===CHAIN_ID,'Wrong RPC chain');
  requireCheck(V2!==OLD,'Old contract target forbidden');
  const onchain=await provider.getCode(V2);
  requireCheck(onchain!=='0x','No V2 contract code at approved address');
  const artifactCode='0x'+deployed.object;
  requireCheck(onchain.length===artifactCode.length,'Runtime length differs from reviewed V2 artifact');
  requireCheck(maskImmutables(onchain,deployed.immutableReferences)===maskImmutables(artifactCode,deployed.immutableReferences),
   'Runtime bytecode differs from reviewed V2 artifact outside constructor immutables');
  const vault=new Contract(V2,a.abi,provider);
  const [owner,token,queue,version,deferred,paused]=await Promise.all([
   vault.owner(),vault.usdt(),vault.withdrawalQueue(),vault.FAST_TESTNET_VERSION(),
   vault.REWARD_ACCRUAL_VERSION(),vault.paused()
  ]);
  requireCheck([owner,token,queue].every(x=>isAddress(x)&&getAddress(x)!==ZeroAddress),'Missing owner, USDT, or queue');
  requireCheck(version>0n&&deferred===1n,'Unexpected V2 feature/reward version');
  const queueC=new Contract(queue,['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)'],provider);
  const [queueVault,approval]=await Promise.all([queueC.vault(),queueC.APPROVAL_VERSION()]);
  requireCheck(getAddress(queueVault)===V2&&approval===1n,'Withdrawal queue does not support V2 approval');
  const summary={result:'V2_RUNTIME_AND_UI_ABI_READONLY_PASS',chainId:CHAIN_ID,vault:V2,
   owner,usdt:token,withdrawalQueue:queue,paused,uiSignaturesMatched:uiSigs.size,
   sourceRuntimeHash:fingerprint(artifactCode),liveRuntimeHash:fingerprint(onchain),
   assertion:'Same runtime after masking constructor immutables; no financial transactions executed',
   financialEndToEndVerified:false,mainnetReady:false};
  console.log(JSON.stringify(summary,(_,v)=>typeof v==='bigint'?v.toString():v,2));
 }finally{provider.destroy();}
}
main().catch(e=>{console.error('V2_COMPATIBILITY_BLOCKED:',e.message);process.exitCode=1;});
