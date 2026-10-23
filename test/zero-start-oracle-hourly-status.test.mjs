import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,getCreateAddress,keccak256,parseEther} from 'ethers';
import {parseActivationStatus,activationStatusView} from '../deployment-console/zero-start-activation.js';

const owner='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const operator='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
const token='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const target='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const feeds=['0xDA264c16Ec8832748a1A5A31b963deD9E48e337a','0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454'];
const now=1792713600,hash=digit=>'0x'+digit.repeat(64);
const calldata=new Interface(['function setReporter(address,bool)']).encodeFunctionData('setReporter',[operator,true]);
const api={version:1,chainId:97,vaultAddress:target};
const asset=(address,principal,rewards,cash)=>{
 const estimate=(principal*200n+9999n)/10000n,minimum=estimate>0n?estimate:1n;
 return {asset:address,decimals:18,principal:String(principal),rewards:String(rewards),cash:String(cash),estimatedDailyRequirement:String(estimate),minimumBudgetRequired:String(minimum),requiredForExistingPrincipal:principal>0n,backed:rewards>0n&&cash>=rewards,ready:rewards>=minimum&&cash>=minimum};
};
function fixture(){
 const start=now-100;
 return {
  version:1,kind:'fresh-zero-daily-readiness',releaseId:'global-fresh-fast-test-v1',chainId:97,siteConnected:true,
  testMode:true,initialServerReporter:true,fastTestnetVersion:1,target,contractAddress:target,owner,operator,token,tokenDecimals:18,
  artifactHash:'0x008e37042763d39b139ead6cd867ef48a221a2eec1c8e8702a844fa5f269b11e',
  queue:getCreateAddress({from:target,nonce:1}),hash:hash('1'),runtimeHash:hash('2'),block:100,
  ready:true,paused:false,reporterAuthorized:true,blockers:[],approvalVersion:1,automaticGroupVersion:1,
  checkpoint:{timestamp:now,block:200,blockHash:hash('3')},
  reporterProposal:{calldata,hash:keccak256(calldata),eta:0,round:0,votes:0,requiredVotes:2,currentQuorum:2,delaySeconds:172800,queued:false},
  funding:{ready:true,maxDailyBps:200,assets:[asset(ZeroAddress,0n,0n,0n),asset(token,parseEther('1000'),parseEther('100'),parseEther('100'))]},
  operatorGas:{balance:'1000000000000000',positive:true},archive:{status:'provisional',fullyVerified:false,provisionalAccepted:true},
  dailyAutomationActive:true,timerActive:true,automationStatus:'scheduled',
  automation:{version:1,kind:'fresh-zero-server-automation',chainId:97,target,status:'scheduled',errors:[],dailyCredits:[],
   policy:{version:1,chainId:97,vaultAddress:target,runtimeHash:hash('2'),deploymentBlock:100,startTimestamp:start,periodSeconds:3600,
    basis:'period-start-active-principal',includeReinvestment:true,testMode:true,releaseId:'global-fresh-fast-test-v1',testInterval:'hourly',fastTestnetVersion:1},
   firstPeriodEndsAt:start+3600,nextEpoch:0}
 };
}
function maintenance(){
 return {status:'TESTNET_ORACLES_VALID',chainId:97,vault:target,maxOracleAge:'86400',
  observedFeeds:feeds.map(address=>({address,answer:'100000000',updatedAt:String(now-90000),ageSeconds:'90000'})),
  transactions:[hash('4'),hash('5')],checkedAt:new Date(now*1000).toISOString()};
}
function inspection(){
 return {version:1,chainId:97,target,status:'TESTNET_ORACLES_VALID',ready:true,block:201,blockHash:hash('8'),timestamp:now,maxOracleAge:'86400',transactionsSent:0,
  feeds:feeds.map(address=>({address,round:'2',answer:'100000000',updatedAt:String(now),answeredInRound:'2',ageSeconds:'0',ready:true}))};
}
const parsed=value=>parseActivationStatus(value,api);

test('hourly test status uses the exact fast release and one-hour schedule with full daily plan wording',()=>{
 const report=fixture(),view=activationStatusView(parsed(report),now);
 assert.equal(view.active,true);assert.equal(view.title,'Hourly test cycle is active');
 assert.match(view.summary,/daily plan percentage.*one-hour test cycle.*BNB Testnet/);
 assert.match(view.schedule,/Next hourly test cycle: 1/);
 assert.ok(view.schedule.includes(new Date((report.automation.policy.startTimestamp+3600)*1000).toLocaleString('en-US')));
 assert.equal(view.checks.find(row=>row.label==='Hourly test cycle').value,'Active');
 report.automation.nextEpoch=2;
 const next=activationStatusView(parsed(report),now);
 assert.match(next.schedule,/Next hourly test cycle: 3/);
 assert.ok(next.schedule.includes(new Date((report.automation.policy.startTimestamp+3*3600)*1000).toLocaleString('en-US')));
 assert.ok(!next.schedule.includes(new Date((report.automation.policy.startTimestamp+3*86400)*1000).toLocaleString('en-US')));
 report.automation.dailyCredits=[{id:hash('6'),status:'credited',transactionHash:hash('7')}];
 assert.equal(activationStatusView(parsed(report),now).creditSummary,'1 hourly test credit batch was confirmed in the latest server check.');
});

