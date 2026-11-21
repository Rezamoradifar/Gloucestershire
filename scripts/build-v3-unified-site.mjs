// Build-only helper for the isolated BNB Testnet site. Never signs or broadcasts.
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {withUnifiedReadRpc} from './v3-unified-verification-rpc.mjs';
import {recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {verifyActiveWorker} from './v3-unified-worker-readiness.mjs';
import {readPinnedProof,planUnifiedPreviewSite} from './v3-unified-site-preview-preflight.mjs';
import {unifiedProfileForFlag} from './v3-unified-release-pins.mjs';

const args=process.argv.slice(2);
const profile=unifiedProfileForFlag(['--single-capital','--daily-capital'].includes(args.at(-1))?args.pop():undefined);
const primary=args.at(-1)==='--primary'?Boolean(args.pop()):false;
const writes=args.length===6&&args[5]==='--enable-testnet-wallets';
if(primary&&(!writes||profile.mode!=='single-capital-testnet'))throw Error('UNIFIED_PRIMARY_REQUIRES_SINGLE_CAPITAL_WALLETS');
if((args.length!==5&&!writes)||!/^\/[\w./-]+$/.test(args[0])||!/^[a-f0-9]{64}$/.test(args[1])||
 !/^[a-f0-9]{40}$/.test(args[2])||!['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'].includes(args[3])||
 !/^(disabled|[a-f0-9]{32})$/.test(args[4]))throw Error('UNIFIED_SITE_BUILD_ARGUMENTS_INVALID');
const [proofPath,digest,sha,rpc,wallet]=args;
if(writes&&proofPath!==path.join(profile.stateDirectory,'deployment-proof.json'))
 throw Error('UNIFIED_SITE_PROOF_PATH_MISMATCH');
const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(actual!==sha)throw Error('UNIFIED_SITE_BUILD_SOURCE_MISMATCH');
execFileSync('git',['diff','--quiet','HEAD','--']);
const proof=readPinnedProof(proofPath,digest);
const verifyPlan=provider=>planUnifiedPreviewSite({provider,proof,sourceSha:actual,expectedSourceSha:sha,profile});
const plan=await withUnifiedReadRpc(rpc,'pre-build',verifyPlan);
const worker={sha,digest,vault:proof.vault};
let workerReady;
if(writes)workerReady=verifyActiveWorker(worker,profile);
const clean={...process.env};
for(const key of Object.keys(clean))if(key.startsWith('VITE_'))delete clean[key];
const run=(args,env)=>{
 const result=spawnSync('npm',args,{stdio:'inherit',env});
 if(result.error||result.status!==0)throw Error('UNIFIED_SITE_BUILD_COMMAND_FAILED');
};
run(['test','--prefix','website','--','--maxWorkers=2'],clean);
const releaseEnv={...clean,...plan.env,VITE_WALLETCONNECT_PROJECT_ID:wallet==='disabled'?'':wallet};
if(writes)releaseEnv.VITE_V3_UNIFIED_WALLET_ACTIONS='verified-isolated-testnet';
if(writes&&profile.mode!=='unified-testnet')
 releaseEnv.VITE_V3_UNIFIED_KEEPER=workerReady.operator;
if(primary){
 releaseEnv.VITE_V3_LANDING_AT_ROOT='true';
 releaseEnv.VITE_V3_UNIFIED_PRIMARY='single-capital-testnet';
}
run(['run','build','--prefix','website'],releaseEnv);
await withUnifiedReadRpc(rpc,'post-build',async provider=>{
 await verifyPlan(provider);
 await recheckUnifiedBlock(provider,plan.anchor);
});
if(writes&&verifyActiveWorker(worker,profile).operator!==workerReady.operator)
 throw Error('UNIFIED_SITE_WORKER_IDENTITY_CHANGED');
console.log('UNIFIED_SITE_BUILD_VERIFIED '+JSON.stringify({chainId:97,sourceSha:sha,vault:plan.env.VITE_V3_CONTRACT_ADDRESS,route:primary?'/':plan.routeCandidate,readOnlyPreview:!writes}));
