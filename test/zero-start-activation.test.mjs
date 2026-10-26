import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,getCreateAddress,keccak256,parseEther} from 'ethers';
import {parseActivationStatus,activationStatusView} from '../deployment-console/zero-start-activation.js';

const owner='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const operator='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
const token='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const artifactHash='0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf';
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
  version:1,kind:'fresh-zero-daily-readiness',releaseId:'global-fresh-zero-v1',chainId:97,siteConnected:true,
  target,contractAddress:target,owner,operator,token,tokenDecimals:18,artifactHash,
  queue:getCreateAddress({from:target,nonce:1}),hash:hash('1'),runtimeHash:hash('2'),block:100,
  ready:true,paused:false,reporterAuthorized:true,blockers:[],approvalVersion:1,automaticGroupVersion:1,
  checkpoint:{timestamp:now,block:200,blockHash:hash('3')},
  reporterProposal:{calldata,hash:keccak256(calldata),eta:0,round:0,votes:0,requiredVotes:2,currentQuorum:2,delaySeconds:172800,queued:false},
  funding:{ready:true,maxDailyBps:200,assets:[asset(ZeroAddress,0n,0n,0n),asset(token,parseEther('1000'),parseEther('100'),parseEther('20'))]},
  operatorGas:{balance:'1000000000000000',positive:true},archive:{status:'supported'},automationStatus:'not-inspected'
 };
}
function combinedFixture(){
 const report=fixture();
 report.funding.estimateVersion=2;report.funding.maxReferralBps=3400;
 report.funding.assets=report.funding.assets.map(entry=>{
  const personal=BigInt(entry.estimatedDailyRequirement),referrals=(personal*3400n+9999n)/10000n,total=personal+referrals,minimum=total>0n?total:1n,cash=entry.requiredForExistingPrincipal?parseEther('100'):BigInt(entry.cash),rewards=BigInt(entry.rewards);
  return {...entry,estimatedReferralRequirement:String(referrals),estimatedTotalDailyRequirement:String(total),minimumBudgetRequired:String(minimum),cash:cash.toString(),backed:rewards>0n&&cash>=rewards,ready:rewards>=minimum&&cash>=minimum};
 });
 return report;
}
function scheduled(){
 const report=fixture(),start=now-100;
 report.dailyAutomationActive=true;report.automationStatus='scheduled';
 report.automation={version:1,kind:'fresh-zero-server-automation',chainId:97,target,status:'scheduled',dailyCredits:[],policy:{version:1,chainId:97,vaultAddress:target,runtimeHash:report.runtimeHash,deploymentBlock:report.block,startTimestamp:start,periodSeconds:86400},firstPeriodEndsAt:start+86400,nextEpoch:0};
 return report;
}
const parsed=value=>parseActivationStatus(value,api);

test('status imports without a DOM and binds the release and locally encoded reporter proposal',()=>{
 const report=parsed(fixture());
 assert.deepEqual(report.identity,{target,queue:getCreateAddress({from:target,nonce:1}),hash:hash('1'),runtimeHash:hash('2'),block:100});
 assert.equal(report.owner,owner);assert.equal(report.operator,operator);assert.equal(report.token,token);assert.equal(report.artifactHash,artifactHash);
 assert.equal(report.reporterProposal.calldata,iface.encodeFunctionData('setReporter',[operator,true]));
 for(const changed of [iface.encodeFunctionData('setReporter',[owner,true]),iface.encodeFunctionData('setReporter',[operator,false])]){
  const value=fixture();value.reporterProposal={...value.reporterProposal,calldata:changed,hash:keccak256(changed)};
  assert.throws(()=>parsed(value),/reporter permission status/);
 }
 const value=fixture();value.reporterProposal.hash=hash('4');assert.throws(()=>parsed(value),/reporter permission status/);
});

test('rejects changed release wallets, artifact, API target and a previously established identity',()=>{
 for(const change of [{owner:other},{operator:other},{token:other},{artifactHash:hash('4')},{tokenDecimals:6},{contractAddress:other},{queue:other},{chainId:56}])assert.throws(()=>parsed({...fixture(),...change}));
 for(const config of [{...api,chainId:56},{...api,vaultAddress:other},{...api,version:2}])assert.throws(()=>parseActivationStatus(fixture(),config),/different contracts/);
 const moved={...fixture(),target:other,contractAddress:other,queue:getCreateAddress({from:other,nonce:1})};
 assert.throws(()=>parseActivationStatus(moved,api),/different contracts/);
 const identity=parsed(fixture()).identity;
 for(const change of [{hash:hash('4')},{runtimeHash:hash('4')},{block:101}])assert.throws(()=>parseActivationStatus({...fixture(),...change},api,identity),/changed/);
});

