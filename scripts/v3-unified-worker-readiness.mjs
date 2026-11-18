import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {getAddress, ZeroAddress} from 'ethers';

import {UNIFIED_PROFILE} from './v3-unified-release-pins.mjs';

export function checkWorkerIdentity(ready, {sha, digest, vault}) {
  if (ready?.chainId !== 97 || ready.sourceSha !== sha || ready.proofSha256 !== digest ||
      getAddress(ready.vault) !== getAddress(vault) || getAddress(ready.operator) === ZeroAddress) {
    throw Error('UNIFIED_SITE_WORKER_IDENTITY_MISMATCH');
  }
}

export function verifyActiveWorker(expected,profile=UNIFIED_PROFILE) {
  const readyFile=path.join(profile.stateDirectory,'worker-ready.json');
  if (fs.realpathSync(readyFile) !== readyFile) throw Error('UNIFIED_SITE_WORKER_READY_FILE_INVALID');
  const fd = fs.openSync(readyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== 0 || (st.mode & 0o077) || st.size === 0 || st.size > 8192) {
      throw Error('UNIFIED_SITE_WORKER_READY_FILE_INVALID');
    }
    checkWorkerIdentity(JSON.parse(fs.readFileSync(fd, 'utf8')), expected);
  } finally {
    fs.closeSync(fd);
  }
  execFileSync('systemctl', ['is-active', '--quiet', profile.timer], {stdio: 'ignore'});
}
