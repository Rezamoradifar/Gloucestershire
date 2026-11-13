#!/usr/bin/env node
// Only consolidates real CI results. Never invents public-chain wallet transactions.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const labPath='reports/global-v2-local-100-account-report.json';
const livePath='reports/global-v2-onchain-readonly.log';
const liveExitPath='reports/global-v2-onchain-exit.txt';
const jsonOut='reports/global-v2-final-acceptance.json';
const mdOut='reports/global-v2-final-acceptance.md';
const lab=JSON.parse(fs.readFileSync(labPath,'utf8'));
assert.equal(lab.mode,'LOCAL_GANACHE_SIMULATION_ONLY');
assert.equal(lab.token,'MOCK_ERC20_NOT_REAL_USDT');
assert.equal(lab.accountsCreated,100);
assert.equal(lab.deployedPublicV2Touched,false);
assert.equal(lab.paidWithdrawals,100);
assert.equal(lab.managerApprovals,100);
assert.equal(lab.result,'PASS');
const exit=Number(fs.readFileSync(liveExitPath,'utf8').trim());
const raw=fs.readFileSync(livePath,'utf8');
const line=raw.split(/\r?\n/).find(s=>s.startsWith('GLOBAL_V2_READONLY_AUDIT '));
let live=null,liveState='RPC_UNAVAILABLE_OR_INCOMPLETE';
if(line){
 try{
  live=JSON.parse(line.slice('GLOBAL_V2_READONLY_AUDIT '.length));
  assert.equal(live.chainId,97);
  assert.equal(live.address.toLowerCase(),'0xa98d8d3709f5d3730bad5d76c334731784e7cf07');
  assert.equal(live.migrationNotPerformed,true);
  liveState=live.hasAnyVaultCashShortfall?'VERIFIED_VAULT_CASH_SHORTFALL':'READ_ONLY_CHECK_PASSED_NOT_AN_AUDIT';
 }catch{live=null;liveState='RPC_DATA_VALIDATION_FAILED';}
}
const result={
 schema:1,
 createdAt:new Date().toISOString(),
 git:{commit:process.env.GITHUB_SHA||'unknown',branch:process.env.GITHUB_HEAD_REF||'unknown'},
 scope:'BNB_TESTNET_CODE_AND_LOCAL_MOCK_ACCEPTANCE',
 release:'NO_REAL_FUNDS_APPROVAL',
 tests:{
  frontendAndTypeScriptAndBuild:'PASSED_IN_WORKFLOW_BEFORE_REPORT_GENERATION',
  v2IsolatedAPISecurity:'PASSED_IN_WORKFLOW_BEFORE_REPORT_GENERATION',
  local100Accounts:{
   result:'PASS',network:'LOCAL_GANACHE_NOT_PUBLIC_BNB_TESTNET',
   accounts:lab.accountsCreated,checkins:lab.checkinsOnChain,
   checkinsExpiredAfter24h:lab.checkinsExpiredAfter24h,
   positions:lab.positionsOpened,reinvestments:lab.manualReinvestments,
   earningsSettlementTransactions:lab.settlementTransactions,
   withdrawalRequests:lab.withdrawalRequests,
   managerApprovals:lab.managerApprovals,paidWithdrawals:lab.paidWithdrawals,
   repeatPaymentDenied:lab.repeatPaymentDenied,
   unapprovedWithdrawalDenied:lab.unapprovedWithdrawalDenied,
   replayedSettlementDenied:lab.replayedSettlementDenied,
   kycWithoutRoleDenied:lab.kycWithoutRoleDenied,
   principalWithdrawBefore90DaysDenied:lab.principalWithdrawBefore90DaysDenied
  },
  realPublicTestnetWalletTransactions:'NOT_TESTED_NO_EXTERNAL_WALLET_SIGNATURE',
  actualMobileWalletUX:'NOT_TESTED_MANUAL_DEVICE_CHECK_REQUIRED',
  publicTestnetReadOnly:{state:liveState,commandExit:exit,rpcCompleted:!!live,
   auditedAt:live?.checkedAt||null,testedBlock:live?.block??null,
   assetSummaries:live?.assets??null,fundsMovedByThisCheck:false}
 },
 economics:{
  localMockGrossRecordedPrincipalUsd:lab.grossRecordedPrincipalMockUsd,
  localMockStartingCashUsd:lab.fundingVaultCashMockUsd,
  localMockStartingPrincipalCashShortfallUsd:lab.principalCashShortfallAtStart,
  localMockFee1Usd:lab.depositRouting.feeWallet1,
  localMockFee2Usd:lab.depositRouting.feeWallet2,
  localMockOperationsUsd:lab.depositRouting.operations,
  endingPrincipalLiabilityMockUnits:lab.endingPrincipalLiabilityMockUnits,
  endingProfitLiabilityMockUnits:lab.endingProfitLiabilityMockUnits,
  note:'MOCK ledger amounts are not customer deposits, real USDT, or public-chain liquidity.'
 },
 releaseGates:{
  frontendCode:'PASS',
  isolated100WalletScenario:'PASS',
  publicRPCReadOnly:liveState,
  testnetCustomerDepositWithdrawalReceipts:'MISSING',
  independentSmartContractAndEconomicAudit:'MISSING',
  enforceablePrincipalAndRewardCashBacking:'NOT_PROVEN',
  oldCustomerLiabilitiesReconciled:'NOT_DONE',
  complianceAndProductionOperationalReview:'NOT_DONE',
  mainnetRealFunds:'BLOCKED'
 },
 verdict:'LOCAL_MOCK_AND_FRONTEND_VALIDATED_PUBLIC_FINANCIAL_LAUNCH_BLOCKED',
 limitations:[
  'Public BNB Testnet wallet-signed registration, settlement, approvals and payouts were not performed by this CI job.',
  'An RPC timeout is not proof that a contract is invalid or funds are absent.',
  'Only actual public-chain receipts and independent funding/liability reconciliation can close financial gates.'
 ]
};

