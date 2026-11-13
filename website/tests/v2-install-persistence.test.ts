import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
const file=(path:string)=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

describe('V2 frontend guarded install remains safe after terminal hangup',()=>{
 const wrapper=file('../../scripts/run-guarded-v2-site.sh');
 const installer=file('../../ubuntu-global-v2-site.sh');
 const launcher=file('../../scripts/launch-v2-site-service.sh');
 it('runs exactly one full gated install pass without repeating resource-heavy tests',()=>{
  expect(wrapper.match(/bash ubuntu-global-v2-site\.sh --install/g)).toHaveLength(1);
  expect(wrapper).not.toMatch(/^bash ubuntu-global-v2-site\.sh --check$/m);
  expect(wrapper).toContain('V2_FRONTEND_INSTALL_COMPLETED');
  expect(installer).toContain('V2_SITE_BUILD_AND_TEST_PASS');
  expect(installer).toContain('npm test --prefix website -- --maxWorkers=2 --minWorkers=1');
  expect(installer).toContain('npm run build --prefix website');
 });
 it('never installs without SHA pin, checked web root and rollback backups',()=>{
  for(const token of ['V2_SITE_PINNED_SHA_REQUIRED','V2_SITE_RELEASE_SHA_MISMATCH','V2_SITE_VERIFIED_ROOT=','V2_SITE_BACKEND_CHANGED','V2_SITE_ROLLBACK_OK'])
   expect(installer).toContain(token);
 });
 it('detaches under systemd rather than relying on nohup in a phone session',()=>{
  expect(launcher).toContain('systemd-run');
  expect(launcher).toContain('--property=TimeoutStartSec=3600');
  expect(launcher).toContain('run-guarded-v2-site.sh');
  expect(launcher).toContain('journalctl -u');
  expect(launcher).toContain('V2_SITE_SERVICE_ALREADY_RUNNING');
  expect(launcher).not.toContain('nohup');
 });
 it('keeps financial services and chain state unmodified',()=>{
  expect(installer).not.toContain('bash ubuntu-api.sh');
  expect(installer).not.toContain('TRADES_VAULT_ADDRESS=');
  expect(launcher).not.toContain('eth_sendTransaction');
 });
});
