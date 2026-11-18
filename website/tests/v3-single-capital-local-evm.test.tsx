import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,formatUnits,keccak256,parseEther} from 'ethers';
// The worker and deployer share the root ethers package instance.
import {Wallet as RootWallet} from '../../node_modules/ethers/lib.esm/index.js';
import {compileSingleCapitalTestnet} from '../../scripts/compile-global-v3-unified-testnet.mjs';
import {runUnifiedKeeperCycle} from '../../scripts/run-v3-unified-keeper-cycle.mjs';
import {deployUnifiedIsolated,verifyUnifiedRelease} from '../../scripts/deploy-v3-unified-isolated.mjs';
import {planUnifiedPreviewSite} from '../../scripts/v3-unified-site-preview-preflight.mjs';
import {SINGLE_CAPITAL_PROFILE,UNIFIED_MANAGER,UNIFIED_TOKEN} from '../../scripts/v3-unified-release-pins.mjs';
import V3AccountWithdrawalForm from '../src/V3AccountWithdrawalForm';
import V3UnifiedPositionPage from '../src/V3UnifiedPositionPage';
import {primaryReleaseEnv} from '../../scripts/publish-v3-single-capital-primary.mjs';

const local=vi.hoisted(()=>({rpc:null as any}));
vi.mock('ethers',async importOriginal=>{
 const real=await importOriginal<typeof import('ethers')>();
 class LocalReader extends real.BrowserProvider{
  constructor(){super(local.rpc,undefined,{cacheTimeout:-1});this.pollingInterval=20;}
 }
 return {...real,JsonRpcProvider:LocalReader};
});