test('rejects unknown archive and scheduling states and inconsistent ready assertions',()=>{
 for(const status of ['ready','unknown',null]){
  assert.throws(()=>parsed({...fixture(),archive:{status}}),/service requirements/);
  assert.throws(()=>parsed({...fixture(),automationStatus:status}),/scheduling status/);
 }
 for(const change of [{paused:true},{reporterAuthorized:false},{blockers:['COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED']},{archive:{status:'provisional'}},{operatorGas:{balance:'0',positive:false}}])assert.throws(()=>parsed({...fixture(),...change}),/readiness result/);
 const waiting={...fixture(),ready:false,archive:{status:'provisional'},blockers:['ARCHIVE_RETENTION_NOT_YET_VERIFIABLE']};
 assert.equal(activationStatusView(parsed(waiting),now).checks.find(row=>row.label==='Historical account reads').value,'Waiting for a full daily period');
});

test('contract readiness never implies active scheduling and missing permission has a clear status',()=>{
 for(const flags of [{},{dailyAutomationActive:true},{dailyAutomationActive:false,automationStatus:'scheduled'}]){
  const view=activationStatusView(parsed({...fixture(),...flags}),now);
  assert.equal(view.active,false);assert.equal(view.title,'Ready for server activation');assert.match(view.summary,/scheduling has not been verified/);
 }
 const waiting={...fixture(),ready:false,reporterAuthorized:false,blockers:['COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED','REPORTER_PROPOSAL_REQUIRED'],automationStatus:'waiting'};
 const view=activationStatusView(parsed(waiting),now);
 assert.equal(view.active,false);assert.match(view.summary,/operator is not authorized/);assert.equal(view.proposal,'Reporter authorization has not been proposed.');assert.match(view.schedule,/start time has not been established/);
 const queued={...waiting,reporterProposal:{...waiting.reporterProposal,eta:now+1000,queued:true,votes:1,requiredVotes:2,currentQuorum:3}};
 assert.match(activationStatusView(parsed(queued),now).proposal,/1 of 2 votes/);
});

test('a scheduled first period is distinct from actual daily credit evidence',()=>{
 const report=scheduled(),view=activationStatusView(parsed(report),now);
 assert.equal(view.active,true);assert.equal(view.title,'Daily plan is active');assert.match(view.schedule,/Next daily period: 1/);
 assert.match(view.creditSummary,/No new daily credit batches/);assert.doesNotMatch(view.creditSummary,/paid/i);
 report.automation.nextEpoch=2;report.automation.dailyCredits=[{id:hash('5'),status:'already_credited'}];
 assert.match(activationStatusView(parsed(report),now).schedule,/Next daily period: 3/);
 assert.match(activationStatusView(parsed(report),now).creditSummary,/No new daily credit batches/);
 report.automation.dailyCredits.push({id:hash('6'),status:'credited',transactionHash:hash('7')});
 assert.equal(activationStatusView(parsed(report),now).creditSummary,'1 daily credit batch was confirmed in the latest server check.');
 report.ready=false;report.blockers=['SERVER_CHECK_WAITING'];assert.equal(activationStatusView(parsed(report),now).active,false);
});

test('stale or implausibly future checkpoints turn an active claim into unverified status',()=>{
 const report=parsed(scheduled());
 for(const checkedAt of [now+901,now-121]){
  const view=activationStatusView(report,checkedAt);
  assert.equal(view.active,false);assert.equal(view.stale,true);assert.equal(view.title,'Status needs a fresh check');assert.match(view.summary,/activity is unverified/);
  assert.equal(view.checks.find(row=>row.label==='Daily credits').value,'Unverified');
 }
 assert.equal(activationStatusView(report,now+900).active,true);
});

test('one-period funding may be ready without backing all rewards and zero-principal assets are not both required',()=>{
 const report=parsed(fixture()),funding=activationStatusView(report,now).funding;
 assert.equal(report.funding.assets[1].backed,false);assert.equal(report.funding.assets[1].ready,true);assert.equal(funding[1].minimum,'20.0');assert.equal(funding[0].required,false);
 const empty=fixture();empty.funding.assets=[asset(ZeroAddress,0n,0n,0n),asset(token,0n,1n,1n)];
 const emptyView=activationStatusView(parsed(empty),now);
 assert.equal(empty.funding.ready,true);assert.ok(emptyView.funding.every(row=>row.required===false));assert.equal(emptyView.funding[0].ready,false);assert.equal(emptyView.funding[1].ready,true);
 const unfunded=structuredClone(empty);unfunded.funding.assets[1]=asset(token,0n,0n,0n);unfunded.funding.ready=false;unfunded.ready=false;unfunded.blockers=['FUNDED_DAILY_REWARD_BUDGET_REQUIRED'];
 assert.equal(activationStatusView(parsed(unfunded),now).checks.find(row=>row.label==='Reward funding').ok,false);
 for(const change of [{ready:false},{backed:true},{minimumBudgetRequired:'1'},{requiredForExistingPrincipal:false}]){
  const wrong=fixture();Object.assign(wrong.funding.assets[1],change);assert.throws(()=>parsed(wrong),/funding estimate/);
 }
});

