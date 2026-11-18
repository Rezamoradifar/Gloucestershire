// The unified vault owns the network plan; volume continuations are sent to that component.
import {Contract, Interface, Transaction, Wallet, ZeroAddress, getAddress, parseEther, toQuantity} from 'ethers';
import {waitV3KeeperReceipt} from './v3-keeper-receipt-poll.mjs';
import {processZeroStartVolume} from './zero-start-volume.mjs';
import {verifyUnifiedDeployment, validateUnifiedProof, recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';

const networkAbi = [
  'function volumeJobCount() view returns (uint256)',
  'function volumeJobs(uint256) view returns (address child, address ancestor, uint256 usd)',
  'function processNetworkVolume(uint256 job,uint256 steps)',
  'event NetworkVolumeProgress(uint256 indexed job,address nextAncestor)'
];
const networkInterface = new Interface(networkAbi);

async function confirmedBlock(provider, tag) {
  const chainId = BigInt(await provider.send('eth_chainId', []));
  if (chainId !== 97n) throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
  const height = tag === 'latest' ? BigInt(await provider.send('eth_blockNumber', [])) - 2n : BigInt(tag);
  if (height < 0n || height > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
  const block = await provider.send('eth_getBlockByNumber', [toQuantity(height), false]);
  if (!block || BigInt(block.number) !== height || !/^0x[0-9a-f]{64}$/i.test(block.hash)) {
    throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
  }
  return {number: Number(height), hash: block.hash};
}

async function verifyReceipt({provider, hash, request, operator, network, job}) {
  const [tx, receipt, head] = await Promise.all([
    provider.getTransaction(hash), provider.getTransactionReceipt(hash), confirmedBlock(provider, 'latest')
  ]);
  if (!tx || !receipt || receipt.status !== 1 || tx.hash !== hash || receipt.hash !== hash ||
      getAddress(receipt.to) !== network || getAddress(receipt.from) !== operator ||
      getAddress(tx.to) !== network || getAddress(tx.from) !== operator ||
      tx.value !== 0n || tx.chainId !== 97n || tx.data !== request.data ||
      tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber ||
      receipt.blockNumber > head.number ||
      (request.nonce !== undefined && (tx.nonce !== request.nonce || tx.gasLimit !== request.gasLimit ||
       tx.gasPrice !== request.gasPrice))) throw Error('UNIFIED_VOLUME_RECEIPT_MISMATCH');
  const hasProgress = logs => Array.isArray(logs) && logs.some(log => {
    try {
      if (getAddress(log.address) !== network) return false;
      const event = networkInterface.parseLog(log);
      return event?.name === 'NetworkVolumeProgress' && event.args.job === job;
    } catch { return false; }
  });
  const observed = await provider.send('eth_getTransactionReceipt', [hash]);
  if (!observed || observed.transactionHash !== hash || BigInt(observed.status) !== 1n ||
      observed.blockHash !== receipt.blockHash || BigInt(observed.blockNumber) !== BigInt(receipt.blockNumber)) {
    throw Error('UNIFIED_VOLUME_RECEIPT_MISMATCH');
  }
  if (!hasProgress(receipt.logs) || !hasProgress(observed.logs)) throw Error('UNIFIED_VOLUME_PROGRESS_EVENT_MISSING');
  await recheckUnifiedBlock(provider, {number: receipt.blockNumber, hash: receipt.blockHash});
  return receipt;
}

async function requireUnprivileged(verified, provider, operator) {
  await recheckUnifiedBlock(provider, verified.block);
  const vault = verified.vault;
  if (await vault.paused()) throw Error('UNIFIED_VOLUME_VAULT_PAUSED');
  const roles = await Promise.all([
    vault.DEFAULT_ADMIN_ROLE(), vault.MANAGER_ROLE(), vault.FUNDER_ROLE(), vault.GUARDIAN_ROLE()
  ]);
  if ((await Promise.all(roles.map(role => vault.hasRole(role, operator)))).some(Boolean)) {
    throw Error('USE_UNPRIVILEGED_TESTNET_KEEPER');
  }
}

function deploymentIdentity(verified) {
  const {vault, network, deploymentTx} = verified.proof;
  return {chainId: 97, vault, network, deploymentTx};
}

function checkIdentity(state, identity) {
  if (state.identity || state.volume || state.pendingTransaction || state.lastConfirmed) {
    if (!state.identity || Object.keys(identity).some(key => state.identity[key] !== identity[key])) {
      throw Error('UNIFIED_VOLUME_STATE_TARGET_MISMATCH');
    }
  }
}

/**
 * The caller owns the private journal, single-process lock, nonce and gas budget.
 * Its submit callback must journal before broadcast and return a transaction hash
 * only after three confirmations (including its own block). The caller must hold
 * its lock over the whole call, including cursor persistence. A call without a
 * submit callback is a read-only inspection; it updates only a copy of state.
 */
export async function processUnifiedNetworkVolume({
  provider, proof, state = {}, save, submit, operator, maxScans = 100, steps = 8
}) {
  const verified = await verifyUnifiedDeployment(provider, proof);
  const network = verified.proof.network;
  const identity = deploymentIdentity(verified);
  checkIdentity(state, identity);
  const runner = submit ? getAddress(operator) : null;
  if (submit && (typeof submit !== 'function' || typeof save !== 'function' || runner === ZeroAddress)) {
    throw Error('UNIFIED_VOLUME_JOURNALED_SENDER_REQUIRED');
  }
  const plan = new Contract(network, networkAbi, provider);
  const vault = verified.vault;
  if (await vault.paused({blockTag: verified.block.number})) throw Error('UNIFIED_VOLUME_VAULT_PAUSED');
  const guard = () => requireUnprivileged(verified, provider, runner);
  const working = submit ? state : structuredClone(state);
  working.identity = identity;
  const result = await processZeroStartVolume({
    vault: plan,
    provider: {getBlock: tag => confirmedBlock(provider, tag)},
    state: working, save: submit ? () => save(working) : () => {},
    maxTransactions: submit ? 1 : 0, maxScans, steps,
    transact: async (label, request) => {
      const {args} = networkInterface.parseTransaction(request);
      const job = args.job;
      const verifyJob = async () => {
        await guard();
        const ancestor = (await plan.volumeJobs(job)).ancestor;
        if (label !== 'volume-' + job + '-' + ancestor.toLowerCase() || ancestor === ZeroAddress) {
          throw Error('UNIFIED_VOLUME_JOB_ALREADY_CHANGED');
        }
      };
      await verifyJob();
      const hash = await submit({label, request: {to: network, data: request.data, value: 0n}, guard: verifyJob});
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('UNIFIED_VOLUME_TRANSACTION_HASH_REQUIRED');
      return verifyReceipt({provider, hash, request, operator: runner, network, job});
    }
  });
  await recheckUnifiedBlock(provider, verified.block);
  return {...result, chainId: 97, vault: identity.vault, network};
}

const maxGas = 1500000n;
const maxGasPrice = 100000000000n;
const maxFee = parseEther('0.005');

function inspectSigned(record, operator, network) {
  const tx = Transaction.from(record.raw);
  const call = networkInterface.parseTransaction(tx);
  if (tx.hash !== record.hash || tx.chainId !== 97n || tx.type !== 0 || tx.from !== operator ||
      tx.to !== network || tx.value !== 0n || tx.gasPrice <= 0n || tx.gasPrice > maxGasPrice ||
      tx.gasLimit <= 0n || tx.gasLimit > maxGas || tx.gasLimit * tx.gasPrice > maxFee ||
      !call || call.name !== 'processNetworkVolume' || call.args.steps < 1n || call.args.steps > 64n ||
      tx.data !== networkInterface.encodeFunctionData(call.name, call.args) ||
      !/^0x[\da-f]{40}$/i.test(record.ancestor) || getAddress(record.ancestor) === ZeroAddress) {
    throw Error('UNIFIED_VOLUME_JOURNAL_TRANSACTION_MISMATCH');
  }
  return {tx, job: call.args.job};
}

/**
 * Hold the common keeper lock throughout. Resolves a prior success only after
 * verifying the exact transaction, progress event, chain and three confirmations.
 * An unknown transaction can be resumed with identical signed bytes. Other
 * ambiguous outcomes throw and keep the durable record for inspection.
 */
export async function reconcileUnifiedNetworkVolume({provider, proof, operator, state, save, resume = false,
  waitReceipt = waitV3KeeperReceipt}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('UNIFIED_VOLUME_STATE_REQUIRED');
  if (state.identity || state.volume || state.lastConfirmed || Object.hasOwn(state, 'pendingTransaction')) {
    checkIdentity(state, deploymentIdentity({proof: validateUnifiedProof(proof)}));
  }
  const pending = state.pendingTransaction;
  if (Object.hasOwn(state, 'pendingTransaction') && (!pending || typeof pending !== 'object' || typeof save !== 'function')) {
    throw Error('UNIFIED_VOLUME_JOURNAL_TRANSACTION_MISMATCH');
  }
  if (state.lastConfirmed) await recheckUnifiedBlock(provider, state.lastConfirmed);
  if (!pending) return {status: 'NO_PENDING_VOLUME'};
  const verified = await verifyUnifiedDeployment(provider, proof);
  checkIdentity(state, deploymentIdentity(verified));
  const network = verified.proof.network;
  const who = getAddress(operator);
  const {tx, job} = inspectSigned(pending, who, network);
  const hash = tx.hash;
  let receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) {
    if (!resume) throw Error('UNIFIED_VOLUME_PENDING_TRANSACTION');
    if (!await provider.getTransaction(hash)) {
      await requireUnprivileged(verified, provider, who);
      const plan = new Contract(network, networkAbi, provider);
      const [current, latestNonce, pendingNonce] = await Promise.all([
        plan.volumeJobs(job), provider.getTransactionCount(who, 'latest'), provider.getTransactionCount(who, 'pending')
      ]);
      if (getAddress(current.ancestor) !== getAddress(pending.ancestor) || latestNonce !== tx.nonce ||
          pendingNonce !== tx.nonce) throw Error('UNIFIED_VOLUME_PENDING_TRANSACTION_NEEDS_REVIEW');
      const response = await provider.broadcastTransaction(pending.raw);
      if (response.hash !== hash) throw Error('UNIFIED_VOLUME_BROADCAST_HASH_MISMATCH');
    }
    await waitReceipt(provider, hash, {confirmations: 3});
  }
  receipt = await verifyReceipt({provider, hash, request: tx, operator: who, network, job});
  state.lastConfirmed = {number: receipt.blockNumber, hash: receipt.blockHash};
  delete state.pendingTransaction;
  save(state);
  return {status: 'VOLUME_CONFIRMED', hash};
}

/** A single bounded volume run using the common lock and a synchronous durable save(state). */
export async function runUnifiedNetworkVolume({provider, proof, signer, state, save, maxScans = 100, steps = 8,
  waitReceipt = waitV3KeeperReceipt}) {
  if (!(signer instanceof Wallet) || signer.provider !== provider || typeof save !== 'function') {
    throw Error('UNIFIED_LOCAL_GAS_WALLET_REQUIRED');
  }
  const operator = signer.address;
  if (state.pendingTransaction) {
    return reconcileUnifiedNetworkVolume({provider, proof, operator, state, save, resume: true, waitReceipt});
  }
  if (state.lastConfirmed) await recheckUnifiedBlock(provider, state.lastConfirmed);
  const submit = async ({label, request, guard}) => {
    const [latest, pendingNonce, estimate, fees, balance, block] = await Promise.all([
      provider.getTransactionCount(operator, 'latest'), provider.getTransactionCount(operator, 'pending'),
      provider.estimateGas({...request, from: operator}), provider.getFeeData(),
      provider.getBalance(operator), provider.getBlock('latest')
    ]);
    if (!Number.isSafeInteger(latest) || latest < 0 || latest !== pendingNonce) {
      throw Error('UNIFIED_KEEPER_PENDING_NONCE_NEEDS_REVIEW');
    }
    const gasLimit = (estimate * 125n + 99n) / 100n, gasPrice = fees.gasPrice;
    if (estimate <= 0n || gasLimit > maxGas || gasLimit > block.gasLimit || !gasPrice ||
        gasPrice <= 0n || gasPrice > maxGasPrice || gasLimit * gasPrice > maxFee) {
      throw Error('UNIFIED_KEEPER_GAS_LIMIT_EXCEEDED');
    }
    if (balance < parseEther('0.001') || balance < gasLimit * gasPrice) throw Error('UNIFIED_KEEPER_TEST_BNB_TOO_LOW');
    await guard();
    const raw = await signer.signTransaction({...request, nonce: latest, type: 0, chainId: 97, gasLimit, gasPrice});
    const hash = Transaction.from(raw).hash;
    const record = {hash, raw, ancestor: label.split('-')[2]};
    const {tx} = inspectSigned(record, operator, state.identity.network);
    if (tx.nonce !== latest || tx.data !== request.data || tx.gasLimit !== gasLimit || tx.gasPrice !== gasPrice) {
      throw Error('UNIFIED_VOLUME_SIGNED_TRANSACTION_MISMATCH');
    }
    state.pendingTransaction = record;
    save(state);
    const response = await provider.broadcastTransaction(raw);
    if (response.hash !== hash) throw Error('UNIFIED_VOLUME_BROADCAST_HASH_MISMATCH');
    await waitReceipt(provider, hash, {confirmations: 3});
    return hash;
  };
  const result = await processUnifiedNetworkVolume({provider, proof, state, save, operator, submit, maxScans, steps});
  if (state.pendingTransaction) {
    await reconcileUnifiedNetworkVolume({provider, proof, operator, state, save});
  }
  const status = result.transactions.length ? 'VOLUME_CONFIRMED' : result.complete ? 'NO_DUE_VOLUME' : 'VOLUME_SCAN_CONTINUES';
  return {...result, status};
}
