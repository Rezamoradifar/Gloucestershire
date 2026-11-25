import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider, Contract, ContractFactory, MaxUint256, ZeroAddress, parseEther} from 'ethers';
import {compilePlanPortfolioTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {UNIFIED_TOKEN} from '../scripts/v3-unified-release-pins.mjs';

const units = value => parseEther(String(value));
const mined = async transaction => (await transaction).wait();

test('V8 enforces the current tier rate across pooled earnings without changing pending payouts or principal', {timeout:300000}, async () => {
  const artifact = compilePlanPortfolioTestnet().GlobalV3PlanPortfolioTestnet;
  const chain = ganache.provider({logging:{quiet:true}, chain:{chainId:97,hardfork:'shanghai'},
    miner:{blockGasLimit:30000000,timestampIncrement:1}});
  const provider = new BrowserProvider(chain, undefined, {cacheTimeout:-1});
  provider.pollingInterval = 20;
  try {
    const [manager, member, child, other, rising, fees] = await provider.listAccounts();
    const mock = JSON.parse(fs.readFileSync('artifacts/MockToken.json'));
    const tokenImplementation = await new ContractFactory(mock.abi, mock.evm.bytecode.object, manager).deploy(18);
    await tokenImplementation.waitForDeployment();
    await chain.request({method:'evm_setAccountCode',params:[UNIFIED_TOKEN, await provider.getCode(tokenImplementation.target)]});
    const token = new Contract(UNIFIED_TOKEN, mock.abi, manager);
    const vault = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, manager)
      .deploy(manager.address, UNIFIED_TOKEN, fees.address);
    await vault.waitForDeployment();
    const account = vault.connect(member);
    const advance = async seconds => {
      await chain.request({method:'evm_increaseTime',params:[seconds]});
      await chain.request({method:'evm_mine',params:[]});
    };
    const rates = () => Promise.all([0,1,2,3,4].map(tier => vault.planWithdrawalBps(tier)));
    assert.equal(await vault.SINGLE_CAPITAL_VERSION(), 8n);
    assert.deepEqual(await rates(), [1000n,1000n,1000n,1000n,1000n]);
    for (const legacy of ['requestProfit','requestProfitFromPage','requestReferral','requestNetworkReward','requestPrincipal','requestPrincipalFromPage']) {
      assert.equal(vault.interface.hasFunction(legacy), false);
    }

    for (const [owner, amount, sponsor] of [[member,1000,ZeroAddress],[child,1000,member.address],[other,200,member.address]]) {
      await mined(token.mint(owner.address, units(amount)));
      await mined(token.connect(owner).approve(vault.target, MaxUint256));
      await mined(vault.connect(owner).deposit(units(amount), sponsor, {gasLimit:7000000}));
      await mined(vault.connect(owner).checkIn());
    }
    assert.equal(await vault.profitWithdrawalCap(member.address), units(100));
    const schedule = [0n,350n,750n,8000n,10000n];
    await assert.rejects(account.setPlanWithdrawalBps.staticCall(schedule));
    await assert.rejects(vault.setPlanWithdrawalBps.staticCall([0,350,750,8000,10001]));
    const change = await mined(vault.setPlanWithdrawalBps(schedule));
    const changeEvent = change.logs.map(log => vault.interface.parseLog(log)).find(log => log?.name === 'PlanWithdrawalBpsChanged');
    assert.deepEqual([...changeEvent.args.rates], schedule);
    assert.deepEqual(await rates(), schedule);

    await mined(vault.connect(rising).register(ZeroAddress));
    await mined(vault.setVipKyc(rising.address,true));
    await mined(token.mint(rising.address,units(50010)));
    await mined(token.connect(rising).approve(vault.target, MaxUint256));
    let previous = 0;
    for (const [balance,tier] of [[500,0],[510,1],[2500,1],[2510,2],[10000,2],[10010,3],[50000,3],[50010,4]]) {
      await mined(vault.connect(rising).deposit(units(balance-previous), ZeroAddress, {gasLimit:7000000}));
      assert.equal(await vault.tierOf(rising.address), BigInt(tier));
      assert.equal(await vault.profitWithdrawalCap(rising.address), units(balance)*schedule[tier]/10000n);
      previous = balance;
    }

    await mined(account.claimNetworkRewards(0,0,1,{gasLimit:3000000}));
    await advance(3601);
    for (const owner of [member,child]) await mined(vault.accrueDaily(owner.address,0,{gasLimit:3000000}));
    const allocation = [units(5),units('.5'),units('29.5'),0n];
    assert.equal(await vault.profitWithdrawalCap(member.address),units(35));
    await assert.rejects(account.requestAccountWithdrawal.staticCall([units(5),units('.5'),units(30),0],0,0));
    await mined(account.requestAccountWithdrawal(allocation,0,0,{gasLimit:2800000}));
    assert.deepEqual([...(await vault.withdrawalAllocation(0))],allocation);
    await mined(vault.setPlanWithdrawalBps([0,0,0,0,0]));
    assert.equal(await vault.profitWithdrawalCap(member.address),0n);
    await mined(vault.approveWithdrawal(0));
    await mined(token.mint(manager.address,units(35)));
    await mined(token.approve(vault.target,units(35)));
    await mined(vault.fundWithdrawal(0));
    await mined(vault.payWithdrawal(0));
    assert.equal(await token.balanceOf(member.address),units('34.3'));

    await mined(account.reinvestAccountEarnings([{positionId:0,amount:units(1),start:0,limit:1}],0,0,{gasLimit:3000000}));
    await mined(vault.setPlanWithdrawalBps(schedule));
    assert.equal(await vault.profitWithdrawalCap(member.address),units('35.035'));
    await advance(90*86400);
    await mined(vault.setPlanWithdrawalBps([0,0,0,0,0]));
    await assert.rejects(account.requestAccountWithdrawal.staticCall([units(1),0,0,units(10)],0,0));
    await mined(account.requestAccountWithdrawal([0,0,0,units(10)],0,0,{gasLimit:2800000}));
    assert.equal((await vault.withdrawalOf(1)).fee,units(3));
  } finally {
    provider.destroy();
    await chain.disconnect();
  }
});