test('version 2 funding requires the combined personal-profit and referral bound in both cash and reward budget',()=>{
 const full=combinedFixture(),report=parsed(full),view=activationStatusView(report,now);
 assert.equal(report.funding.assets[1].estimatedDailyRequirement,parseEther('20').toString());
 assert.equal(report.funding.assets[1].estimatedReferralRequirement,parseEther('6.8').toString());
 assert.equal(report.funding.assets[1].estimatedTotalDailyRequirement,parseEther('26.8').toString());
 assert.equal(view.funding[1].minimum,'26.8');assert.equal(view.funding[1].ready,true);
 assert.match(view.checks.find(row=>row.label==='Reward funding').value,/personal-profit and referral estimate/);
 for(const field of ['cash','rewards']){
  const personalOnly=combinedFixture();personalOnly.funding.assets[1][field]=parseEther('20').toString();personalOnly.funding.assets[1].ready=false;
  personalOnly.funding.assets[1].backed=BigInt(personalOnly.funding.assets[1].cash)>=BigInt(personalOnly.funding.assets[1].rewards);
  personalOnly.funding.ready=false;personalOnly.ready=false;personalOnly.blockers=['FUNDED_DAILY_REWARD_BUDGET_REQUIRED'];
  const waiting=activationStatusView(parsed(personalOnly),now);
  assert.equal(waiting.funding[1].minimum,'26.8');assert.equal(waiting.funding[1].ready,false);assert.equal(waiting.checks.find(row=>row.label==='Reward funding').ok,false);
  personalOnly.funding.assets[1].ready=true;assert.throws(()=>parsed(personalOnly),/funding estimate/);
 }
 const legacy=fixture();legacy.funding.estimateVersion=1;
 assert.equal(activationStatusView(parsed(legacy),now).funding[1].minimum,'20.0');
 assert.match(activationStatusView(parsed(legacy),now).checks.find(row=>row.label==='Reward funding').value,/legacy personal-profit estimate/);
});

test('version 2 rounds each referral bound upward and retains the positive empty-pool minimum',()=>{
 const report=combinedFixture();report.funding.maxReferralBps=1;
 report.funding.assets=[
  {...asset(ZeroAddress,0n,0n,0n),estimatedReferralRequirement:'0',estimatedTotalDailyRequirement:'0'},
  {...asset(token,1n,2n,2n),estimatedReferralRequirement:'1',estimatedTotalDailyRequirement:'2',minimumBudgetRequired:'2'}
 ];
 const assets=parsed(report).funding.assets;
 assert.equal(assets[0].minimumBudgetRequired,'1');assert.equal(assets[0].ready,false);
 assert.equal(assets[1].estimatedDailyRequirement,'1');assert.equal(assets[1].estimatedReferralRequirement,'1');assert.equal(assets[1].minimumBudgetRequired,'2');assert.equal(assets[1].ready,true);
});

test('version 2 rejects unknown versions, missing referral fields and inconsistent combined estimates',()=>{
 const mutations=[
  value=>{value.funding.estimateVersion=3;},value=>{value.funding.estimateVersion='2';},value=>{value.funding.estimateVersion=null;},
  value=>{delete value.funding.maxReferralBps;},value=>{value.funding.maxReferralBps=3401;},value=>{value.funding.maxReferralBps=-1;},value=>{value.funding.maxReferralBps=1.5;},value=>{value.funding.maxReferralBps='3400';},
  value=>{delete value.funding.assets[1].estimatedReferralRequirement;},value=>{delete value.funding.assets[1].estimatedTotalDailyRequirement;},
  value=>{value.funding.assets[1].estimatedReferralRequirement='-1';},value=>{value.funding.assets[1].estimatedReferralRequirement='6.8';},
  value=>{value.funding.assets[1].estimatedReferralRequirement='0';},value=>{value.funding.assets[1].estimatedTotalDailyRequirement=parseEther('20').toString();},
  value=>{value.funding.assets[1].minimumBudgetRequired=parseEther('20').toString();},value=>{value.funding.ready=false;}
 ];
 for(const mutate of mutations){const value=combinedFixture();mutate(value);assert.throws(()=>parsed(value),/funding|budget|service requirements/);}
});

test('scheduling and credit evidence must match the established fresh identity and period',()=>{
 const mutations=[
  report=>{report.automation.target=other;},report=>{report.automation.chainId=56;},report=>{report.automation.status='waiting';},
  report=>{report.automation.policy.vaultAddress=other;},report=>{report.automation.policy.runtimeHash=hash('4');},report=>{report.automation.policy.deploymentBlock++;},
  report=>{report.automation.policy.periodSeconds=3600;},report=>{report.automation.firstPeriodEndsAt++;},report=>{report.automation.nextEpoch=-1;},
  report=>{delete report.automation.policy;},report=>{report.automation.dailyCredits=[{id:hash('5'),status:'credited'}];},
  report=>{report.automation.dailyCredits=[{id:hash('5'),status:'paid',transactionHash:hash('6')}];}
 ];
 for(const mutate of mutations){const report=scheduled();mutate(report);assert.throws(()=>parsed(report));}
 const waiting=fixture();waiting.automationStatus='waiting';waiting.automation={version:1,kind:'fresh-zero-server-automation',chainId:97,target,status:'waiting',dailyCredits:[]};
 assert.match(activationStatusView(parsed(waiting),now).schedule,/start time has not been established/);
});
