import {test} from 'node:test';import assert from 'node:assert/strict';
import {positionPolicyTransition,validatePositionDeploymentBinding} from '../scripts/install-position-policy.mjs';
import {hourlyTestPolicyFields} from '../scripts/daily-profit.mjs';
const a='0x'+'12'.repeat(20),b='0x'+'34'.repeat(20),h='0x'+'ab'.repeat(32);
const policy={version:1,chainId:97,vaultAddress:a,runtimeHash:h,deploymentBlock:1,startTimestamp:1,basis:'period-start-active-principal',periodSeconds:3600,includeReinvestment:true,...hourlyTestPolicyFields};
const deployment={chainId:97,verified:true,emptyAtDeployment:true,contractAddress:a,runtimeHash:h};
test('a fresh verified address requires explicit selection and cannot adopt another generation or mainnet report',()=>{
 assert.throws(()=>positionPolicyTransition({policy,state:{}}),/EXPECTED_FAST_TARGET/);
 assert.equal(positionPolicyTransition({policy,state:{},expectedTarget:a}).basis,'position-anniversary-principal');
 assert.doesNotThrow(()=>validatePositionDeploymentBinding({deployment,policy,selected:a}));
 for(const patch of [{chainId:56},{verified:false},{emptyAtDeployment:false},{contractAddress:b},{runtimeHash:'0x'+'cd'.repeat(32)}])assert.throws(()=>validatePositionDeploymentBinding({deployment:{...deployment,...patch},policy,selected:a}),/DEPLOYMENT_BINDING/);
 assert.throws(()=>validatePositionDeploymentBinding({deployment,policy:{...policy,vaultAddress:b},selected:a}),/DEPLOYMENT_BINDING/);
});
test('selecting a new address cannot erase old credits, pending signatures or the existing position index',()=>{
 for(const state of [{pending:{raw:'saved'}},{transactions:{old:{raw:'saved'}}},{daily:{lastCredit:{credited:[{id:h}]}}},{daily:{positionIndex:{through:1}}}])assert.throws(()=>positionPolicyTransition({policy,state,expectedTarget:a}),/REVIEW/);
 const installed={...policy,basis:'position-anniversary-principal',positionScheduleVersion:1};assert.deepEqual(positionPolicyTransition({policy:installed,state:{daily:{positionPaid:{a:10}}},expectedTarget:a}),installed);
});
