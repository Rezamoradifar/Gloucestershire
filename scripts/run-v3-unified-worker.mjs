import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Wallet, getAddress, parseEther} from 'ethers';
import {verifyUnifiedRelease} from './verify-v3-unified-release.mjs';
import {createUnifiedRpcProvider, transportReason, withUnifiedReadRpc} from './v3-unified-verification-rpc.mjs';
import {recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {UNIFIED_DEPLOYER,unifiedProfileForFlag} from './v3-unified-release-pins.mjs';
import {isV3SystemdCredential} from './global-v3-auto-compound-keeper.mjs';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {runUnifiedKeeperCycle} from './run-v3-unified-keeper-cycle.mjs';
import {runUnifiedNetworkVolume, reconcileUnifiedNetworkVolume} from './process-v3-unified-network-volume.mjs';

const endpoints = [
  'https://bsc-testnet-dataseed.bnbchain.org', 'https://bsc-testnet-rpc.publicnode.com',
  'https://bsc-testnet.bnbchain.org', 'https://bsc-prebsc-dataseed.bnbchain.org'
];
const minimum = parseEther('0.001');
const {O_RDONLY, O_NOFOLLOW} = fs.constants;

function readPrivate(filename, limit, credentialName) {
  const fd = fs.openSync(filename, O_RDONLY | O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    let allowed = stat.uid === process.getuid() && (stat.mode & 0o077) === 0;
    if (!allowed && credentialName && process.env.CREDENTIALS_DIRECTORY) {
      const credentialDir = process.env.CREDENTIALS_DIRECTORY;
      const dir = fs.lstatSync(credentialDir);
      allowed = dir.isDirectory() && !dir.isSymbolicLink() && isV3SystemdCredential({
        filename, name:credentialName, credentialDir, fileUid:stat.uid, fileGid:stat.gid,
        fileMode:stat.mode, dirUid:dir.uid, dirGid:dir.gid, dirMode:dir.mode
      });
    }
    if (!allowed || !stat.isFile() || !stat.size || stat.size > limit) throw Error('UNIFIED_WORKER_CREDENTIAL_INVALID');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

function atomicFile(filename, contents, replace = true) {
  const directory = path.dirname(filename);
  const temp = path.join(directory, '.unified-' + randomUUID());
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (replace) fs.renameSync(temp, filename);
    else fs.linkSync(temp, filename);
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally { fs.rmSync(temp, {force:true}); }
}

export function initializeWorkerKey(filename) {
  try { readPrivate(filename, 128); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { atomicFile(filename, Wallet.createRandom().privateKey + '\n', false); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  return new Wallet(readPrivate(filename, 128).trim()).address;
}

async function checkOperator(provider, proof, operator, profile) {
  const {vault, block} = await verifyUnifiedRelease(provider, proof, UNIFIED_DEPLOYER, profile);
  if ([proof.manager, proof.feeReceiver, UNIFIED_DEPLOYER, proof.vault, proof.network, proof.book, proof.token]
        .some(addr => getAddress(addr) === operator)) throw Error('UNIFIED_WORKER_IDENTITY_INVALID');
  const at = {blockTag:block.number};
  const [roles, paused] = await Promise.all([
    Promise.all(['DEFAULT_ADMIN_ROLE', 'MANAGER_ROLE', 'FUNDER_ROLE', 'GUARDIAN_ROLE'].map(fn => vault[fn](at))),
    vault.paused(at)
  ]);
  if (paused) throw Error('UNIFIED_WORKER_VAULT_PAUSED');
  if ((await Promise.all(roles.map(role => vault.hasRole(role, operator, at)))).some(Boolean))
    throw Error('UNIFIED_WORKER_PRIVILEGED_OPERATOR');
  const balance = await provider.getBalance(operator, block.number);
  await recheckUnifiedBlock(provider, block);
  return {balance, block:block.number};
}

// Once an RPC is selected, a failed write is recovered from its journal on the next timer tick.
export async function selectWorkerProvider(command, proof, operator, profile, {
  readOnly = withUnifiedReadRpc, createProvider = createUnifiedRpcProvider, verifyOperator = checkOperator
} = {}) {
  const verify = provider => verifyOperator(provider, proof, operator, profile);
  if (command === '--check') return readOnly(endpoints[0], 'worker-check', verify);
  if (command !== '--tick') throw Error('UNIFIED_WORKER_INVALID_ARGUMENTS');
  let cause;
  for (const url of endpoints) {
    const provider = createProvider(url, 12000);
    try {
      const check = await verify(provider);
      return {provider, ...check};
    } catch (error) {
      provider.destroy();
      if (!transportReason(error)) throw error;
      cause = error;
    }
  }
  throw cause ?? Error('UNIFIED_WORKER_RPC_UNAVAILABLE');
}

export async function combinedCycle({hasAccrual, hasVolume, recoverVolume, checkVolume, accrue, volume}) {
  if (hasAccrual && hasVolume) throw Error('UNIFIED_WORKER_CONFLICTING_PENDING_JOURNALS');
  if (hasVolume) return {volume:(await recoverVolume()).status};
  await checkVolume();
  const accrual = await accrue();
  if (hasAccrual || !['IDLE_CHECKPOINT_RECORDED','CONFIRMED_CHECKPOINT_RECORDED'].includes(accrual.state))
    return {accrual:accrual.state, hash:accrual.hash};
  const network = await volume();
  return {accrual:accrual.state, hash:accrual.hash, volume:network.status};
}

async function tick(provider, signer, proof, directory) {
  if (!directory || !path.isAbsolute(directory)) throw Error('UNIFIED_WORKER_STATE_DIRECTORY_REQUIRED');
  // The common kernel lock covers both components and is released on process death.
  const outer = openUnifiedJournal(directory);
  try {
    const volumeFile = path.join(directory, 'volume.json');
    const journalDirectory = path.join(directory, 'accrual');
    let state;
    try { state = JSON.parse(readPrivate(volumeFile, 1048576)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = {}; }
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('UNIFIED_VOLUME_STATE_REQUIRED');
    const accrual = openUnifiedJournal(journalDirectory);
    let hasAccrual;
    try { hasAccrual = !!accrual.read(); } finally { accrual.close(); }
    const args = {provider, proof, operator:signer.address, state,
      save:next => atomicFile(volumeFile, JSON.stringify(next) + '\n')};
    return await combinedCycle({hasAccrual, hasVolume:!!state.pendingTransaction,
      recoverVolume:() => reconcileUnifiedNetworkVolume({...args, resume:true}),
      checkVolume:() => reconcileUnifiedNetworkVolume(args),
      accrue:() => runUnifiedKeeperCycle({provider, signer, proof, journalDirectory}),
      volume:() => runUnifiedNetworkVolume({...args, signer})});
  } finally { outer.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const profile = unifiedProfileForFlag(['--single-capital','--daily-capital','--referral-profit','--manual-reinvest','--upline-rates','--account-reinvest','--portfolio'].includes(args.at(-1))?args.pop():undefined);
  const [command, sha, ...extra] = args;
  if (extra.length || !['--init-key','--check','--tick'].includes(command) ||
      (command === '--check' ? !/^[a-f0-9]{40}$/.test(sha ?? '') : sha !== undefined))
    throw Error('UNIFIED_WORKER_INVALID_ARGUMENTS');
  if (command !== '--tick' && process.getuid() !== 0) throw Error('UNIFIED_WORKER_INSTALL_REQUIRES_ROOT');
  const keyPath = profile.gasKey;
  const proofPath = path.join(profile.stateDirectory, 'deployment-proof.json');
  if (command === '--init-key') {
    console.log('UNIFIED_KEEPER_ADDRESS=' + initializeWorkerKey(keyPath));
    return;
  }
  const creds = process.env.CREDENTIALS_DIRECTORY;
  if (command === '--tick' && (!creds || !path.isAbsolute(creds))) throw Error('UNIFIED_WORKER_CREDENTIALS_REQUIRED');
  const signer = new Wallet(readPrivate(command === '--tick' ? path.join(creds,'keeper-key') : keyPath,128,command === '--tick' ? 'keeper-key' : undefined).trim());
  const raw = readPrivate(command === '--tick' ? path.join(creds,'deployment-proof') : proofPath,65536,command === '--tick' ? 'deployment-proof' : undefined);
  const proof = JSON.parse(raw);
  const {provider, balance, block} = await selectWorkerProvider(command, proof, signer.address, profile);
  try {
    if (command === '--check') {
      const ready = {sourceSha:sha, proofSha256:createHash('sha256').update(raw).digest('hex'),
        chainId:97, vault:getAddress(proof.vault), operator:signer.address, block, gasReady:balance >= minimum};
      atomicFile(path.join(profile.stateDirectory, 'worker-ready.json'), JSON.stringify(ready) + '\n');
    }
    if (balance < minimum) {
      console.error('UNIFIED_KEEPER_NEEDS_TEST_GAS=' + signer.address + ' MINIMUM_TBNB=0.001 CHAIN_ID=97');
      process.exitCode = 42;
      return;
    }
    if (command === '--tick') {
      console.log('UNIFIED_WORKER_RESULT', JSON.stringify(await tick(provider, signer.connect(provider), proof, process.env.STATE_DIRECTORY)));
    }
  } finally { provider?.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => {
    const message = String(error?.message ?? '');
    console.error(/^[A-Z][A-Z_0-9]{3,100}$/.test(message) ? message : 'UNIFIED_WORKER_' + (error?.code && /^[A-Z_0-9]+$/.test(error.code) ? error.code : 'FAILED'));
    process.exitCode = 1;
  });
