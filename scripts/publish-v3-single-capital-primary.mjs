// Publish the verified one-hour single-capital account on the main website.
import fs from 'node:fs';
import path from 'node:path';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {SINGLE_CAPITAL_PROFILE,REFERRAL_PROFIT_PROFILE,MANUAL_REINVEST_PROFILE,unifiedProfileForFlag,UNIFIED_DEPLOYER} from './v3-unified-release-pins.mjs';
import {readPinnedProof} from './v3-unified-site-preview-preflight.mjs';
import {verifyUnifiedRelease} from './verify-v3-unified-release.mjs';
import {withUnifiedReadRpc} from './v3-unified-verification-rpc.mjs';
import {verifyActiveWorker} from './v3-unified-worker-readiness.mjs';
import {readWalletConfig} from './read-v3-wallet-config.mjs';

export function primaryReleaseEnv(proof,operator,wallet,profile=SINGLE_CAPITAL_PROFILE){
 if(wallet!=='disabled'&&!/^[a-f0-9]{32}$/.test(wallet))throw Error('GLOBAL_PRIMARY_WALLET_CONFIG_INVALID');
 return {
  VITE_V3_PRIMARY_DASHBOARD:'verified-testnet',VITE_V3_HOURLY_TEST:'isolated-1h',
  VITE_V3_LANDING_AT_ROOT:'true',VITE_V3_UNIFIED_PRIMARY:profile.mode,
  VITE_V3_CONTRACT_ADDRESS:proof.vault,VITE_V3_RUNTIME_HASH:proof.vaultRuntimeHash,
  VITE_V3_DEPLOYMENT_TX:proof.deploymentTx,VITE_V3_UNIFIED_MODE:profile.mode,
  VITE_V3_UNIFIED_BOOK:proof.book,VITE_V3_UNIFIED_BOOK_HASH:proof.bookRuntimeHash,
  VITE_V3_UNIFIED_NETWORK:proof.network,VITE_V3_UNIFIED_NETWORK_HASH:proof.networkRuntimeHash,
  VITE_V3_UNIFIED_WALLET_ACTIONS:'verified-isolated-testnet',VITE_V3_UNIFIED_KEEPER:operator,
  VITE_WALLETCONNECT_PROJECT_ID:wallet==='disabled'?'':wallet
 };
}

const https=['-fsS','--noproxy','*','--max-time','15','--resolve','globaldroptrade.com:443:127.0.0.1'];
const capture=(command,args)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function run(args,env=process.env){
 const result=spawnSync(args[0],args.slice(1),{env,stdio:'inherit'});
 if(result.error||result.status!==0)throw Error('GLOBAL_PRIMARY_COMMAND_FAILED');
}

