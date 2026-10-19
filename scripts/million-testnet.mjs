// One million TEST USDT in 20 new accounts. Testnet 97 only; no real-dollar funding.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet,JsonRpcProvider,Contract,ZeroAddress,parseEther,formatEther,getAddress} from 'ethers';
import {verifyTestDeployment} from './test-live-testnet.mjs';
import {createJournalSender,save,check} from './testnet-journal.mjs';
import {reportHtml} from './live-plan-test.mjs';
const E=parseEther,COUNT=20,AMOUNT=E('50000'),BUDGET=E('0.08');
const TARGET='0x7f19354B765920B9b17003d0840EEaA133883DcA';
const TESTER='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';

export async function runMillion({provider,wallet,config,deployment,artifacts,dir,afterBroadcast}){
 const {v,addresses,destination}=await verifyTestDeployment({provider,wallet,config,deployment,artifacts});
 const token=new Contract(addresses[0],artifacts.MockToken.abi,provider),root=wallet.connect(provider);
 check(await v.NETWORK_PLAN_VERSION()===2n&&await token.decimals()===18n,'Unexpected network plan or TEST token');
 const journal=path.join(dir,'million-private.json'),publicFile=path.join(dir,'million-public.json');
 let state=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal)):null;
 if(state)check(state.version===1&&state.contract===v.target&&state.tester===root.address&&state.keys.length===COUNT,'Saved million test does not match this contract or wallet');
 if(state?.status==='completed'){
  const report=JSON.parse(fs.readFileSync(publicFile));
  check(report.status==='completed'&&report.contract===v.target&&report.totalDepositedTestUsdt==='1000000','Completed report mismatch');
  console.log('Million test already completed. No new deposits sent.');return report;
 }
 check(!await v.paused(),'Contract is paused');
 check(await v.minDepositUsd()<=AMOUNT,'Minimum deposit changed');
 const minima=[E('10'),E('500')+1n,E('2500')+1n,E('10000')+1n,E('50000')+1n];
 for(let i=0;i<5;i++)check((await v.tierConfig(i)).minUsd===minima[i],'Tier thresholds changed; review before testing');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(!state){
  check(await provider.getBalance(root.address)>=BUDGET,`TEST deployer ${root.address} needs at least 0.08 tBNB before this run`);
  const block=await provider.getBlock('latest'),user=await v.users(root.address);
  state={version:1,chainId:97,contract:v.target,tester:root.address,status:'running',startedAt:new Date().toISOString(),feedTime:block.timestamp,
   registerRoot:!user.registered,keys:Array.from({length:COUNT},()=>Wallet.createRandom().privateKey),steps:[]};
  save(journal,state);
 }
 const wallets=state.keys.map(k=>new Wallet(k,provider));
 check(new Set(wallets.map(w=>w.address)).size===COUNT&&!wallets.some(w=>w.address===root.address),'Test accounts must be unique');
 const report={title:'One million test tokens report',environment:'BNB TESTNET ONLY — 1,000,000 TEST USDT; no real-dollar deposits or real sales',chainId:97,contract:v.target,tester:root.address,
  startedAt:state.startedAt,status:'running',accountCount:COUNT,perAccountTestUsdt:'50000',totalDepositedTestUsdt:'0',accounts:[],transactions:[],checks:[],
  notTested:['Real capital inflow or commerce','Seller commission settlement and reward-stage claims','Withdrawals, VIP approval, and mobile-wallet connection','Independent financial or security audit']};
 const record=()=>{report.transactions=state.steps.map(({name,hash,blockNumber})=>({name,hash,blockNumber:blockNumber??null,url:`https://testnet.bscscan.com/tx/${hash}`}));save(publicFile,report);};
 const send=createJournalSender({provider,state,journal,record,afterBroadcast,maxCost:BUDGET,maxGasPrice:E('0.000000001')});
 const call=(name,signer,c,method,args)=>send(name,signer,{to:c.target,data:c.interface.encodeFunctionData(method,args)});
 const logs=(receipt,c,name)=>receipt.logs.filter(l=>l.address.toLowerCase()===c.target.toLowerCase()).map(l=>{try{return c.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name===name);
 try{
  const feed=new Contract(addresses[2],artifacts.MockFeed.abi,provider);
  await call('Refresh TEST token price',root,feed,'set',[100000000n,state.feedTime,1,1]);
  check(await v.quoteUsd(token.target,AMOUNT)===AMOUNT,'TEST oracle stale or changed; preserve journal and inspect');
  if(state.registerRoot)await call('Register test network root',root,v,'register',[ZeroAddress]);
  for(let i=0;i<COUNT;i++){
   const w=wallets[i],n=i+1;
   await send(`Account ${n}: test gas`,root,{to:w.address,value:E('0.002')});
   await call(`Account ${n}: mint 50000 TEST USDT`,root,token,'mint',[w.address,AMOUNT]);
   await call(`Account ${n}: approve deposit`,w,token,'approve',[v.target,AMOUNT]);
   const receipt=await call(`Account ${n}: deposit 50000 TEST USDT`,w,v,'deposit',[token.target,AMOUNT,root.address]);
   const deposited=logs(receipt,v,'Deposited').find(e=>e.args.user===w.address),transfers=logs(receipt,token,'Transfer');
   check(deposited?.args.amount===AMOUNT&&deposited.args.usd===AMOUNT&&deposited.args.feeEach===AMOUNT/10n,'Deposit event mismatch for account '+n);
   for(let j=0;j<3;j++)check(transfers.some(e=>e.args.from===v.target&&e.args.to===destination[j]&&e.args.value===(j===2?AMOUNT*8n/10n:AMOUNT/10n)),'80/10/10 routing mismatch for account '+n);
   const at={blockTag:receipt.blockNumber},a=await v.accounts(w.address,token.target,at),u=await v.users(w.address,at);
   check(a.principal===AMOUNT&&a.externalDeposited===AMOUNT&&a.profit===0n&&u.capitalUsd===AMOUNT&&u.referrer===root.address,'Account credit mismatch for '+n);
   check(await v.tierOf(w.address,at)===3n&&!u.vipKyc,'Unexpected tier or VIP state');
   check(await v.branchVolumeUsd(root.address,w.address,at)===AMOUNT,'Branch volume mismatch for '+n);
   report.accounts.push({index:n,address:w.address,referrer:root.address,testUsdt:'50000',principal:formatEther(a.principal),tier:4,transaction:receipt.hash,blockNumber:receipt.blockNumber});
   report.totalDepositedTestUsdt=String(report.accounts.length*50000);report.blockNumber=receipt.blockNumber;
   record();console.log(`CONFIRMED ${n}/20 — ${report.totalDepositedTestUsdt} TEST USDT deposited`);
  }
  const at={blockTag:report.blockNumber};let total=0n;
  for(const w of wallets)total+=(await v.accounts(w.address,token.target,at)).principal;
  check(total===E('1000000'),'Final sum is not exactly 1,000,000');
  report.checks=[{name:'20 distinct test accounts, each with 50,000 TEST USDT principal',status:'PASS'},
   {name:'Exactly 1,000,000 TEST USDT deposited and 1,000,000 USD test branch volume added',status:'PASS'},
   {name:'800,000 TEST USDT routed to operations; 100,000 to each deposit fee wallet',status:'PASS'},
   {name:'No reward, yield, seller commission, or VIP approval was fabricated',status:'PASS'}];
  report.routing={operationsTestUsdt:'800000',feeWallet1TestUsdt:'100000',feeWallet2TestUsdt:'100000'};
  report.status='completed';report.completedAt=new Date().toISOString();record();state.status='completed';save(journal,state);
  console.log('MILLION_TEST_READY '+publicFile);return report;
 }catch(e){report.status='incomplete';record();throw e;}
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function millionHtml(r){
 const table=`<section><h2>20 accounts · 50,000 test tokens each</h2><p>Verified total: ${esc(r.totalDepositedTestUsdt)} TEST USDT</p><p>All amounts are for testing. Recorded principal does not imply cash held in the treasury.</p><ol class="en">${r.accounts.map(a=>`<li>Account ${a.index} · 50,000 TEST USDT<br><a href="https://testnet.bscscan.com/address/${esc(a.address)}">${esc(a.address)}</a><br><a href="https://testnet.bscscan.com/tx/${esc(a.transaction)}">Deposit transaction</a></li>`).join('')}</ol></section>`;
 return reportHtml(r).replace('<h1>Live plan test report</h1>','<h1>One million test tokens across 20 accounts</h1>').replace('<section><h2>Verified calculations</h2>',table+'<section><h2>Verified calculations</h2>');
}
async function main(){
 const dir=path.resolve(process.argv[2]||'/root/global-testnet-v071/.testnet-server'),key=path.join(dir,'deployer.key');
 check(fs.existsSync(key)&&fs.lstatSync(key).isFile()&&(fs.statSync(key).mode&0o077)===0,'Existing test deployer key missing or not private (600)');
 const wallet=new Wallet(fs.readFileSync(key,'utf8').trim());check(wallet.address===TESTER,'Only the existing TEST-ONLY DEPLOYER is allowed');
 const deployment=JSON.parse(fs.readFileSync(path.join(dir,'deployment-public.json')));
 check(deployment.chainId===97&&getAddress(deployment.contractAddress)===TARGET,'Wrong current testnet deployment');
 const config=JSON.parse(fs.readFileSync('config.example.json'));
 const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 const provider=new JsonRpcProvider(process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org',undefined,{cacheTimeout:-1});provider.pollingInterval=2500;
 try{
  const output=path.join(dir,'million-test-v1'),report=await runMillion({provider,wallet,config,deployment,artifacts,dir:output});
  fs.writeFileSync(path.join(output,'million-public.html'),millionHtml(report),{mode:0o600});
 }finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.code==='CALL_EXCEPTION'?'Contract call reverted; inspect the saved public report.':e.code||e.message);process.exitCode=1;});
