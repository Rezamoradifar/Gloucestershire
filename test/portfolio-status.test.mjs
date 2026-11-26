import assert from 'node:assert/strict';
import test from 'node:test';
import {createPortfolioStatus,primaryFromHtml} from '../server/portfolio-status.mjs';
import {PORTFOLIO_PROFILE} from '../scripts/v3-unified-release-pins.mjs';

const vault='0x'+'1'.repeat(40),keeper='0x'+'2'.repeat(40),deploymentTx='0x'+'3'.repeat(64),last='0x'+'4'.repeat(64);
const time=Date.now(),checkedAt=new Date(time).toISOString();
const proof={vault,keeper,deploymentTx},run={version:1,chainId:97,operator:keeper,vault,deploymentTx,checkedAt,lastSuccessfulAt:checkedAt,
 accrual:'IDLE_CHECKPOINT_RECORDED',volume:'NO_DUE_VOLUME',lastAccrual:last,lastVolume:null,privateKey:'never published'};
function fixture(options={}){
 const history={portfolioProfiles:[{proof,profile:PORTFOLIO_PROFILE}],async keeperReceipts(v,o,a,b){
  assert.deepEqual([v,o,a,b],[vault,keeper,last,null]);return [{kind:'accrual',transactionHash:a,block:7}];}};
 return createPortfolioStatus(history,async()=>({code:200,data:{version:1}}),{primary:async()=>vault,now:()=>time,
  local:async()=>({timer:true,lastFailed:false,run}),...options});
}
test('automation follows the served primary index and still supports explicitly selected legacy and isolated vaults',async()=>{
 const html='<div id="root"></div>';assert.equal(primaryFromHtml(html),null);
 const meta='<meta name="global-portfolio-vault" content="'+vault+'">';assert.equal(primaryFromHtml(meta+html),vault);
 assert.throws(()=>primaryFromHtml(meta+meta+html));assert.throws(()=>primaryFromHtml('<div>Offline</div>'));
 const reader=fixture();let active=await reader(new URLSearchParams());assert.equal(active.code,200);assert.equal(active.data.vaultAddress,vault);
 assert.equal(active.data.lastSuccessfulAt,checkedAt);assert.equal(active.data.receipts[0].transactionHash,last);assert.equal(JSON.stringify(active).includes('never published'),false);
 assert.deepEqual(await reader(new URLSearchParams({vault:'legacy'})),{code:200,data:{version:1}});
 assert.equal((await reader(new URLSearchParams({vault:'0x'+'7'.repeat(40)}))).code,404);
 assert.equal((await reader(new URLSearchParams('vault='+vault+'&vault=legacy'))).code,400);
 assert.equal((await fixture({primary:async()=>{throw Error();}})(new URLSearchParams())).code,503);
});
test('an overdue check, failed service, unconfirmed recovery or mismatched wallet never reports a running portfolio',async()=>{
 for(const [props,status] of [[{timer:false},'waiting'],[{lastFailed:true},'waiting'],[{run:{...run,accrual:'RECEIPT_NOT_OBSERVED'}},'waiting'],
  [{run:{...run,operator:vault}},'unavailable'],[{run:{...run,vault:keeper}},'unavailable'],
  [{run:{...run,checkedAt:new Date(time-700000).toISOString(),lastSuccessfulAt:null}},'stale']]){
  const answer=await fixture({local:async()=>({timer:true,lastFailed:false,run,...props})})(new URLSearchParams({vault}));
  assert.equal(answer.code,503);assert.equal(answer.data.status,status);assert.equal(answer.data.vaultAddress,vault);
 }
});

test('the known launch message is upgraded once, preserves its original and leaves edits and other portfolios intact',async()=>{
 const {initializeNotifications,replaceInitialTestNotice}=await import('../server/portfolio-notifications.mjs');
 const source={id:'880ada50-2d73-460c-ad05-76f16efa5381',createdAt:'2026-11-25T14:40:08.523Z',title:'Hi',message:'Hi users test 1',published:true};
 const target='0x156a308187b1aa5897b82d617e583ad4687c8c09';
 for(const [address,item,changed] of [[target,source,true],[vault,source,false],[target,{...source,message:'An edited message'},false],[target,{...source,revision:3},false]]){
  const state={announcements:[{...item}],tickets:[]};initializeNotifications(state);
  replaceInitialTestNotice(state,address,checkedAt);const first=structuredClone(state);replaceInitialTestNotice(state,address,checkedAt);
  assert.deepEqual(first,state);assert.equal(Boolean(state.launchNoticeBackup),changed);assert.equal(state.notifications.events.length,1);
  assert.equal(state.announcements[0].title,changed?'Welcome to the Global Drop Trade testnet':'Hi');assert.equal(state.telegram,undefined);
 }
});
