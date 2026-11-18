import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {getAddress, ZeroAddress} from 'ethers';

const READY_FILE = '/var/lib/globaldroptrade/v3-unified-testnet/worker-ready.json';
const TIMER = 'global-v3-unified-keeper-testnet.timer';

export function checkWorkerIdentity(ready, {sha, digest, vault}) {
  if (ready?.chainId !== 97 || ready.sourceSha !== sha || ready.proofSha256 !== digest ||
      getAddress(ready.vault) !== getAddress(vault) || getAddress(ready.operator) === ZeroAddress) {
    throw Error('UNIFIED_SITE_WORKER_IDENTITY_MISMATCH');
  }
}

export function verifyActiveWorker(expected) {
  if (fs.realpathSync(READY_FILE) !== READY_FILE) throw Error('UNIFIED_SITE_WORKER_READY_FILE_INVALID');
  const fd = fs.openSync(READY_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== 0 || (st.mode & 0o077) || st.size === 0 || st.size > 8192) {
      throw Error('UNIFIED_SITE_WORKER_READY_FILE_INVALID');
    }
    checkWorkerIdentity(JSON.parse(fs.readFileSync(fd, 'utf8')), expected);
  } finally {
    fs.closeSync(fd);
  }
  execFileSync('systemctl', ['is-active', '--quiet', TIMER], {stdio: 'ignore'});
}
