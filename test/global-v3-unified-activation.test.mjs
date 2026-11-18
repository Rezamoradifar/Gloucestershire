import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const script=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const gas=script('scripts/fund-v3-keeper-gas-from-old-deployer.mjs');
const activation=script('scripts/activate-global-v3-unified-profit.sh');
const diagnostic=script('scripts/diagnose-global-v3-profit-readonly.mjs');
const timer=script('scripts/install-global-v3-keeper-timer.sh');

test('single command can activate ONLY V3 testnet hourly internal accrual and backed-up site release',()=>{
 for(const required of [
  'scripts/verify-v3-site-deployment.mjs --check',
  'scripts/install-global-v3-keeper-timer.sh --init-wallet',
  'scripts/fund-v3-keeper-gas-from-old-deployer.mjs --fund',
  'scripts/install-global-v3-keeper-timer.sh --check',
  'scripts/install-global-v3-keeper-timer.sh --install',
  'scripts/launch-v3-site-after-deployment.sh --install',
  'V3_SINGLE_ACCOUNT_SITE_INSTALL_STARTED_NOT_YET_COMPLETE',
  'V3_TESTNET_ONLY_NO_REAL_USDT_NO_MAINNET_APPROVAL'
 ])assert.ok(activation.includes(required),required);
 assert.equal(activation.includes('deploy-global-v3-testnet.mjs --deploy'),false);
 assert.equal(activation.includes('privateKey'),false);
 assert.equal(activation.includes('V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED"'),false);
 assert.ok(timer.includes('OnCalendar=hourly'));
});
test('testnet gas bootstrap from pinned previous deployer requires explicit typed confirmation',()=>{
 for(const required of [
  "const CHAIN=97",
  "const CONTRACT=getAddress('0x81B55ab9A1B36CccE355aFC4FfC579BA861f74e7')",
  "const OLD=getAddress('0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d')",
  "const TARGET_GAS=parseEther('0.005')",
  "const MAX_GAS_COST=parseEther('0.001')",
  "GAS_ONLY_SIGNER_HAS_UNSAFE_PRIVILEGED_ROLE",
  "FUND V3 GAS BNB TESTNET ONLY",
  "if(!process.stdin.isTTY||!process.stdout.isTTY)",
  "await confirm();",
  "signer.sendTransaction({",
  "chainId:97,to:key.address,value:add,gasLimit:21000n,gasPrice:price",
  "waitV3KeeperReceipt(provider,tx.hash,{confirmations:2})",
  "noERC20TokensMoved:true"
 ])assert.ok(gas.includes(required),required);
 assert.equal(gas.includes('.mint('),false);
 assert.equal(gas.includes('.approve('),false);
 assert.equal(gas.includes('payWithdrawal('),false);
 assert.equal(gas.includes('process.env.PRIVATE_KEY'),false);
});
test('live diagnostics never credit user balances, move funds or claim a VPS timer is active',()=>{
 for(const required of [
  "function open()",
  "'function memberCount() view returns(uint256)'",
  "'function isEligible(address) view returns(bool)'",
  "'function positionOf(address,uint256)",
  'accrualDueEligiblePositions',
  'expiredOrMissingCheckins',
  'recordedPrincipalTestUnits',
  'recordedProfitTestUnits',
  'serviceStatusNotAvailableFromPublicChain:true',
  'V3_PUBLIC_READ_ONLY_PROFIT_DIAGNOSTIC'
 ])assert.ok(diagnostic.includes(required),required);
 for(const forbidden of ['new Wallet(','privateKey','sendTransaction(','.mint(','.approve('])
  assert.equal(diagnostic.includes(forbidden),false,forbidden);
});
