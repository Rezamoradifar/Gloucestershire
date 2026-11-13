// This test performs NO chain transaction and imports NO signing key.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isDueV3Position} from '../scripts/global-v3-auto-compound-keeper.mjs';

const now=86400*10;
const eligible={principal:1000n,lastAccruedAt:now-86400,eligible:true,now,paused:false};
test('daily and profit-on-profit accrue only after real 24h interval and signed user check-in',()=>{
 assert.equal(isDueV3Position(eligible),true);
 assert.equal(isDueV3Position({...eligible,now:now-1}),false);
 assert.equal(isDueV3Position({...eligible,eligible:false}),false);
 assert.equal(isDueV3Position({...eligible,paused:true}),false);
 assert.equal(isDueV3Position({...eligible,principal:0n}),false);
 assert.equal(isDueV3Position({...eligible,lastAccruedAt:now-2*86400}),true);
});
test('invalid stored position values fail closed',()=>{
 assert.throws(()=>isDueV3Position({...eligible,lastAccruedAt:-1}));
 assert.throws(()=>isDueV3Position({...eligible,principal:-1n}));
 assert.throws(()=>isDueV3Position({...eligible,now:NaN}));
 assert.throws(()=>isDueV3Position({...eligible,now:now+.5}));
});
test('keeper never uses a manager wallet, calls token transfers or credits fake balances',()=>{
 const code=fs.readFileSync(new URL('../scripts/global-v3-auto-compound-keeper.mjs',import.meta.url),'utf8');
 for(const required of [
  "const CHAIN=97",
  "V3_ONLY_PINNED_MOCK_TEST_USDT",
  "V3_PUBLIC_TESTNET_DEPLOYMENT_NOT_VERIFIED_OR_RPC_UNAVAILABLE",
  "V3_PINNED_CHAIN97_CONFIG_REQUIRED",
  "USE_A_SEPARATE_GAS_ONLY_KEEPER_WITHOUT_ADMIN_ROLES",
  "contract.DEFAULT_ADMIN_ROLE(),contract.MANAGER_ROLE(),contract.FUNDER_ROLE(),contract.GUARDIAN_ROLE()",
  "contract.isEligible(member)",
  "contract.positionOf(member,j)",
  "payable.accrueDaily.staticCall(item.member,item.positionId)",
  "payable.accrueDaily(item.member,item.positionId",
  "DailyClaimAccrued",
  "GAS_LIMIT_PER_RUN",
  "walletIsManager:false"
 ])assert.ok(code.includes(required),required);
 for(const forbidden of ['PRIVATE_KEY','process.env.MNEMONIC','.transfer(','.approve(','.mint(','payWithdrawal('])
  assert.equal(code.includes(forbidden),false,forbidden);
});
