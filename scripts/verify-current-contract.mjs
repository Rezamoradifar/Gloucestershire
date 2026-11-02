// Read-only exact creation proof and current permission/configuration inspection.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {Contract,FetchRequest,JsonRpcProvider,ZeroAddress,formatUnits} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {getZeroStartProfile} from './zero-start-profile.mjs';
import {verifyZeroStartTarget} from './zero-start-readiness.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
const expected='0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B';
function read(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)||s.size>16777216)throw Error('PRIVATE_AUDIT_INPUT_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
let provider,proof=[];
try{
 if(process.getuid?.()!==0||process.argv.slice(2).join(' ')!=='--check')throw Error('ROOT_READ_ONLY_CHECK_REQUIRED');
 const profile=getZeroStartProfile(true),original=read('/etc/globaldroptrade/trades.env'),cfg=readConfig(parseEnv(original));
 if(cfg.chainId!==97||cfg.address.toLowerCase()!==expected.toLowerCase())throw Error('EXPECTED_CURRENT_TESTNET_REQUIRED');
 const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl));
 const request=new FetchRequest(cfg.rpcUrl);request.timeout=15000;
 provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});proof=createZeroStartProofProviders();
 const verified=await verifyZeroStartTarget({provider,artifact,deploymentReport:JSON.parse(read(profile.stateDir+'/deployment-public.json')),connectionReport:JSON.parse(read(profile.stateDir+'/connection-public.json')),original,release:profile.release,confirmations:Math.max(3,cfg.confirmations),proofProviders:proof,inspectSettlementLogs:false});
 const block=await provider.getBlock('latest'),o={blockTag:block.number},vault=new Contract(expected,artifact.abi,provider);
 const [owner,operatorAuthorized,paused,profitFee,principalDeduction,lockDuration,cooldown,minDeposit]=await Promise.all([
 vault.owner(o),vault.reporters(profile.release.deployer,o),vault.paused(o),vault.profitFeeBps(o),vault.principalPenaltyBps(o),vault.lockDuration(o),vault.withdrawalCooldown(o),vault.minDepositUsd(o)
 ]);
 const tiers=[];for(let i=0;i<5;i++){const t=await vault.tierConfig(i,o);tiers.push({tier:i,minUsd:formatUnits(t.minUsd,18),baseRateBps:Number(t.baseDailyBps),maximumRateBps:Number(t.maxDailyBps),requiredDirects:Number(t.requiredDirect),requiredVolumeUsd:formatUnits(t.requiredSalesUsd,18),referralBps:Array.from(t.referrals,Number)});}
 const funding=[];for(const asset of [ZeroAddress,profile.release.token]){const [cash,l]=await Promise.all([vault.assetBalance(asset,o),vault.ledgers(asset,o)]);funding.push({asset,cashUnits:String(cash),principalUnits:String(l.principal),profitUnits:String(l.profit),rewardBudgetUnits:String(l.rewards),feeReserveUnits:String(l.feeReserve)});}
 if((await provider.getBlock(block.number))?.hash!==block.hash)throw Error('AUDIT_CURRENT_BLOCK_REORG');
 console.log('CONTRACT_IDENTITY_MATCHED');
 console.log(JSON.stringify({version:1,scope:'current-testnet-only',chainId:97,target:verified.target,creationTransaction:verified.hash,deploymentBlock:verified.block,artifactHash:verified.artifactHash,initcodeHash:verified.initcodeHash,runtimeHash:verified.runtimeHash,withdrawalQueue:verified.queue,owner,operator:profile.release.deployer,operatorAuthorized,paused,checkpoint:{block:block.number,hash:block.hash},terms:{profitFeeBps:Number(profitFee),principalDeductionBps:Number(principalDeduction),lockSeconds:Number(lockDuration),cooldownSeconds:Number(cooldown),minDepositUsd:formatUnits(minDeposit,18)},tiers,funding,sourcePermissions:{ownerCanWithdrawAllLiquidAssets:true,principalCashProtected:false,reporterCanCreditFundedRewards:true,ownerApprovalRequiredForWithdrawal:true},independentSecurityAudit:false,mainnetVerified:false,transactionsSent:0,signerOpened:false},null,2));
}catch(e){console.log('CONTRACT_MATCH_NOT_CONFIRMED '+(/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));process.exitCode=1;}
finally{await provider?.destroy();for(const p of proof)await p.destroy();}
