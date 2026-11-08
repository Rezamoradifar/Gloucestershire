import {ZeroAddress,getAddress,isAddress} from 'ethers';
import {assertHourlyTestTarget,newDeployerTestnetPolicyFields,validateDailyPolicy} from './daily-profit.mjs';
import {positionBasis} from './position-profit.mjs';
import {NEW_DEPLOYER_ARTIFACT,NEW_DEPLOYER_RELEASE_ID} from './new-deployer-testnet-profile.mjs';

const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);

function address(value,code){
 try{
  const result=getAddress(value);
  if(result===ZeroAddress)throw Error();
  return result;
 }catch{throw Error(code);}
}

// This readiness is deliberately narrower than the legacy fast profile.  A
// target connected under the archived V1 identity can never create this policy.
export function validateNewDeployerHourlyReadiness(value){
 if(value?.version!==1||value.releaseId!==NEW_DEPLOYER_RELEASE_ID||value.chainId!==97||value.artifact!==NEW_DEPLOYER_ARTIFACT||value.testMode!==true||value.initialServerReporter!==true||value.fastTestnetVersion!==1||value.newDeployerTestnetVersion!==1||value.fastNewDeployerTestnetVersion!==1||value.siteConnected!==true)throw Error('NEW_DEPLOYER_HOURLY_READINESS_REQUIRED');
 const target=address(value.target,'NEW_DEPLOYER_HOURLY_READINESS_REQUIRED'),contractAddress=address(value.contractAddress,'NEW_DEPLOYER_HOURLY_READINESS_REQUIRED');
 const owner=address(value.owner,'NEW_DEPLOYER_HOURLY_READINESS_REQUIRED'),operator=address(value.operator,'NEW_DEPLOYER_HOURLY_READINESS_REQUIRED');
 address(value.queue,'NEW_DEPLOYER_HOURLY_READINESS_REQUIRED');
 if(target!==contractAddress||owner===operator||!hash(value.runtimeHash)||!hash(value.artifactHash)||!hash(value.hash)||!hash(value.initcodeHash))throw Error('NEW_DEPLOYER_HOURLY_READINESS_REQUIRED');
 const checkpoint=value.checkpoint;
 if(!Number.isSafeInteger(value.block)||value.block<1||!Number.isSafeInteger(checkpoint?.block)||checkpoint.block<value.block||!hash(checkpoint.blockHash)||!Number.isSafeInteger(checkpoint.timestamp)||checkpoint.timestamp<1)throw Error('NEW_DEPLOYER_HOURLY_CHECKPOINT_REQUIRED');
 return {...value,target,contractAddress,owner,operator,queue:getAddress(value.queue)};
}

export function makeNewDeployerHourlyTestPolicy(readiness){
 const value=validateNewDeployerHourlyReadiness(readiness),checkpoint=value.checkpoint;
 return validateDailyPolicy({
  version:1,chainId:97,vaultAddress:value.target,runtimeHash:value.runtimeHash,deploymentBlock:value.block,
  startTimestamp:checkpoint.timestamp,activationBlock:checkpoint.block,activationBlockHash:checkpoint.blockHash,
  basis:positionBasis,positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,
  owner:value.owner,operator:value.operator,...newDeployerTestnetPolicyFields
 });
}

export async function assertNewDeployerHourlyTarget({provider,vault,readiness,policy=makeNewDeployerHourlyTestPolicy(readiness)}){
 const value=validateNewDeployerHourlyReadiness(readiness),validated=validateDailyPolicy(policy);
 if(validated.vaultAddress!==value.target||validated.runtimeHash!==value.runtimeHash||validated.deploymentBlock!==value.block||validated.owner!==value.owner||validated.operator!==value.operator||!isAddress(validated.vaultAddress))throw Error('NEW_DEPLOYER_HOURLY_TARGET_MISMATCH');
 await assertHourlyTestTarget({provider,vault,policy:validated});
 return validated;
}