async function main(){
 const [mode,sha,digest,rpc,flag='--single-capital',...extra]=process.argv.slice(2);
 if(extra.length||!['--single-capital','--referral-profit','--manual-reinvest'].includes(flag)||!['--install','--check-build'].includes(mode)||!/^[a-f0-9]{40}$/.test(sha??'')||
  !/^[a-f0-9]{64}$/.test(digest??'')||
  !['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'].includes(rpc))
  throw Error('GLOBAL_PRIMARY_ARGUMENTS_INVALID');
 if(process.getuid()!==0||hostname().split('.')[0]!=='vps-luna-2585')
  throw Error('GLOBAL_PRIMARY_WRONG_SERVER');
 if(capture('git',['rev-parse','HEAD'])!==sha)throw Error('GLOBAL_PRIMARY_SOURCE_MISMATCH');
 execFileSync('git',['diff','--quiet','HEAD','--']);
 const profile=unifiedProfileForFlag(flag);
 const proofPath=path.join(profile.stateDirectory,'deployment-proof.json');
 const proof=readPinnedProof(proofPath,digest);
 const ready=verifyActiveWorker({sha,digest,vault:proof.vault},profile);
 if(profile===MANUAL_REINVEST_PROFILE&&ready.gasReady!==true)throw Error('GLOBAL_PRIMARY_MANUAL_REINVEST_KEEPER_NEEDS_TEST_GAS');
 if(profile===REFERRAL_PROFIT_PROFILE&&ready.gasReady!==true)throw Error('GLOBAL_PRIMARY_REFERRAL_KEEPER_NEEDS_TEST_GAS');

 if(mode==='--check-build'){
  await withUnifiedReadRpc(rpc,'primary-build',provider=>verifyUnifiedRelease(provider,proof,UNIFIED_DEPLOYER,profile));
  const wallet=readWalletConfig('website/dist',undefined,true);
  for(const [name,value] of Object.entries(primaryReleaseEnv(proof,ready.operator,wallet,profile)))
   if(process.env[name]!==value)throw Error('GLOBAL_PRIMARY_BUILD_ENV_MISMATCH');
  const scripts=fs.readdirSync('website/dist/assets').filter(name=>/^V3Dashboard-[\w-]+\.js$/.test(name));
  if(scripts.length!==1)throw Error('GLOBAL_PRIMARY_DASHBOARD_ASSET_INVALID');
  const dashboard=fs.readFileSync(path.join('website/dist/assets',scripts[0]),'utf8').toLowerCase();
  for(const value of [proof.vault,proof.vaultRuntimeHash,proof.deploymentTx,proof.book,
   proof.bookRuntimeHash,proof.network,proof.networkRuntimeHash,ready.operator])
   if(!dashboard.includes(value.toLowerCase()))throw Error('GLOBAL_PRIMARY_BUILD_IDENTITY_MISMATCH');
  console.log('GLOBAL_PRIMARY_BUILD_IDENTITY_VERIFIED');
  return;
 }

 const work=fs.mkdtempSync('/opt/global-v3-primary-check.');
 try{
  fs.writeFileSync(path.join(work,'nginx.conf'),capture('nginx',['-T']));
  execFileSync('curl',[...https,'https://globaldroptrade.com/','-o',path.join(work,'root.html')]);
  const root=capture('python3',['scripts/verify-nginx-served-root.py','--nginx-config',path.join(work,'nginx.conf'),
   '--served',path.join(work,'root.html')]);
  const hourly=path.join(root,'hourly-test');
  for(const filename of [hourly,path.join(hourly,'assets'),path.join(hourly,'index.html')]){
   const metadata=fs.lstatSync(filename);
   if(metadata.isSymbolicLink()||metadata.uid!==0||(metadata.mode&0o022))
    throw Error('GLOBAL_PRIMARY_HOURLY_PATH_UNSAFE');
  }
  const wallet=readWalletConfig(hourly,undefined,true);
  execFileSync('curl',[...https,'https://globaldroptrade.com/hourly-test/','-o',path.join(work,'hourly.html')]);
  if(!fs.readFileSync(path.join(hourly,'index.html')).equals(fs.readFileSync(path.join(work,'hourly.html'))))
   throw Error('GLOBAL_PRIMARY_HOURLY_ROUTE_MISMATCH');
  const hourlyIndex=createHash('sha256').update(fs.readFileSync(path.join(work,'hourly.html'))).digest('hex');
  console.log('GLOBAL_PRIMARY_STAGE=BUILDING');
  run(['node','scripts/build-v3-unified-site.mjs',proofPath,digest,sha,rpc,wallet,
   '--enable-testnet-wallets','--primary',flag]);
  const env={...process.env};
  for(const name of Object.keys(env))if(name.startsWith('VITE_'))delete env[name];
  Object.assign(env,primaryReleaseEnv(proof,ready.operator,wallet,profile),{
   GLOBAL_V2_EXPECTED_SHA:sha,GLOBAL_V3_MAIN_PREPARED_BUILD:profile.mode,
   GLOBAL_V3_PRIMARY_PROOF_SHA256:digest,GLOBAL_V3_PRIMARY_RPC:rpc,
   GLOBAL_V3_RELEASE_PROFILE:'',GLOBAL_V3_MAIN_REUSE_TESTED_DEPS:'',
   V3_EXPECTED_WALLET_CONFIG:wallet
  });
  if(profile===REFERRAL_PROFIT_PROFILE||profile===MANUAL_REINVEST_PROFILE){
   // Preserve the incumbent wallet route for existing accounts and invitations.
   const previousProfile=profile===MANUAL_REINVEST_PROFILE?REFERRAL_PROFIT_PROFILE:SINGLE_CAPITAL_PROFILE;
   const previous=path.join(root,previousProfile.route.slice(1));
   execFileSync('curl',[...https,'https://globaldroptrade.com'+previousProfile.route,'-o',path.join(work,'previous.html')]);
   if(!fs.readFileSync(path.join(previous,'index.html')).equals(fs.readFileSync(path.join(work,'previous.html'))))
    throw Error('GLOBAL_PRIMARY_PREVIOUS_ACCOUNT_UNAVAILABLE');
   run(['python3','scripts/check-v3-unified-route.py',previous,work,'--'+previousProfile.mode.replace('-testnet','')]);
   run(['bash','scripts/install-v3-unified-test-site.sh',flag,'--install-built',sha,
    proofPath,digest,rpc,'--enable-testnet-wallets'],env);
   run(['bash','ubuntu-global-v2-site.sh','--install'],env);
   console.log('GLOBAL_PRIMARY_STAGE=COMPLETE');
   return;
  }
  console.log('GLOBAL_PRIMARY_STAGE=PUBLISHING_DOMAIN');
  run(['bash','ubuntu-global-v2-site.sh','--install'],env);
  console.log('GLOBAL_PRIMARY_STAGE=PUBLISHING_ACCOUNT_ROUTE');
  run(['bash','scripts/install-v3-unified-test-site.sh','--single-capital','--install-built',sha,
   proofPath,digest,rpc,'--enable-testnet-wallets'],env);
  console.log('GLOBAL_PRIMARY_STAGE=PUBLISHING_HOURLY_ROUTE');
  run(['python3','scripts/publish-v3-hourly-account-route.py','--site-root',root,'--dist','website/dist',
   '--expected-hourly-index',hourlyIndex],env);
  console.log('GLOBAL_PRIMARY_STAGE=COMPLETE');
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(error=>{
  const message=String(error?.message??'');
  console.error(/^[A-Z][A-Z_0-9]{3,100}$/.test(message)?message:'GLOBAL_PRIMARY_PUBLICATION_FAILED');
  process.exitCode=1;
 });
