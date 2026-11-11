// Prepare the target-bound testnet activity gate without changing the installed API.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {validateDailyActivityPolicy} from './daily-activity.mjs';
import {NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_STATE_DIR,loadNewDeployerRelease} from './new-deployer-testnet-profile.mjs';
import {readImmutableV1Archive,readNewDeployerPrivateText} from './connect-new-deployer-testnet.mjs';
import {verifyNewDeployerAutomationReadiness} from './new-deployer-testnet-automation.mjs';

export const ACTIVITY_POLICY='/etc/globaldroptrade/new-deployer-testnet-v1/daily-activity-policy.json';
export const ACTIVITY_HISTORY='/var/lib/globaldroptrade-api/new-deployer-testnet-activity-v1/history.json';
const ORIGIN='https://globaldroptrade.com';
const STATUS='/var/www/globaldroptrade/automation-data/new-deployer-activation.json';
const keys=['DAILY_ACTIVITY_FILE','DAILY_ACTIVITY_ORIGIN','DAILY_ACTIVITY_ACTIVATION_TIMESTAMP','GLOBAL_AUTOMATION_PUBLIC_STATUS'];
const sha=value=>createHash('sha256').update(value).digest('hex');

export function prepareActivitySettings(original,readiness,existing){
 if(readiness?.chainId!==97||readiness.releaseId!=='global-new-deployer-testnet-v1'||!Number.isSafeInteger(readiness.checkpoint?.timestamp)||readiness.checkpoint.timestamp<1)throw Error('NEW_DEPLOYER_ACTIVITY_READINESS_REQUIRED');
 const identity={chainId:97,vaultAddress:readiness.target,origin:ORIGIN};
 const raw=existing??{version:1,...identity,windowSeconds:86400,activationTimestamp:readiness.checkpoint.timestamp+86400,historyFile:ACTIVITY_HISTORY};
 const policy=validateDailyActivityPolicy(raw,identity);
 if(policy.historyFile!==ACTIVITY_HISTORY)throw Error('NEW_DEPLOYER_ACTIVITY_HISTORY_MISMATCH');
 const settings=parseEnv(original);
 if(settings.TRADES_CHAIN_ID!=='97'||settings.TRADES_ZERO_START_PROFILE!==readiness.releaseId||String(settings.TRADES_VAULT_ADDRESS).toLowerCase()!==readiness.target.toLowerCase()||settings.GLOBAL_MIGRATION_ENABLED!=='false')throw Error('NEW_DEPLOYER_ACTIVITY_API_TARGET_MISMATCH');
 const updates={DAILY_ACTIVITY_FILE:ACTIVITY_HISTORY,DAILY_ACTIVITY_ORIGIN:ORIGIN,DAILY_ACTIVITY_ACTIVATION_TIMESTAMP:String(policy.activationTimestamp),GLOBAL_AUTOMATION_PUBLIC_STATUS:STATUS};
 const staged=keys.every(key=>settings[key]===updates[key])?original:original+(original.endsWith('\n')?'':'\n')+keys.map(key=>`${key}="${updates[key]}"`).join('\n')+'\n';
 const after=parseEnv(staged),other=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)).sort(([a],[b])=>a.localeCompare(b)));
 if(JSON.stringify(other(settings))!==JSON.stringify(other(after))||keys.some(key=>after[key]!==updates[key]))throw Error('NEW_DEPLOYER_ACTIVITY_ENV_PRESERVATION_FAILED');
 return {policy,staged,originalSha256:sha(original),stagedSha256:sha(staged)};
}

function writeNew(file,data){const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
async function main(){
 if(process.getuid?.()!==0||process.argv.length!==3)throw Error('NEW_DEPLOYER_ACTIVITY_PREPARE_REQUIRED');
 const stage=path.resolve(process.argv[2]),st=fs.lstatSync(stage);
 if(!st.isDirectory()||st.uid!==0||(st.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_STAGE_REQUIRED');
 const original=readNewDeployerPrivateText('/etc/globaldroptrade/trades.env'),config=readConfig(parseEnv(original));
 const release=loadNewDeployerRelease(),artifact=JSON.parse(fs.readFileSync(NEW_DEPLOYER_ARTIFACT_FILE,'utf8'));
 const deploymentReport=JSON.parse(readNewDeployerPrivateText(NEW_DEPLOYER_STATE_DIR+'/deployment-public.json'));
 const connectionReport=JSON.parse(readNewDeployerPrivateText(NEW_DEPLOYER_STATE_DIR+'/connection-public.json'));
 const archive=readImmutableV1Archive(),request=new FetchRequest(config.rpcUrl);request.timeout=15000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  const readiness=await verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport,connectionReport,archive,original,confirmations:Math.max(3,config.confirmations)});
  let existing=null;
  try{existing=JSON.parse(readNewDeployerPrivateText(ACTIVITY_POLICY));}catch(error){if(error.code!=='ENOENT')throw error;}
  const prepared=prepareActivitySettings(original,readiness,existing);
  writeNew(stage+'/trades.original',original);writeNew(stage+'/trades.staged',prepared.staged);
  writeNew(stage+'/activity-policy.json',JSON.stringify(prepared.policy,null,2)+'\n');
  writeNew(stage+'/activity-preflight.json',JSON.stringify({version:1,chainId:97,target:readiness.target,existingPolicy:existing!==null,activationTimestamp:prepared.policy.activationTimestamp,originalSha256:prepared.originalSha256,stagedSha256:prepared.stagedSha256,archiveSessionSha256:archive.digest},null,2)+'\n');
  console.log('NEW_DEPLOYER_ACTIVITY_PREPARED target='+readiness.target+' activation='+prepared.policy.activationTimestamp);
 }finally{provider.destroy();}
}
let invoked;try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)try{await main();}catch(error){console.error('NEW_DEPLOYER_ACTIVITY_PREPARE_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(error.message||'')?error.message:'CHECK_REQUIRED'));process.exitCode=1;}