fs.mkdirSync(path.dirname(jsonOut),{recursive:true});
fs.writeFileSync(jsonOut,JSON.stringify(result,null,2)+'\n');
const lines=[
 '# Global V2 — Final acceptance evidence (TESTNET ONLY)',
 '',
 'Generated: '+result.createdAt,
 'Commit: '+result.git.commit,
 '',
 '## Verified automated checks',
 '- Frontend tests, TypeScript and build: **PASS (CI)**',
 '- V2 isolated API/security tests: **PASS (CI)**',
 '- Local Ganache mock wallets: **100 PASS**',
 '- Check-ins: '+lab.checkinsOnChain+'; expired after 24h: '+lab.checkinsExpiredAfter24h,
 '- Positions: '+lab.positionsOpened+'; reinvestments: '+lab.manualReinvestments,
 '- Funded settlement transactions: '+lab.settlementTransactions,
 '- Requests / manager approvals / payments: '+lab.withdrawalRequests+' / '+lab.managerApprovals+' / '+lab.paidWithdrawals+' (MOCK ONLY)',
 '- Double payment, unapproved withdrawal, settlement replay and unauthorized KYC: rejected locally',
 '- Public BNB Testnet read-only status: '+liveState,
 '- Public-chain signed financial transactions: **NOT TESTED**',
 '- Real mobile-wallet validation: **NOT TESTED**',
 '',
 '## Cash and liability risk',
 '- Mock recorded principal: '+lab.grossRecordedPrincipalMockUsd+' units',
 '- Mock initial cash: '+lab.fundingVaultCashMockUsd+' units',
 '- Mock starting principal shortfall: '+lab.principalCashShortfallAtStart+' units',
 '- Current contract routes 10% + 10% + 80% externally; full backing is not proven.',
 live?'Public-chain audit block '+live.block+': '+live.assets.map(a=>a.symbol+' cash '+a.contractVaultCash+', principal '+a.principalLiability+', profit '+a.creditedProfitLiability+', combined shortage '+a.combinedCashShortfall).join(' | '):
 'Public chain values could not be independently retrieved in this CI execution; unknown is not zero.',
 '',
 '## Final release decision',
 '**NOT APPROVED FOR REAL-CAPITAL DEPOSITS OR MAINNET.**',
 'Requires public testnet user-signed receipt tests, liquidity reconciliation, independent audit and compliance signoff.',
 '',
 'No private keys, real transactions, customer migrations or deletions were involved.'
];
fs.writeFileSync(mdOut,lines.join('\n')+'\n');
console.log('GLOBAL_V2_FINAL_ACCEPTANCE_WRITTEN '+JSON.stringify({
 file:jsonOut,summary:mdOut,verdict:result.verdict,
 mockWallets:lab.accountsCreated,publicChain:liveState
}));
