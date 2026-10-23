import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,getCreateAddress,keccak256,parseEther} from 'ethers';
import {parseActivationStatus,activationStatusView} from '../deployment-console/zero-start-activation.js';

const owner='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const operator='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
const token='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const artifactHash='0x008e37042763d39b139ead6cd867ef48a221a2eec1c8e8702a844fa5f269b11e';
const oldArtifactHash='0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf';
const target='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const now=1792713600;
const hash=digit=>'0x'+digit.repeat(64);
const iface=new Interface(['function setReporter(address,bool)']);
const calldata=iface.encodeFunctionData('setReporter',[operator,true]);
const api={version:1,chainId:97,vaultAddress:target};
const asset=(address,principal,rewards,cash)=>{
 const estimate=(principal*200n+9999n)/10000n,minimum=estimate>0n?estimate:1n;
 return {asset:address,symbol:address===ZeroAddress?'BNB':'USDT',decimals:18,principal:String(principal),rewards:String(rewards),cash:String(cash),estimatedDailyRequirement:String(estimate),minimumBudgetRequired:String(minimum),requiredForExistingPrincipal:principal>0n,backed:rewards>0n&&cash>=rewards,ready:rewards>=minimum&&cash>=minimum};
};
function fixture(){
 return {
  version:1,kind:'fresh-zero-daily-readiness',releaseId:'global-fresh-fast-test-v1',chainId:97,siteConnected:true,
  testMode:true,initialServerReporter:true,fastTestnetVersion:1,
  target,contractAddress:target,owner,operator,token,tokenDecimals:18,artifactHash,
  queue:getCreateAddress({from:target,nonce:1}),hash:hash('1'),runtimeHash:hash('2'),block:100,
  ready:true,paused:false,reporterAuthorized:true,blockers:[],approvalVersion:1,automaticGroupVersion:1,
  checkpoint:{timestamp:now,block:200,blockHash:hash('3')},
  reporterProposal:{calldata,hash:keccak256(calldata),eta:0,round:0,votes:0,requiredVotes:2,currentQuorum:2,delaySeconds:172800,queued:false},
  funding:{ready:true,maxDailyBps:200,assets:[asset(ZeroAddress,0n,0n,0n),asset(token,parseEther('1000'),parseEther('100'),parseEther('20'))]},
  operatorGas:{balance:'1000000000000000',positive:true},archive:{status:'provisional',fullyVerified:false,provisionalAccepted:true},automationStatus:'not-inspected'
 };
}
function scheduled(){
 const report=fixture(),start=now-100;
 report.dailyAutomationActive=true;report.timerActive=true;report.automationStatus='scheduled';
 report.automation={version:1,kind:'fresh-zero-server-automation',chainId:97,target,status:'scheduled',dailyCredits:[],policy:{version:1,chainId:97,vaultAddress:target,runtimeHash:report.runtimeHash,deploymentBlock:report.block,startTimestamp:start,periodSeconds:86400},firstPeriodEndsAt:start+86400,nextEpoch:0};
 return report;
}
const parsed=value=>parseActivationStatus(value,api);

test('pinned fast release accepts initial test checkpoint without claiming full retention',()=>{
 const report=parsed(fixture()),view=activationStatusView(report,now);
 assert.equal(report.releaseId,'global-fresh-fast-test-v1');assert.equal(report.artifactHash,artifactHash);
 assert.equal(view.active,false);assert.match(view.proposal,/Testnet initial server permission.*deployment/);
 const history=view.checks.find(row=>row.label==='Historical account reads');
 assert.equal(history.value,'Initial test checkpoint verified; 24-hour retention pending');assert.equal(history.ok,false);
 assert.equal(view.checks.find(row=>row.label==='Testnet initial server permission').value,'Authorized');
 const complete=fixture();complete.archive={status:'supported',fullyVerified:true};
 assert.equal(activationStatusView(parsed(complete),now).checks.find(row=>row.label==='Historical account reads').value,'Verified');
});

