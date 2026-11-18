import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider, Contract, ContractFactory, Wallet, ZeroAddress, keccak256, parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {processUnifiedNetworkVolume, reconcileUnifiedNetworkVolume, runUnifiedNetworkVolume} from '../scripts/process-v3-unified-network-volume.mjs';

const tokenAddress = '0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';

test('deep referral volume is continued on the verified network component and resumes without duplicate credit', async () => {
  const rpc = ganache.provider({
    logging: {quiet: true}, chain: {chainId: 97, hardfork: 'shanghai'},
    miner: {blockGasLimit: 30000000}, wallet: {totalAccounts: 12, defaultBalance: 10}
  });
  const provider = new BrowserProvider(rpc, undefined, {cacheTimeout: -1});
  provider.pollingInterval = 20;
  try {
    const mine = async () => {
      for (let i = 0; i < 3; i++) await rpc.request({method: 'evm_mine', params: []});
    };
    const accounts = await provider.listAccounts();
    const [manager, keeper, ...members] = accounts;
    const artifact = compileUnifiedTestnet().GlobalV3UnifiedTestnet;
    const tokenArtifact = JSON.parse(fs.readFileSync('artifacts/MockToken.json'));
    const original = await new ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, manager).deploy(18);
    await original.waitForDeployment();
    await rpc.request({method: 'evm_setAccountCode', params: [tokenAddress, await provider.getCode(original.target)]});
    const vault = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, manager)
      .deploy(manager.address, tokenAddress, manager.address, {gasLimit: 25000000});
    const receipt = await vault.deploymentTransaction().wait();
    const network = await vault.networkPlan();
    const book = await vault.reinvestmentBook();
    const proof = {
      status: 'VERIFIED_UNIFIED_TESTNET_ONLY', chainId: 97, vault: vault.target, book, network, token: tokenAddress,
      manager: manager.address, feeReceiver: manager.address, deploymentTx: receipt.hash, deploymentBlock: receipt.blockNumber,
      vaultRuntimeHash: keccak256(await provider.getCode(vault.target)), bookRuntimeHash: keccak256(await provider.getCode(book)),
      networkRuntimeHash: keccak256(await provider.getCode(network))
    };
    const token = new Contract(tokenAddress, tokenArtifact.abi, manager);
    const volume = new Contract(network, ['function branchVolumeUsd(address,address) view returns(uint256)'], provider);
    let parent = ZeroAddress;
    for (const member of members.slice(0, -1)) {
      await (await vault.connect(member).register(parent)).wait();
      parent = member.address;
    }
    const last = members.at(-1);
    const amount = parseEther('100');
    await (await token.mint(last.address, amount)).wait();
    await (await token.connect(last).approve(vault.target, amount)).wait();
    await (await vault.connect(last).deposit(amount, parent)).wait();
    await mine();
    const readVolume = () => volume.branchVolumeUsd(members[0].address, members[1].address);
    assert.equal(await readVolume(), 0n);
    const state = {};
    const dry = await processUnifiedNetworkVolume({provider, proof, state});
    assert.equal(dry.backlog, '1');
    assert.deepEqual(state, {});
    const signer = new Wallet(rpc.getInitialAccounts()[keeper.address.toLowerCase()].secretKey, provider);
    let persisted = {};
    const save = value => {persisted = structuredClone(value);};
    const run = overrides => runUnifiedNetworkVolume({provider, proof, state, save, signer, ...overrides});
    const managerKey = rpc.getInitialAccounts()[manager.address.toLowerCase()].secretKey;
    await assert.rejects(run({signer: new Wallet(managerKey, provider)}), /UNPRIVILEGED/);
    await assert.rejects(run({proof: {...proof, networkRuntimeHash: proof.bookRuntimeHash}}), /RUNTIME_MISMATCH/);
    const nonce = await provider.getTransactionCount(keeper.address);
    await assert.rejects(run({save: value => {
      save(value);
      if (value.pendingTransaction) throw Error('STOP_AFTER_DURABLE_SAVE');
    }}), /STOP_AFTER_DURABLE_SAVE/);
    assert.ok(persisted.pendingTransaction.hash);
    assert.equal(await provider.getTransactionCount(keeper.address), nonce);
    const resume = overrides => reconcileUnifiedNetworkVolume({
      provider, proof, operator: keeper.address, state: persisted, save, ...overrides
    });
    await assert.rejects(resume({}), /PENDING_TRANSACTION/);
    assert.equal(await provider.getTransactionCount(keeper.address), nonce);
    const expectedHash = persisted.pendingTransaction.hash;
    const done = await resume({resume: true, waitReceipt: async () => {await mine();}});
    assert.deepEqual(done, {status: 'VOLUME_CONFIRMED', hash: expectedHash});
    assert.equal(persisted.pendingTransaction, undefined);
    assert.equal(await provider.getTransactionCount(keeper.address), nonce + 1);
    assert.equal(await readVolume(), amount);
    const resumed = await run({state: persisted});
    assert.equal(resumed.complete, true);
    assert.equal(resumed.status, 'NO_DUE_VOLUME');
    assert.equal(await provider.getTransactionCount(keeper.address), nonce + 1);
    assert.equal(await readVolume(), amount);

    await (await token.mint(last.address, amount)).wait();
    await (await token.connect(last).approve(vault.target, amount)).wait();
    await (await vault.connect(last).deposit(amount, parent)).wait();
    await mine();
    const next = await run({state: persisted, waitReceipt: async () => {await mine();}});
    assert.equal(next.status, 'VOLUME_CONFIRMED');
    assert.equal(next.complete, true);
    assert.equal(next.transactions.length, 1);
    assert.equal(persisted.pendingTransaction, undefined);
    assert.equal(await provider.getTransactionCount(keeper.address), nonce + 2);
    assert.equal(await readVolume(), amount * 2n);
  } finally {
    provider.destroy();
    await rpc.disconnect();
  }
});
