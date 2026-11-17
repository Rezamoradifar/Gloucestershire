// Build-only helper for the isolated BNB Testnet site. Never signs or broadcasts.
import {execFileSync,spawnSync} from 'node:child_process';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readPinnedProof,planUnifiedPreviewSite} from './v3-unified-site-preview-preflight.mjs';

const args=process.argv.slice(2);
if(args.length!==5||!/^\/[\w./-]+$/.test(args[0])||!/^[a-f0-9]{64}$/.test(args[1])||
 !/^[a-f0-9]{40}$/.test(args[2])||!['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'].includes(args[3])||
 !/^(disabled|[a-f0-9]{32})$/.test(args[4]))throw Error('UNIFIED_SITE_BUILD_ARGUMENTS_INVALID');
const [proofPath,digest,sha,rpc,wallet]=args;
const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(actual!==sha)throw Error('UNIFIED_SITE_BUILD_SOURCE_MISMATCH');
execFileSync('git',['diff','--quiet','HEAD','--']);
const proof=readPinnedProof(proofPath,digest);
const request=new FetchRequest(rpc);request.timeout=8000;
const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
try{
 const plan=await planUnifiedPreviewSite({provider,proof,sourceSha:actual,expectedSourceSha:sha});
 const clean={...process.env};
 for(const key of Object.keys(clean))if(key.startsWith('VITE_'))delete clean[key];
 const run=(args,env)=>{
  const result=spawnSync('npm',args,{stdio:'inherit',env});
  if(result.error||result.status!==0)throw Error('UNIFIED_SITE_BUILD_COMMAND_FAILED');
 };
 run(['test','--prefix','website','--','--maxWorkers=2'],clean);
 run(['run','build','--prefix','website'],{...clean,...plan.env,VITE_WALLETCONNECT_PROJECT_ID:wallet==='disabled'?'':wallet});
 // A second independent read ensures the canonical deployment did not change during tests/build.
 await planUnifiedPreviewSite({provider,proof,sourceSha:actual,expectedSourceSha:sha});
 console.log('UNIFIED_SITE_BUILD_VERIFIED '+JSON.stringify({chainId:97,sourceSha:sha,vault:plan.env.VITE_V3_CONTRACT_ADDRESS,route:'/unified-test/',readOnlyPreview:plan.readOnlyPreview}));
}finally{provider.destroy();}
