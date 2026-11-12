import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const file='ubuntu-event-history-rpc-install.sh',source=readFileSync(file,'utf8');

test('history RPC installer uses explicit check/install modes and is valid Bash',()=>{
 assert.equal(spawnSync('bash',['-n',file],{encoding:'utf8'}).status,0);
 assert.match(source,/--check\|--install/);
 assert.match(source,/if \[ "\$mode" = --check \]; then/);
 assert.match(source,/EVENT_HISTORY_CHECK_PASS/);
 assert.match(source,/npm run build --prefix website/);
 assert.doesNotMatch(source,/scripts\/unpack-website\.sh|website-release\.tar\.gz/);
});

test('installer refuses unknown code, old UI or wrong target and tests a real server RPC log request',()=>{
 assert.match(source,/a54cc051915a6731daa468ca4476b100abd7712c/);
 assert.match(source,/EVENT_HISTORY_LIVE_API_VERSION_REVIEW_REQUIRED/);
 assert.match(source,/EVENT_HISTORY_LIVE_UI_VERSION_REVIEW_REQUIRED/);
 assert.match(source,/Deep scan older blocks/);
 assert.match(source,/EVENT_HISTORY_ACTIVE_TESTNET_TARGET_REQUIRED/);
 assert.match(source,/EVENT_HISTORY_API_READ_ONLY_PASS/);
 assert.match(source,/\/api\/event-history\/window\?/);
 assert.match(source,/&from=\$confirmed&to=\$confirmed/);
});

test('installer recognizes only immutable reviewed previous API releases before replacement',()=>{
 assert.match(source,/EVENT_HISTORY_LIVE_API_VERSION_REVIEW_REQUIRED/);
 assert.match(source,/694a78c8804d180780735f23abe272768e8abc5f/);
 assert.match(source,/c488903ba7ff6222e6e683f2a13221986bb3cac8/);
 assert.match(source,/TEAM_BRANCHES_API_READ_ONLY_PASS/);
 assert.match(source,/\/api\/team\/branches\?parent=/);
 assert.match(source,/a54cc051915a6731daa468ca4476b100abd7712c/);
 assert.match(source,/git hash-object "\$previous_api\/server\/trades-api\.mjs"/);
 assert.doesNotMatch(source,/EVENT_HISTORY_SKIP_VERSION|--force-version/);
});

test('installer backs up current API and static assets with rollback, never touches reward worker or financial journals',()=>{
 assert.match(source,/EVENT_HISTORY_PREVIOUS_RELEASE_RESTORED/);
 assert.match(source,/trap cleanup EXIT/);
 assert.match(source,/BACKUP_PATH/);
 assert.match(source,/EVENT_HISTORY_SITE_AND_API_INSTALLED/);
 assert.match(source,/cp -p "\$backup\/api\.service" "\$unit"/);
 assert.match(source,/ln -sfn "\$previous_api" \/opt\/globaldroptrade-api\/current/);
 assert.doesNotMatch(source,/systemctl (?:stop|disable|restart) globaldroptrade-new-deployer|readPrivateKey|eth_sendRawTransaction|sendTransaction|rm -rf[^\n]*journal/);
});
