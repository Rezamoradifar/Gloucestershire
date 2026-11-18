// Read-only proof and build-configuration preflight for an isolated unified
// testnet preview. It does not install a site, deploy, sign or move assets.
// The proof digest must be obtained from a separately authenticated source:
// a digest copied from the same untrusted proof is NOT an independent audit.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FetchRequest,JsonRpcProvider,getAddress} from 'ethers';
import {validateUnifiedProof,verifyUnifiedDeployment,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';

const MANAGER=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const LEGACY=new Set([
 getAddress('0x4F2777861cc5bDD0d6AED86014cE1370BF823884'),
 getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07'),
 getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89')
]);
const SOURCE=/^[0-9a-f]{40}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const ROUTE='/unified-test/';
const RPCS=new Set(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);

export function readPinnedProof(filename,expectedDigest){
 if(typeof filename!=='string'||!path.isAbsolute(filename)||filename!==path.resolve(filename)||
    typeof expectedDigest!=='string'||!DIGEST.test(expectedDigest))throw Error('UNIFIED_PREVIEW_PROOF_ARGUMENT_INVALID');
 if(fs.realpathSync(filename)!==filename)throw Error('UNIFIED_PREVIEW_PROOF_SYMLINK');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size<2||stat.size>65536)
   throw Error('UNIFIED_PREVIEW_PROOF_FILE_UNSAFE');
  const bytes=fs.readFileSync(fd);
  if(createHash('sha256').update(bytes).digest('hex')!==expectedDigest)throw Error('UNIFIED_PREVIEW_PROOF_DIGEST_MISMATCH');
  return JSON.parse(bytes.toString('utf8'));
 }finally{fs.closeSync(fd);}
}

export async function planUnifiedPreviewSite({provider,proof:raw,sourceSha,expectedSourceSha,makeContract}){
 if(typeof sourceSha!=='string'||typeof expectedSourceSha!=='string'||
    !SOURCE.test(sourceSha)||!SOURCE.test(expectedSourceSha)||sourceSha!==expectedSourceSha)
  throw Error('UNIFIED_PREVIEW_SOURCE_SHA_MISMATCH');
 const proof=validateUnifiedProof(raw);
 if(proof.manager!==MANAGER||proof.feeReceiver!==FEE||[proof.vault,proof.book,proof.network].some(address=>LEGACY.has(address)))
  throw Error('UNIFIED_PREVIEW_PROOF_CONFIG_MISMATCH');
 const verified=await verifyUnifiedDeployment(provider,proof,makeContract?{makeContract}:{});
 await recheckUnifiedBlock(provider,verified.block);
 // These values are data only; never evaluate them as shell or install them.
 const env={VITE_V3_PRIMARY_DASHBOARD:'verified-testnet',VITE_V3_HOURLY_TEST:'isolated-1h',VITE_V3_LANDING_AT_ROOT:'false',
  VITE_V3_CONTRACT_ADDRESS:proof.vault,VITE_V3_RUNTIME_HASH:proof.vaultRuntimeHash,
  VITE_V3_DEPLOYMENT_TX:proof.deploymentTx,VITE_V3_UNIFIED_MODE:'unified-testnet',
  VITE_V3_UNIFIED_BOOK:proof.book,VITE_V3_UNIFIED_BOOK_HASH:proof.bookRuntimeHash,
  VITE_V3_UNIFIED_NETWORK:proof.network,VITE_V3_UNIFIED_NETWORK_HASH:proof.networkRuntimeHash};
 return {status:'PROOF_CHECKED_NOT_RELEASE_READY',chainId:97,sourceSha,routeCandidate:ROUTE,
  anchor:verified.block,env,proofRequiresIndependentAuthentication:true,legacySiteChecked:false,
  routeVerified:false,releaseReady:false,readOnlyPreview:true,siteUpdated:false,transactionSent:false,
  migrationPerformed:false,keeperInstalled:false};
}

function checkoutSha(){
 const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
 if(fs.realpathSync(root)!==fs.realpathSync(process.cwd()))throw Error('UNIFIED_PREVIEW_CHECKOUT_ROOT_REQUIRED');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(!SOURCE.test(sha))throw Error('UNIFIED_PREVIEW_SOURCE_SHA_MISMATCH');
 try{execFileSync('git',['diff','--quiet','HEAD','--'],{stdio:'ignore'});}
 catch{throw Error('UNIFIED_PREVIEW_CHECKOUT_MODIFIED');}
 // Critical build inputs must belong to this exact commit. Ignore unrelated
 // untracked files, but never allow an untracked source or safety guard.
 for(const file of ['scripts/v3-unified-site-preview-preflight.mjs','scripts/verify-v3-unified-deployment.mjs',
  'contracts/v3/GlobalV3UnifiedTestnet.sol','contracts/v3/UnifiedReinvestmentBook.sol',
  'contracts/v3/UnifiedNetworkPlan.sol','website/src/V3Dashboard.tsx','website/src/v3-site-config.ts',
  'website/src/v3-chain.ts','website/src/v3-unified-position.ts','website/src/v3-account-flow.ts',
  'website/src/v3-unified-checkin.ts','website/src/v3-unified-reinvestment-flow.ts',
  'website/src/V3UnifiedActivity.tsx','website/src/V3UnifiedPositionPage.tsx']){
  try{execFileSync('git',['ls-files','--error-unmatch','--',file],{stdio:'ignore'});}
  catch{throw Error('UNIFIED_PREVIEW_CRITICAL_FILE_NOT_TRACKED');}
 }
 return sha;
}

async function main(args){
 if(args.length!==9||args[0]!=='--check'||args[1]!=='--proof'||args[3]!=='--proof-sha256'||
    args[5]!=='--source-sha'||args[7]!=='--rpc'||!RPCS.has(args[8]))
  throw Error('UNIFIED_PREVIEW_CHECK_ARGUMENTS_REQUIRED');
 const sha=checkoutSha(),proof=readPinnedProof(args[2],args[4]);
 const request=new FetchRequest(args[8]);request.timeout=8000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  const result=await planUnifiedPreviewSite({provider,proof,sourceSha:sha,expectedSourceSha:args[6]});
  console.log('V3_UNIFIED_PREVIEW_PREFLIGHT '+JSON.stringify(result));
  // Never use a successful preflight as authority to install this prototype.
  process.exitCode=2;
 }finally{provider.destroy();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 main(process.argv.slice(2)).catch(error=>{
  const message=typeof error?.message==='string'&&/^UNIFIED_[A-Z0-9_]+$/.test(error.message)?error.message:'UNIFIED_PREVIEW_PREFLIGHT_FAILED';
  console.error(message);process.exitCode=1;
 });
}
