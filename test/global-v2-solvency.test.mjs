import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEther} from 'ethers';
import {analyzeV2Liquidity} from '../scripts/global-v2-solvency.mjs';

const E=parseEther;
test('100 test wallets with $10k gross claims and $500k mock vault cash have a $500k uncovered principal liability',()=>{
 const result=analyzeV2Liquidity({principalLiability:E('1000000'),
  profitLiability:0n,vaultCash:E('500000')});
 assert.equal(result.principalShortfall,E('500000'));
 assert.equal(result.combinedShortfall,E('500000'));
 assert.equal(result.coverageBps,5000n);
 assert.equal(result.status,'VAULT_CASH_INSUFFICIENT');
 assert.equal(result.operationsWalletCountedAsCash,false);
 assert.equal(result.independentAudit,false);
});
test('funded referral credits are reserved; 500k principal remains uncovered after 10,900.8 revenue funding',()=>{
 const result=analyzeV2Liquidity({principalLiability:E('1000000'),
  profitLiability:E('10900.8'),vaultCash:E('510900.8')});
 assert.equal(result.profitShortfall,0n);
 assert.equal(result.availableForPrincipal,E('500000'));
 assert.equal(result.principalShortfall,E('500000'));
 assert.equal(result.combinedShortfall,E('500000'));
});
test('priority profit shortfall is reported separately, not hidden as liquid principal',()=>{
 const result=analyzeV2Liquidity({principalLiability:E('100'),
  profitLiability:E('50'),vaultCash:E('25')});
 assert.equal(result.profitShortfall,E('25'));
 assert.equal(result.principalShortfall,E('100'));
 assert.equal(result.combinedShortfall,E('125'));
 assert.equal(result.availableForPrincipal,0n);
});
test('no liabilities and fully covered vault cash have distinct honest statuses',()=>{
 const empty=analyzeV2Liquidity({principalLiability:0n,profitLiability:0n,vaultCash:0n});
 assert.equal(empty.status,'NO_RECORDED_LIABILITIES');
 assert.equal(empty.coverageBps,null);
 const rich=analyzeV2Liquidity({principalLiability:E('100'),profitLiability:E('50'),vaultCash:E('200')});
 assert.equal(rich.status,'VAULT_CASH_COVERS_RECORDED_LIABILITIES_AT_BLOCK');
 assert.equal(rich.coverageBps,13333n);
 assert.equal(rich.combinedShortfall,0n);
 assert.equal(rich.independentAudit,false);
});
test('solvency analyzer rejects forged negative and mixed-unit non-bigint input',()=>{
 for(const input of [
  {principalLiability:-1n,profitLiability:0n,vaultCash:0n},
  {principalLiability:0n,profitLiability:-1n,vaultCash:0n},
  {principalLiability:0n,profitLiability:0n,vaultCash:-1n},
  {principalLiability:'100',profitLiability:0n,vaultCash:0n}
 ])assert.throws(()=>analyzeV2Liquidity(input),/V2_SOLVENCY_BAD_INPUT/);
});