test('a one-hour period needs all explicit policy markers and exact first-period evidence',()=>{
 for(const key of ['testMode','releaseId','testInterval','fastTestnetVersion','basis','includeReinvestment']){
  const report=fixture();delete report.automation.policy[key];assert.throws(()=>parsed(report),/daily period/);
 }
 for(const change of [{testMode:false},{releaseId:'global-fresh-zero-v1'},{testInterval:'daily'},{fastTestnetVersion:2},{basis:'current-principal'},{includeReinvestment:false}]){
  const report=fixture();Object.assign(report.automation.policy,change);assert.throws(()=>parsed(report),/daily period/);
 }
 for(const seconds of [60,3599,3601,86400,172800]){
  const report=fixture();report.automation.policy.periodSeconds=seconds;assert.throws(()=>parsed(report),/daily period/);
 }
 for(const mutate of [r=>{r.automation.firstPeriodEndsAt+=86400;},r=>{r.automation.nextEpoch=-1;},r=>{r.automation.nextEpoch=Number.MAX_SAFE_INTEGER;}]){
  const report=fixture();mutate(report);assert.throws(()=>parsed(report),/daily period/);
 }
});

test('one-hour historical retention is limited to the explicit fast test selection or its valid hourly policy',()=>{
 const selected=fixture();selected.testInterval='hourly';selected.allocationPeriodSeconds=3600;
 selected.archive.requiredRetentionSeconds=3600;
 const initial=activationStatusView(parsed(selected),now).checks.find(row=>row.label==='Historical account reads');
 assert.equal(initial.value,'Initial test checkpoint verified; 1-hour retention pending');assert.equal(initial.ok,false);
 selected.archive={status:'supported',requiredRetentionSeconds:3600,fullyVerified:true};
 assert.equal(activationStatusView(parsed(selected),now).checks.find(row=>row.label==='Historical account reads').value,'1-hour test retention verified');
 const policyOnly=fixture();policyOnly.archive.requiredRetentionSeconds=3600;
 assert.doesNotThrow(()=>parsed(policyOnly));
 const oldRetention=fixture();oldRetention.archive.requiredRetentionSeconds=86400;
 assert.equal(activationStatusView(parsed(oldRetention),now).checks.find(row=>row.label==='Historical account reads').value,'Initial test checkpoint verified; 24-hour retention pending');
 const beforePolicy=structuredClone(selected);delete beforePolicy.automation;
 beforePolicy.ready=false;beforePolicy.dailyAutomationActive=false;beforePolicy.automationStatus='not-inspected';beforePolicy.blockers=['FUNDED_DAILY_REWARD_BUDGET_REQUIRED'];
 const view=activationStatusView(parsed(beforePolicy),now);
 assert.equal(view.title,'Hourly test cycle is waiting');assert.equal(view.active,false);
 for(const change of [{testInterval:undefined},{allocationPeriodSeconds:undefined},{allocationPeriodSeconds:86400},{testInterval:'daily'}])assert.throws(()=>parsed({...selected,...change}),/hourly test selection/);
 const mismatch=structuredClone(selected);mismatch.automation.policy.periodSeconds=86400;delete mismatch.automation.policy.testInterval;mismatch.automation.firstPeriodEndsAt=mismatch.automation.policy.startTimestamp+86400;
 assert.throws(()=>parsed(mismatch),/daily period/);
 const unselected=fixture();delete unselected.automation;unselected.automationStatus='not-inspected';unselected.dailyAutomationActive=false;unselected.archive.requiredRetentionSeconds=3600;
 assert.throws(()=>parsed(unselected),/retention period/);
 for(const seconds of [60,3599,3601,172800])assert.throws(()=>parsed({...selected,archive:{...selected.archive,requiredRetentionSeconds:seconds}}),/retention period/);
});

test('ordinary release cannot acquire hourly test scheduling by attaching forged test fields',()=>{
 const report=fixture();report.releaseId='global-fresh-zero-v1';
 report.artifactHash='0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf';
 for(const key of ['testMode','initialServerReporter','fastTestnetVersion'])delete report[key];
 report.archive={status:'supported',fullyVerified:true};
 assert.throws(()=>parsed(report),/daily period/);
 report.testInterval='hourly';report.allocationPeriodSeconds=3600;report.archive.requiredRetentionSeconds=3600;
 assert.throws(()=>parsed(report),/hourly test selection/);
 delete report.testInterval;delete report.allocationPeriodSeconds;
 assert.throws(()=>parsed(report),/retention period/);
 report.archive.requiredRetentionSeconds=86400;
 report.automation.policy.periodSeconds=86400;report.automation.firstPeriodEndsAt=report.automation.policy.startTimestamp+86400;
 assert.throws(()=>parsed(report),/daily period/);
 for(const key of ['testMode','releaseId','testInterval','fastTestnetVersion'])delete report.automation.policy[key];
 const normal=activationStatusView(parsed(report),now);
 assert.equal(normal.active,true);assert.equal(normal.title,'Daily plan is active');assert.match(normal.schedule,/Next daily period: 1/);
});

