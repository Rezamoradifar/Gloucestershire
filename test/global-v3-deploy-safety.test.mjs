import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const deploy=fs.readFileSync(new URL('../scripts/deploy-global-v3-testnet.mjs',import.meta.url),'utf8');
const installer=fs.readFileSync(new URL('../scripts/install-global-v3-keeper-timer.sh',import.meta.url),'utf8');
const contract=fs.readFileSync(new URL('../contracts/v3/GlobalV3DeferredTestnet.sol',import.meta.url),'utf8');

test('V3 deploy is a separate opt-in BNB TESTNET-only signing process with on-chain verification',()=>{
 for(const expected of [
  "const CHAIN=97","Wallet.fromEncryptedJson(encrypted,password)",
  "getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89')",
  "DEPLOY NEW V3 BNB TESTNET ONLY",
  "V3_DEPLOYMENT_ALREADY_ATTEMPTED_RECONCILE_FIRST",
  'for(let attempt=1;attempt<=5;attempt++)',
  'EMPTY_OR_SHORT_PASSWORD_NOT_ACCEPTED',
  "spawnSync('stty',['-echo']",
  "if(contract===OLD_V2)",
  "await waitV3DeploymentReceipt(p,sent.hash,{confirmations:3})",
  "verified.hasRole(managerRole,ADMIN)",
  "keccak256(code)",
  "V3_PUBLIC_TESTNET_DEPLOYED_AND_VERIFIED"
 ])assert.ok(deploy.includes(expected),expected);
 for(const prohibited of ['process.env.PRIVATE_KEY','--mainnet','chainId:56','TRANSFER_USDT','token.mint('])
  assert.equal(deploy.includes(prohibited),false,prohibited);
});
test('V3 can reuse only the pinned prior testnet deployer, not admin or an arbitrary wallet',()=>{
 for(const required of [
  "--check-old-testnet-deployer",
  "--deploy-old-testnet-deployer",
  "getAddress('0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d')",
  "/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key",
  "if(getAddress(wallet.address)!==OLD_TESTNET_DEPLOYER",
  "PREVIOUS_V2_TESTNET_SIGNER_FILE_MUST_BE_ROOT_PRIVATE",
  "V3_PRIOR_TESTNET_DEPLOYER_CHECK",
  "INTERACTIVE_DEPLOYMENT_CONFIRMATION_REQUIRED",
  "oldV2Unmodified:true",
  "transactionSent:false"
 ])assert.ok(deploy.includes(required),required);
 // Neither old-admin/owner file nor raw key text should be printed or copied.
 assert.equal(deploy.includes('owner.key'),false);
 assert.equal(deploy.includes('console.log(raw)'),false);
 assert.equal(deploy.includes('process.env.PRIVATE_KEY'),false);
});

test('gas-only keeper is isolated, separately signed and not allowed to approve withdrawals',()=>{
 for(const expected of [
  'DynamicUser=yes','LoadCredential=keeper-gas-key:',
  'LoadCredential=keeper-config:','ProtectSystem=strict',
  'NoNewPrivileges=yes','OnCalendar=hourly',
  'PINNED_KEEPER_RELEASE','npm ci --omit=dev --ignore-scripts',
  'V3_ADMIN_APPROVAL_REQUIRED_FOR_ACCRUAL=FALSE',
  'V3_KEEPER_MAY_ACCRUE_ONLY_IF_USER_CHECKIN_ELIGIBLE=TRUE'
 ])assert.ok(installer.includes(expected),expected);
 assert.equal(/ExecStart=.*(approveWithdrawal|payWithdrawal|fundWithdrawal)/.test(installer),false);
});
test('daily and profit-on-profit accrual is permissionless; only withdrawals require manager approval',()=>{
 const method=contract.match(/function accrueDaily\(address who,uint256 positionId\)[\s\S]{0,180}/)?.[0]||'';
 assert.ok(method.includes('external nonReentrant active'));
 assert.equal(method.includes('onlyRole'),false);
 assert.ok(contract.includes('p.compoundedBasis+=gross;'));
 assert.ok(contract.includes('claimableDaily[who][positionId]+=personal;'));
 assert.ok(contract.includes('claimableCompound[who][positionId]+=compound;'));
 assert.ok(contract.includes('function approveWithdrawal(uint256 id) external onlyRole(MANAGER_ROLE)'));
});
