// Explicit, signer-free transition before any prior daily credit has been sent.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,keccak256,getAddress} from 'ethers';
import {validateDailyPolicy,assertHourlyTestTarget,isHourlyTestPolicy} from './daily-profit.mjs';
import {isPositionPolicy,positionBasis} from './position-profit.mjs';
import {assertZeroStartJournalCanonical} from './zero-start-automation.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {getZeroStartProfile} from './zero-start-profile.mjs';
const target='0xfA53C3337825cDE4f760a6Fa45A87D8A7B353f75';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function positionPolicyTransition({policy,state,expectedTarget=target}){
 policy=validateDailyPolicy(policy);
 if(!isHourlyTestPolicy(policy)||getAddress(policy.vaultAddress)!==getAddress(expectedTarget))throw Error('POSITION_EXPECTED_FAST_TARGET_REQUIRED');
 if(isPositionPolicy(policy))return policy;
 if(state.hourlyTestTransition||state.pending||state.oracle?.pending||(state.daily?.lastCredit&&(!Array.isArray(state.daily.lastCredit.credited)||state.daily.lastCredit.credited.length>0))||Object.entries(state.transactions||{}).some(([label,t])=>label.startsWith('daily-')||!Number.isSafeInteger(t?.block)||t.block<1))throw Error('POSITION_PREVIOUS_OR_PENDING_CREDITS_REQUIRE_REVIEW');
 if(state.daily?.positionIndex||state.daily?.positionPaid)throw Error('POSITION_EXISTING_STATE_REQUIRES_REVIEW');
 return validateDailyPolicy({...policy,basis:positionBasis,positionScheduleVersion:1});
}
function read(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('POSITION_PRIVATE_FILE_REQUIRED');return JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}}
async function main(){
 if(process.getuid?.()!==0||process.argv.slice(2).join(' ')!=='--execute')throw Error('POSITION_ROOT_EXECUTE_REQUIRED');
 if(process.env.TRADES_CHAIN_ID!=='97'||getAddress(process.env.TRADES_VAULT_ADDRESS)!==target||!process.env.TRADES_RPC_URL)throw Error('POSITION_CONNECTED_TESTNET_REQUIRED');
 const profile=getZeroStartProfile(true),policyFile=profile.automationDir+'/daily-policy.json',intentFile=profile.automationDir+'/position-policy-transition-v1.json';
 const policy=read(policyFile),state=read(profile.automationDir+'/journal.json'),next=positionPolicyTransition({policy,state});
 const transport=new FetchRequest(process.env.TRADES_RPC_URL);transport.timeout=15000;
 const p=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl)),v=new Contract(target,artifact.abi,p);
  await assertHourlyTestTarget({provider:p,vault:v,policy});await assertZeroStartJournalCanonical(p,state);
  if(!state.identity||state.identity.target!==target||state.identity.runtimeHash!==policy.runtimeHash)throw Error('POSITION_JOURNAL_IDENTITY_MISMATCH');
  let intent;
  if(fs.existsSync(intentFile)){intent=read(intentFile);if(intent.version!==1||!equal(intent.next,next)||!equal(policy,intent.previous)&&!equal(policy,intent.next))throw Error('POSITION_TRANSITION_CHANGED');}
  else{
   if(isPositionPolicy(policy))throw Error('POSITION_TRANSITION_ARCHIVE_REQUIRED');
   intent={version:1,previous:policy,next};writePrivateJson(intentFile,intent);
  }
  if(!equal(policy,next))writePrivateJson(policyFile,next);
  console.log('POSITION_HOURLY_POLICY_INSTALLED target='+target);
  console.log('First full profit hour begins at each deposit or reinvestment timestamp. No financial journal or prior credit was reset.');
 }finally{await p.destroy();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1]))main().catch(e=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'POSITION_POLICY_CHECK_FAILED');process.exitCode=1;});
