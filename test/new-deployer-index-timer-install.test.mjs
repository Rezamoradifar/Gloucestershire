import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const filename = fileURLToPath(new URL('../ubuntu-enable-new-deployer-index-worker.sh', import.meta.url));
const source = fs.readFileSync(filename, 'utf8');

test('index-only timer installer has valid Bash syntax and separate unit identities', () => {
  const result = spawnSync('bash', ['-n', filename], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(source, /service=globaldroptrade-readonly-index\.service/);
  assert.match(source, /timer=globaldroptrade-readonly-index\.timer/);
  assert.match(source, /OnUnitInactiveSec=60s/);
  assert.match(source, /scripts\/auto-index-new-deployer\.mjs --execute/);
});

test('timer masks the deployer signer and writes only the independent index journal directory', () => {
  assert.match(source, /InaccessiblePaths=-\/etc\/globaldroptrade\/new-deployer-testnet-v1\/deployer\.key/);
  assert.match(source, /ProtectSystem=strict/);
  assert.match(source, /ReadWritePaths=\/var\/lib\/globaldroptrade\/new-deployer-testnet-automation-v1/);
  assert.match(source, /scripts\/preflight-index-auto\.mjs --check/);
  assert.doesNotMatch(source, /systemctl (?:stop|restart|disable) (?:globaldroptrade-new-deployer-daily|globaldroptrade-api)/);
  assert.doesNotMatch(source, /\b(?:seedNewDeployerTestRewards|privateKey|withdraw\(|transfer\()\b/);
});

test('installer rejects dirty checkout, unpinned SHA, wrong network and incompatible existing units', () => {
  for (const guard of [
    'DIRTY_CHECKOUT', 'EXPLICIT_SHA_REQUIRED', 'TESTNET_TARGET_MISMATCH',
    'PRIVATE_JOURNAL_REQUIRED', 'INDEX_IDENTITY_INVALID',
    'EXISTING_UNIT_REVIEW_REQUIRED', 'LIVE_PREFLIGHT_FAILED'
  ]) assert.ok(source.includes(guard), guard);
});