test('fast permission markers cannot select an unknown or standard artifact release',()=>{
 for(const change of [{releaseId:'global-fresh-fast-test-v2'},{releaseId:'__proto__'},{releaseId:'toString'},{artifactHash:oldArtifactHash},{artifactHash:hash('4')},{releaseId:'global-fresh-zero-v1',artifactHash:oldArtifactHash}])assert.throws(()=>parsed({...fixture(),...change}));
 for(const key of ['testMode','initialServerReporter','fastTestnetVersion']){
  for(const value of [undefined,false,0,'1',2]){const report=fixture();report[key]=value;assert.throws(()=>parsed(report),/markers/);}
 }
 for(const change of [{chainId:56},{owner:other},{operator:other},{token:other},{contractAddress:other},{queue:other}])assert.throws(()=>parsed({...fixture(),...change}));
 assert.throws(()=>parseActivationStatus(fixture(),{...api,vaultAddress:other}),/different contracts/);
 const identity=parsed(fixture()).identity;
 assert.throws(()=>parseActivationStatus({...fixture(),runtimeHash:hash('4')},api,identity),/changed/);
});

test('standard archive gate remains strict even with forged fast-mode fields',()=>{
 const report=fixture();report.releaseId='global-fresh-zero-v1';report.artifactHash=oldArtifactHash;
 for(const key of ['testMode','initialServerReporter','fastTestnetVersion'])delete report[key];
 delete report.archive.provisionalAccepted;
 assert.throws(()=>parsed(report),/readiness result/);
 report.ready=false;report.blockers=['ARCHIVE_RETENTION_NOT_YET_VERIFIABLE'];
 assert.equal(activationStatusView(parsed(report),now).checks.find(row=>row.label==='Historical account reads').value,'Waiting for a full daily period');
 for(const change of [{testMode:true},{initialServerReporter:true},{fastTestnetVersion:1},{archive:{status:'provisional',fullyVerified:false,provisionalAccepted:true}}])assert.throws(()=>parsed({...report,...change}),/standard release/);
});

test('only explicit provisional acceptance can satisfy the fast archive gate',()=>{
 for(const archive of [{status:'provisional'},{status:'provisional',fullyVerified:false},{status:'provisional',fullyVerified:true,provisionalAccepted:true},{status:'unavailable',fullyVerified:false,provisionalAccepted:true},{status:'supported',fullyVerified:true,provisionalAccepted:true}])assert.throws(()=>parsed({...fixture(),archive}));
 const waiting=fixture();waiting.ready=false;waiting.archive={status:'provisional',fullyVerified:false};waiting.blockers=['ARCHIVE_RETENTION_NOT_YET_VERIFIABLE'];
 assert.equal(activationStatusView(parsed(waiting),now).active,false);
 for(const change of [{paused:true},{reporterAuthorized:false},{blockers:['SERVER_PERMISSION_REQUIRED']},{operatorGas:{balance:'0',positive:false}}])assert.throws(()=>parsed({...fixture(),...change}),/readiness result/);
 const unfunded=fixture();unfunded.funding.assets=[asset(ZeroAddress,0n,0n,0n),asset(token,0n,0n,0n)];unfunded.funding.ready=false;
 assert.throws(()=>parsed(unfunded),/readiness result/);
});

test('fast activation needs a running timer, established policy and unchanged daily period',()=>{
 const report=scheduled(),view=activationStatusView(parsed(report),now);
 assert.equal(view.active,true);assert.match(view.schedule,/Next daily period: 1/);
 assert.equal(report.automation.policy.periodSeconds,86400);assert.equal(report.automation.firstPeriodEndsAt-report.automation.policy.startTimestamp,86400);
 assert.match(view.creditSummary,/No new daily credit batches/);
 for(const timerActive of [undefined,false,'true'])assert.throws(()=>parsed({...scheduled(),timerActive}),/timer status/);
 const noTimer=scheduled();noTimer.timerActive=false;noTimer.dailyAutomationActive=false;
 assert.equal(activationStatusView(parsed(noTimer),now).active,false);
 const noPolicy=scheduled();delete noPolicy.automation.policy;delete noPolicy.automation.firstPeriodEndsAt;delete noPolicy.automation.nextEpoch;
 assert.equal(activationStatusView(parsed(noPolicy),now).active,false);
 for(const seconds of [60,3600,172800]){const wrong=scheduled();wrong.automation.policy.periodSeconds=seconds;assert.throws(()=>parsed(wrong),/daily period/);}
 for(const checkedAt of [now+901,now-121])assert.equal(activationStatusView(parsed(report),checkedAt).active,false);
 const credited=scheduled();credited.automation.dailyCredits=[{id:hash('5'),status:'credited'}];assert.throws(()=>parsed(credited),/credit evidence/);
});