describe('one verified capital account on chain 97',()=>{
 it('adds 1,000 and 2,000 to the same account, accrues both, adds reinvestment, and withdraws the pooled profit',async()=>{
  vi.stubEnv('VITE_V3_HOURLY_TEST','isolated-1h');
  const {default:V3CycleCard}=await import('../src/V3CycleCard');
  const {v3ParseReleaseConfig,unifiedWalletEnabled}=await import('../src/v3-site-config');
  const {runV3Deposit}=await import('../src/v3-account-flow');
  const {readV3Snapshot}=await import('../src/v3-chain');
  const {sendV3UnifiedCheckIn}=await import('../src/v3-unified-checkin');
  const {runUnifiedReinvestment}=await import('../src/v3-unified-reinvestment-flow');
  const {sendV3UnifiedPageWithdrawal}=await import('../src/v3-actions');
  const {planV3AccountWithdrawal,summarizeV3AccountWithdrawal}=await import('../src/v3-account-withdrawal');
  const {sendUnifiedWithdrawal}=await import('../src/v3-unified-settlement');
  const previous=process.cwd();
  let artifacts;
  try{process.chdir('..');artifacts=compileSingleCapitalTestnet();}finally{process.chdir(previous);}
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},
   chain:{chainId:97,hardfork:'shanghai',time:new Date('2026-10-31T23:40:00Z')},
   miner:{timestampIncrement:0,blockGasLimit:30_000_000},wallet:{totalAccounts:3,defaultBalance:50,unlockedAccounts:[UNIFIED_MANAGER]}});
  local.rpc=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});rpc.pollingInterval=20;
  const journalDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'single-capital-'));
  const mine=async(count=6)=>{for(let i=0;i<count;i++)await eip.request({method:'evm_mine',params:[]});};
  const advance=async(seconds:number)=>{
   await eip.request({method:'evm_increaseTime',params:[seconds]});await mine();
  };
  try{
   const deployer=await rpc.getSigner(0),user=await rpc.getSigner(1),wallet=await user.getAddress();
   const accounts=Object.values(eip.getInitialAccounts());
   const keeper=new RootWallet(accounts[2].secretKey,rpc),deploySigner=new RootWallet(accounts[0].secretKey,rpc);
   const mock=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,deployer).deploy(18);
   await mock.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[UNIFIED_TOKEN,await rpc.getCode(mock.target)]});
   const token=new Contract(UNIFIED_TOKEN,tokenArtifact.abi,deployer);
   const contract=artifacts.GlobalV3SingleCapitalTestnet;
   const waitReceipt=async(provider:any,hash:string)=>{await mine();return provider.getTransactionReceipt(hash);};
   await mine();
   const proof=await deployUnifiedIsolated({provider:rpc,signer:deploySigner,
    directory:path.join(journalDirectory,'deployment'),expectedDeployer:deploySigner.address,
    profile:SINGLE_CAPITAL_PROFILE,compile:()=>artifacts,waitReceipt});
   const {vault:address,book:bookAddress,network}=proof;
   const vault=new Contract(address,contract.abi,deployer);
   const book=new Contract(bookAddress,artifacts.SingleCapitalBook.abi,rpc);
   const release=primaryReleaseEnv(proof,keeper.address,'disabled');
   const config=v3ParseReleaseConfig({address:release.VITE_V3_CONTRACT_ADDRESS,
    runtimeHash:release.VITE_V3_RUNTIME_HASH,deploymentTx:release.VITE_V3_DEPLOYMENT_TX,
    unifiedMode:release.VITE_V3_UNIFIED_MODE,book:release.VITE_V3_UNIFIED_BOOK,
    bookRuntimeHash:release.VITE_V3_UNIFIED_BOOK_HASH,network:release.VITE_V3_UNIFIED_NETWORK,
    networkRuntimeHash:release.VITE_V3_UNIFIED_NETWORK_HASH,keeper:release.VITE_V3_UNIFIED_KEEPER});
   if(!config)throw Error('Expected a verified primary investment account.');
   expect(unifiedWalletEnabled(config,'/',true,release.VITE_V3_PRIMARY_DASHBOARD,
    release.VITE_V3_UNIFIED_WALLET_ACTIONS,release.VITE_V3_UNIFIED_PRIMARY)).toBe(true);
   expect(keccak256(await rpc.getCode(address))).toBe(config.runtimeHash);
   const sender=await deployer.getAddress();
   await expect(verifyUnifiedRelease(rpc,proof,sender)).rejects.toThrow(/PROFILE_MISMATCH/);
   expect((await verifyUnifiedRelease(rpc,proof,sender,SINGLE_CAPITAL_PROFILE)).proof.vault).toBe(address);
   const preview=await planUnifiedPreviewSite({provider:rpc,proof,sourceSha:'a'.repeat(40),
    expectedSourceSha:'a'.repeat(40),profile:SINGLE_CAPITAL_PROFILE});
   expect(preview.routeCandidate).toBe('/single-capital-test/');
   expect(preview.env.VITE_V3_UNIFIED_MODE).toBe('single-capital-testnet');

   const walletProvider={request:async({method,params}:any)=>{
    const result=await eip.request({method,params:params||[]});
    if(method==='eth_sendTransaction')await mine();
    return result;
   }};
   const snapshot=()=>readV3Snapshot(walletProvider as any,wallet,config,null,0,true);
   const deposit=(amount:string)=>runV3Deposit({provider:walletProvider as any,wallet,referrer:ZeroAddress,
    amount:parseEther(amount),config,unifiedEnabled:true});
   const tick=()=>runUnifiedKeeperCycle({provider:rpc,signer:keeper,proof,
    journalDirectory:path.join(journalDirectory,'keeper'),waitReceipt});
   const expectAccrual=async()=>{
    const result=await tick();
    expect(result.state).toBe('CONFIRMED_CHECKPOINT_RECORDED');
    expect(result.transactionSent).toBe(true);
   };
   await (await token.mint(wallet,parseEther('3000'))).wait();
   await eip.request({method:'evm_setAccountBalance',params:[keeper.address,'0x0']});
   await mine();
   expect((await snapshot()).keeper?.gasWei).toBe(0n);
   await deposit('1000');
   await sendV3UnifiedCheckIn(walletProvider as any,wallet,config,{enabled:true});
   await advance(3599);
   expect((await tick()).state).toBe('IDLE_CHECKPOINT_RECORDED');
   expect((await vault.positionOf(wallet,0)).availableProfit).toBe(0n);
   await advance(1);
   await expect(tick()).rejects.toThrow('UNIFIED_KEEPER_TEST_BNB_TOO_LOW');
   expect((await vault.positionOf(wallet,0)).availableProfit).toBe(0n);
   await eip.request({method:'evm_setAccountBalance',params:[keeper.address,'0x56bc75e2d63100000']});
   await mine();
   await expectAccrual();
   expect((await vault.positionOf(wallet,0)).availableProfit).toBe(parseEther('7'));

   await deposit('2000');
   expect(await vault.positionCount(wallet)).toBe(1n);
   expect(await vault.reinvestmentPositionPlusOne(wallet)).toBe(1n);
   expect(await vault.effectiveDailyBps(wallet)).toBe(90n);
   expect((await vault.positionOf(wallet,0)).principal).toBe(parseEther('3000'));
   expect((await book.lot(wallet,1)).basis).toBe(0n);
   expect((await tick()).state).toBe('IDLE_CHECKPOINT_RECORDED');
   await advance(3601);
   await expectAccrual();
   expect((await tick()).state).toBe('IDLE_CHECKPOINT_RECORDED');
   expect((await vault.positionOf(wallet,0)).availableProfit).toBe(parseEther('34.063'));
   expect((await vault.positionOf(wallet,0)).cumulativeDaily).toBe(parseEther('34'));

   const reinvested=await runUnifiedReinvestment({enabled:true,provider:walletProvider as any,wallet,
    amount:parseEther('4'),config});
   expect(reinvested.destination).toBe(0);
   const view=await snapshot();
   expect(view.singleCapital).toBe(true);
   const clock=renderToStaticMarkup(<V3CycleCard view={view} busy={false} unifiedEnabled onCheckIn={()=>{}} onPositions={()=>{}}/>);
   expect(clock).toContain('YOUR ONE-HOUR TEST CYCLE');
   expect(clock).toContain('Estimated time remaining 01:00:00');
   expect(view.capital).toBe(parseEther('3004'));
   expect(view.originalDeposits).toBe(parseEther('3000'));
   expect(view.reinvestments).toBe(parseEther('4'));
   expect(view.positions).toHaveLength(1);
   expect(view.unifiedPage?.totalLots).toBe(3);
   expect(view.unifiedPage?.lots.map(lot=>lot.principal)).toEqual(['1000','2000','4'].map(parseEther));
   expect(view.unifiedPage?.lots[1].unlockAt).toBeGreaterThan(view.unifiedPage!.lots[0].unlockAt);
   const totals=summarizeV3AccountWithdrawal(view,true);
   const times=renderToStaticMarkup(<V3UnifiedPositionPage page={view.unifiedPage!} singleCapital onPrevious={()=>{}} onNext={()=>{}}/>);
   expect(times).toContain('Opened 2026-10-31 23:40:00 UTC');
   expect(times).toContain('Opened 2026-11-01 00:40:00 UTC');
   expect(times).toContain('Principal unlock at 2027-01-29 23:40:00 UTC');
   expect(totals.maturedPrincipal).toBe(0n);
   expect(totals.profit).toBe(parseEther('30.063'));
   expect(totals.maxProfit).toBe(totals.profit);
   expect(view.unifiedPage!.lots.every(lot=>lot.daily+lot.compound<totals.maxProfit)).toBe(true);
   const value=formatUnits(totals.maxProfit,18);
   const html=renderToStaticMarkup(<V3AccountWithdrawalForm view={view} unified busy={false} readOnly={false}
    value={value} kind="profit" onKind={()=>{}} onValue={()=>{}} onSubmit={()=>{}}/>);
   expect(html).toContain('3004.0 USDT');expect(html).toContain('30.063 USDT');
   expect(html).not.toMatch(/Position #|Source position/);
   const plan=planV3AccountWithdrawal(view,value,'profit',true);
   if(plan.source!=='book')throw Error('Expected the sole account ledger.');
   expect(plan.page.positionId).toBe(0);expect(plan.page.limit).toBe(16);
   const requested=await sendV3UnifiedPageWithdrawal(walletProvider as any,wallet,plan.kind,plan.page.positionId,
    plan.page.start,plan.amount,config,{enabled:true});
   const withdrawal=await vault.withdrawalOf(requested.id);
   const afterRequest=await snapshot();
   expect(afterRequest.nextRequestAt).toBe(Number(withdrawal.requestedAt)+72*3600);
   const cooldown=renderToStaticMarkup(<V3AccountWithdrawalForm view={afterRequest} unified busy={false} readOnly={false}
    value="" kind="profit" onKind={()=>{}} onValue={()=>{}} onSubmit={()=>{}}/>);
   expect(cooldown).toContain('Withdrawal cooldown ends at 2026-11-04 01:40:01 UTC');
   expect(withdrawal.gross).toBe(totals.profit);
   expect(withdrawal.positionId).toBe(0n);
   expect((await vault.positionOf(wallet,0)).availableProfit).toBe(0n);
   expect((await vault.positionOf(wallet,0)).reservedProfit).toBe(totals.profit);
   expect(await token.balanceOf(wallet)).toBe(0n);
   await expect(sendUnifiedWithdrawal(walletProvider as any,wallet,{kind:'payWithdrawal',id:Number(requested.id)},config,
    {enabled:true})).rejects.toThrow();
   await eip.request({method:'evm_setAccountBalance',params:[UNIFIED_MANAGER,'0x56bc75e2d63100000']});
   await (await token.mint(UNIFIED_MANAGER,totals.profit)).wait();
   const manager=await rpc.getSigner(UNIFIED_MANAGER);
   await (await vault.connect(manager).getFunction('approveWithdrawal')(requested.id)).wait();
   await (await token.connect(manager).getFunction('approve')(address,totals.profit)).wait();
   await (await vault.connect(manager).getFunction('fundWithdrawal')(requested.id)).wait();
   await (await vault.payWithdrawal(requested.id)).wait();
   expect(await token.balanceOf(wallet)).toBe(totals.profit-requested.fee);
   expect((await vault.positionOf(wallet,0)).reservedProfit).toBe(0n);
   await advance(3601);
   await expectAccrual();
   expect((await vault.positionOf(wallet,0)).availableProfit).toBe(parseEther('27.036'));
   const now=(await rpc.getBlock('latest'))!.timestamp;
   await advance(view.unifiedPage!.lots[0].unlockAt-now+1);
   const partiallyMatured=await snapshot();
   expect(summarizeV3AccountWithdrawal(partiallyMatured,true).maxPrincipal).toBe(parseEther('1000'));
   expect(()=>planV3AccountWithdrawal(partiallyMatured,'1001','principal',true)).toThrow(/unlocked account principal/);
  }finally{
   rpc.destroy();await (eip as any).disconnect();vi.unstubAllEnvs();
   fs.rmSync(journalDirectory,{recursive:true,force:true});
  }
 },240_000);
});