test('successful maintenance is visible without treating old pre-refresh observations as current stale quotes',()=>{
 const report=fixture();report.automation.oracles=maintenance();
 const parsedReport=parsed(report),view=activationStatusView(parsedReport,now),row=view.checks.find(row=>row.label==='Oracle prices');
 assert.equal(parsedReport.oracleStatus.verified,true);assert.equal(row.value,'Both contract quotes verified');assert.equal(row.ok,true);assert.equal(view.active,true);
 const unknown=activationStatusView(parsed(fixture()),now).checks.find(row=>row.label==='Oracle prices');
 assert.equal(unknown.value,'Not inspected');assert.equal(unknown.ok,false);
});

test('known oracle failures and failed current inspections suppress every active claim',()=>{
 for(const error of ['ORACLE_INVALID_ROUND','ORACLE_REFRESH_NOT_CONFIRMED','TESTNET_GAS_COST_LIMIT','TOTAL_TEST_BNB_FEE_LIMIT_0_1','AUTOMATION_RPC_OR_EXECUTION_FAILED']){
  const report=fixture();report.automation.errors=[error];
  const view=activationStatusView(parsed(report),now);
  assert.equal(view.active,false);assert.equal(view.title,'Oracle prices need attention');
  assert.match(view.summary,/Valid contract quotes.*investing/);
  assert.ok(view.checks.find(row=>row.label==='Oracle prices').value.includes(error));
  assert.equal(view.checks.find(row=>row.label==='Hourly test cycle').ok,false);
 }
 const report=fixture();report.automation.oracles=maintenance();report.oracleInspection=inspection();
 report.oracleInspection.ready=false;report.oracleInspection.status='ORACLE_REFRESH_REQUIRED';
 report.oracleInspection.feeds[0]={...report.oracleInspection.feeds[0],updatedAt:String(now-90000),ageSeconds:'90000',ready:false};
 const view=activationStatusView(parsed(report),now);
 assert.equal(view.active,false);assert.equal(view.checks.find(row=>row.label==='Oracle prices').ok,false);
 const otherError=fixture();otherError.automation.errors=['DAILY_PROFIT_FUNDING_REQUIRED'];
 assert.equal(activationStatusView(parsed(otherError),now).active,false);
 const staleOracle=fixture();staleOracle.oracleInspection=inspection();staleOracle.oracleInspection.timestamp=now-901;
 for(const feed of staleOracle.oracleInspection.feeds)feed.updatedAt=String(now-901);
 const staleView=activationStatusView(parsed(staleOracle),now);
 assert.equal(staleView.stale,false);assert.equal(staleView.active,false);
 assert.equal(staleView.title,'Oracle prices need a fresh check');
 assert.equal(staleView.checks.find(row=>row.label==='Oracle prices').ok,false);
});

test('oracle reports reject unrelated targets, chains, feeds and malformed price evidence',()=>{
 const mutations=[
  r=>{r.vault=other;},r=>{r.chainId=56;},r=>{r.maxOracleAge='172800';},r=>{r.status='UNKNOWN';},r=>{r.transactions=[other];},
  r=>{r.observedFeeds[0].address=other;},r=>{r.observedFeeds.reverse();},r=>{r.observedFeeds[0].answer='0';},r=>{r.observedFeeds[0].ageSeconds='-1';}
 ];
 for(const mutate of mutations){const report=fixture();report.automation.oracles=maintenance();mutate(report.automation.oracles);assert.throws(()=>parsed(report),/oracle/);}
 for(const change of [{chainId:56},{target:other},{ready:'true'},{ready:false},{timestamp:now+1}]){
  const report=fixture();report.oracleInspection={...inspection(),...change};assert.throws(()=>parsed(report),/oracle inspection/);
 }
 const contradictory=fixture();contradictory.oracleInspection=inspection();contradictory.oracleInspection.feeds[0].answer='0';
 assert.throws(()=>parsed(contradictory),/inspection is inconsistent/);
});

test('an oracle-only repair remains visibly distinct from active profit allocation',()=>{
 const report=fixture();delete report.automation;
 report.ready=false;report.dailyAutomationActive=false;report.automationStatus='not-inspected';
 report.blockers=['DAILY_AUTOMATION_NOT_INSPECTED_BY_ORACLE_REPAIR'];report.oracleMaintenance=maintenance();report.oracleInspection=inspection();
 const view=activationStatusView(parsed(report),now);
 assert.equal(view.active,false);assert.equal(view.checks.find(row=>row.label==='Oracle prices').ok,true);
 assert.match(view.schedule,/start time has not been established/);
 assert.doesNotMatch(view.title,/is active/);
 const fallback={...report,kind:'fresh-zero-oracle-maintenance'};assert.throws(()=>parsed(fallback),/unavailable/);
 report.checkpoint.timestamp=now-100000;
 const later=activationStatusView(parsed(report),now);
 assert.equal(later.active,false);assert.equal(later.stale,true);assert.equal(later.checks.find(row=>row.label==='Oracle prices').ok,true);
});
