// Explicit testnet transactions. Never deploys or changes the vault configuration.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet,JsonRpcProvider,Contract,Transaction,ZeroAddress,parseEther,formatEther,getAddress,keccak256} from 'ethers';
import {verifyTestDeployment} from './test-live-testnet.mjs';

const E=parseEther,MAX_COST=E('0.03');
const TARGET='0x7f19354B765920B9b17003d0840EEaA133883DcA';
const TESTER='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
const stringify=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
function save(file,value){fs.writeFileSync(file+'.tmp',stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);}
function check(ok,message){if(!ok)throw Error(message);}

export async function runLivePlan({provider,wallet,config,deployment,artifacts,dir,afterBroadcast}){
 const {v,addresses}=await verifyTestDeployment({provider,wallet,config,deployment,artifacts});
 const token=new Contract(addresses[0],artifacts.MockToken.abi,provider);
 check(await v.NETWORK_PLAN_VERSION()===2n,'Unexpected network plan version');
 check(await v.profitFeeBps()===500n && await v.withdrawalCooldown()===259200n,'Withdrawal terms changed; stop for review');
 check(await token.decimals()===18n,'Unexpected TEST token decimals');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const journal=path.join(dir,'plan-private.json'),publicFile=path.join(dir,'plan-public.json');
 let state=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal)):null;
 if(state)check(state.version===1 && state.contract===v.target && state.tester===wallet.address,'Saved test belongs to a different contract/wallet');
 if(state?.status==='completed'){
  const report=JSON.parse(fs.readFileSync(publicFile));
  check(report.status==='completed'&&report.contract===v.target&&report.tester===wallet.address,'Completed report mismatch');
  console.log('Previously completed. No new transactions sent.');return report;
 }
 check(!await v.paused(),'Contract is paused');
 if(!state){
  const block=await provider.getBlock('latest'),account=await v.accounts(wallet.address,token.target),u=await v.users(wallet.address);
  check(account.nextWithdrawal<=BigInt(block.timestamp),'Tester is in withdrawal cooldown; wait before starting');
  check(await provider.getBalance(wallet.address)>=MAX_COST,`Fund TEST-ONLY DEPLOYER ${wallet.address} with at least 0.03 tBNB`);
  check(u.capitalUsd+E('105')<E('50000')+1n || u.vipKyc,'Tester would enter an unapproved VIP tier');
  state={version:1,chainId:97,contract:v.target,tester:wallet.address,status:'running',startedAt:new Date().toISOString(),
   children:[Wallet.createRandom().privateKey,Wallet.createRandom().privateKey],steps:[],feedTime:block.timestamp,
   group:String(await v.rewardGroupCount(wallet.address)),referrer:u.registered?u.referrer:ZeroAddress,
   before:{principal:account.principal,profit:account.profit,reinvested:await v.cumulativeReinvested(wallet.address,token.target),cap:await v.profitWithdrawalCap(wallet.address,token.target)}};
  save(journal,state);
 }
 const children=state.children.map(k=>new Wallet(k,provider)),root=wallet.connect(provider);
 const report={environment:'BNB TESTNET ONLY — test tokens, not real commerce or investment returns',chainId:97,contract:v.target,tester:wallet.address,
  branches:children.map(w=>w.address),startedAt:state.startedAt,status:'running',transactions:[],checks:[],
  notTested:['Owner-authorized sales settlement and seller referral commissions','All fourteen stages and VIP rules on the public network','Principal withdrawal after 90 days','Mobile wallet pairing and the connected account dashboard','Independent audit or financial solvency']};
 const record=()=>{report.transactions=state.steps.map(({name,hash,blockNumber})=>({name,hash,blockNumber: blockNumber??null,url:`https://testnet.bscscan.com/tx/${hash}`}));save(publicFile,report);};
 const pass=(name,details={})=>{report.checks.push({name,status:'PASS',...details});record();console.log('PASS: '+name);};
 async function send(name,signer,request){
  let step=state.steps.find(s=>s.name===name);
  if(!step){
   check(Number((await provider.getNetwork()).chainId)===97,'RPC network changed');
   const gasPrice=(await provider.getFeeData()).gasPrice;
   check(gasPrice>0n&&gasPrice<=E('0.000000003'),'Gas price exceeds the test budget limit; retry later');
   const gasLimit=(await provider.estimateGas({...request,from:signer.address}))*125n/100n;
   check(gasLimit<=3000000n,'Unexpected test gas estimate');
   const cost=gasPrice*gasLimit+(request.value??0n);
   check(state.steps.reduce((sum,s)=>sum+BigInt(s.maxCost),0n)+cost<=MAX_COST,'Maximum test budget is 0.03 tBNB; stopped');
   check(await provider.getBalance(signer.address)>=cost,'Insufficient tBNB for '+signer.address);
   const nonce=await provider.getTransactionCount(signer.address,'pending');
   const raw=await signer.signTransaction({...request,chainId:97,type:0,gasPrice,gasLimit,nonce,value:request.value??0n});
   step={name,raw,hash:keccak256(raw),maxCost:cost.toString()};state.steps.push(step);save(journal,state);record();
  }
  const tx=Transaction.from(step.raw);
  check(tx.chainId===97n&&tx.from===signer.address&&tx.to===getAddress(request.to)&&tx.data===(request.data??'0x')&&tx.value===(request.value??0n)&&keccak256(step.raw)===step.hash,'Saved transaction mismatch: '+name);
  let receipt=await provider.getTransactionReceipt(step.hash);
  if(!receipt){
   if(!await provider.getTransaction(step.hash)){
    try{await provider.broadcastTransaction(step.raw);}catch{check(await provider.getTransaction(step.hash),'Broadcast not confirmed. Keep the journal and rerun the same command.');}
   }
   if(afterBroadcast)await afterBroadcast(name);
   console.log(name+': https://testnet.bscscan.com/tx/'+step.hash);
   receipt=await provider.waitForTransaction(step.hash,1,45000);
  }
  check(receipt?.status===1,'Pending or reverted transaction: '+step.hash+'. Keep the journal; rerun for a pending transaction only.');
  step.blockNumber=receipt.blockNumber;save(journal,state);record();return receipt;
 }
 const call=(name,signer,c,method,args)=>send(name,signer,{to:c.target,data:c.interface.encodeFunctionData(method,args)});
 const events=(receipt,name)=>receipt.logs.filter(l=>l.address.toLowerCase()===v.target.toLowerCase()).map(l=>{try{return v.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name===name);
 async function reject(name,fn,errorName){
  try{await fn();}catch(e){
   const data=e.data||e.info?.error?.data?.result||e.info?.error?.data;
   let parsed;try{if(typeof data==='string')parsed=v.interface.parseError(data);}catch{}
   check(e.code==='CALL_EXCEPTION'&&(parsed?.name===errorName||e.revert?.name===errorName),'RPC error is not a confirmed contract rejection: '+name);
   pass(name,{simulationOnly:true,expectedError:errorName});return;
  }
  throw Error('Expected rejection did not occur: '+name);
 }
 try{
  const feed=new Contract(addresses[2],artifacts.MockFeed.abi,provider);
  await call('Refresh TEST USDT price',root,feed,'set',[100000000n,state.feedTime,1,1]);
  check(await v.quoteUsd(token.target,E('1'))===E('1'),'TEST oracle expired or changed; stop and inspect');
  for(let i=0;i<2;i++)await send('Fund branch '+(i+1)+' test gas',root,{to:children[i].address,value:E('0.004')});
  for(const [i,signer,amount]of [[0,root,'100'],[1,children[0],'300'],[2,children[1],'200']]){
   await call('Mint TEST tokens '+i,root,token,'mint',[signer.address,E(amount)]);
   await call('Approve TEST deposit '+i,signer,token,'approve',[v.target,E(amount)]);
   const receipt=await call('Deposit TEST tokens '+i,signer,v,'deposit',[token.target,E(amount),i===0?state.referrer:root.address]);
   const deposited=events(receipt,'Deposited').find(e=>e.args.user===signer.address),routed=events(receipt,'DepositRouted');
   check(deposited?.args.amount===E(amount)&&deposited.args.feeEach===E(amount)/10n&&routed.some(e=>e.args.recipient===config.dropshippingWallet&&e.args.amount===E(amount)*8n/10n),'Deposit receipt mismatch');
   // Transfer logs verify the two fixed fee destinations as well as operation cash.
   const transfers=receipt.logs.filter(l=>l.address===token.target).map(l=>{try{return token.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name==='Transfer');
   for(const destination of [await v.FEE_WALLET_1(),await v.FEE_WALLET_2()])check(transfers.some(e=>e.args.from===v.target&&e.args.to===destination&&e.args.value===E(amount)/10n),'Deposit fee routing mismatch');
   pass('Deposit '+amount+' TEST USDT',{account:signer.address,principal:amount,operations:String(Number(amount)*0.8),feeEach:String(Number(amount)*0.1),block:receipt.blockNumber});
  }
  await call('Create reward group',root,v,'createRewardGroup',[children.map(w=>w.address)]);
  const group=BigInt(state.group);
  const g=await v.rewardGroup(root.address,group);
  check(g.branches.length===2&&g.branches.every((a,i)=>a===children[i].address),'Reward group mismatch');
  await call('Mint reward budget',root,token,'mint',[root.address,E('35')]);
  await call('Approve reward budget',root,token,'approve',[v.target,E('35')]);
  await call('Fund reward budget',root,v,'fundRewards',[token.target,E('35')]);
  await call('Prepare 500 USD stage',root,v,'prepareNetworkRewardAtStage',[group,0,64]);
  const claim=await call('Claim 35 TEST USDT',root,v,'claimNetworkRewardAtStage',[group,0]);
  check(events(claim,'NetworkRewardEarned').some(e=>e.args.user===root.address&&e.args.group===group&&e.args.volumeUsd===E('500')&&e.args.rewardUsd===E('35')),'Reward event mismatch');
  const claimed=await v.rewardGroup(root.address,group);
  check(claimed.stage===1n&&claimed.consumedUsd[0]===E('300')&&claimed.consumedUsd[1]===E('200'),'Branch consumption mismatch');
  pass('500 USD stage: 300 + 200, reward 35, volume consumed once');
  await reject('Same reward stage cannot replay',()=>v.claimNetworkRewardAtStage.staticCall(group,0),'NetworkStageChanged');
  const withdrawn=await call('Withdraw 10 TEST USDT',root,v,'withdrawProfit',[token.target,E('10')]);
  check(events(withdrawn,'Withdrawal').some(e=>e.args.user===root.address&&e.args.gross===E('10')&&e.args.fee===E('0.5')&&!e.args.principal),'Withdrawal event mismatch');
  const transfers=withdrawn.logs.filter(l=>l.address===token.target).map(l=>{try{return token.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name==='Transfer');
  check(transfers.some(e=>e.args.from===v.target&&e.args.to===root.address&&e.args.value===E('9.5')),'Net withdrawal mismatch');
  pass('Withdrawal 10: net 9.5, fee 0.5');
  await reject('Immediate second withdrawal is blocked',()=>v.withdrawProfit.staticCall(token.target,E('1'),{blockTag:withdrawn.blockNumber}),'Locked');
  const last=await call('Reinvest 5 TEST USDT',root,v,'reinvest',[token.target,E('5')]);
  const at={blockTag:last.blockNumber},account=await v.accounts(root.address,token.target,at),cap=await v.profitWithdrawalCap(root.address,token.target,at);
  check(account.principal===BigInt(state.before.principal)+E('105')&&account.profit===BigInt(state.before.profit)+E('20'),'Final accounting mismatch');
  check(await v.cumulativeReinvested(root.address,token.target,at)===BigInt(state.before.reinvested)+E('5')&&cap===BigInt(state.before.cap)+E('10.5'),'Reinvestment cap mismatch');
  pass('Reinvestment 5: principal +105 total; remaining profit +20; cap +10.5');
  report.status='completed';report.completedAt=new Date().toISOString();report.blockNumber=last.blockNumber;
  report.balances={principal:formatEther(account.principal),profit:formatEther(account.profit),withdrawalCap:formatEther(cap),nextWithdrawalUtc:new Date(Number(account.nextWithdrawal)*1000).toISOString()};
  record();state.status='completed';save(journal,state);console.log('LIVE_PLAN_READY '+publicFile);return report;
 }catch(e){report.status='incomplete';record();throw e;}
}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reportHtml(r){
 return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Global · تست شبکه</title><style>body{background:#0b0e10;color:#eee;font:16px/1.9 Tahoma,sans-serif;max-width:980px;margin:auto;padding:26px}h1,h2,a{color:#dbc48a}section{border:1px solid #35342b;border-radius:16px;padding:22px;margin:20px 0}li{margin:14px 0}code,a{overflow-wrap:anywhere}small{color:#b8b8b0}a{display:inline-block}header{border-bottom:1px solid #544b32;padding:18px 0}.en{direction:ltr;text-align:left}</style><header>GLOBAL DROP TRADE · TESTNET<h1>گزارش تست عملی پلن</h1><p>توکن و موجودی آزمایشی است؛ این گزارش فروش واقعی یا سود سرمایه‌گذاری نیست.</p></header><section><p>وضعیت: ${r.status==='completed'?'تست تکمیل شد':'تست ناتمام است'}</p><p>شبکه: BNB Testnet · 97</p><p>گزارش تا بلوک ${esc(r.blockNumber??'—')} · ${esc(r.completedAt??r.startedAt)}</p><p>حساب آزمایشی: <a dir="ltr" href="https://testnet.bscscan.com/address/${esc(r.tester)}">${esc(r.tester)}</a></p><p>قرارداد: <a dir="ltr" href="https://testnet.bscscan.com/address/${esc(r.contract)}">${esc(r.contract)}</a></p><small>این صفحه گزارش ثبت‌شده است. پنل حساب متصل، فقط کیف‌پول متصل به همان پنل را نشان می‌دهد.</small></section><section><h2>محاسبات تأییدشده</h2><ul class="en">${r.checks.map(c=>`<li>${esc(c.name)}${c.simulationOnly?' — simulated rejection, no failed transaction broadcast':''}</li>`).join('')}</ul></section><section><h2>تراکنش‌های شبکه</h2><ol class="en">${r.transactions.map(t=>`<li>${esc(t.name)}<br><a href="${esc(t.url)}">${esc(t.hash)}</a> · block ${esc(t.blockNumber??'pending')}</li>`).join('')}</ol></section><section><h2>خارج از این تست</h2><ul class="en">${r.notTested.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></section></html>`;
}
async function main(){
 const dir=path.resolve(process.argv[2]||'/root/global-testnet-v071/.testnet-server');
 const key=path.join(dir,'deployer.key');
 check(fs.existsSync(key)&&fs.lstatSync(key).isFile()&&(fs.statSync(key).mode&0o077)===0,'Existing test deployer key is missing or not private (600)');
 const wallet=new Wallet(fs.readFileSync(key,'utf8').trim());
 check(wallet.address===TESTER,'This runner only accepts the existing TEST-ONLY DEPLOYER');
 const deployment=JSON.parse(fs.readFileSync(path.join(dir,'deployment-public.json')));
 check(getAddress(deployment.contractAddress)===TARGET&&deployment.chainId===97,'Deployment file does not match the approved current testnet contract');
 const config=JSON.parse(fs.readFileSync('config.example.json'));
 const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 const provider=new JsonRpcProvider(process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org',undefined,{cacheTimeout:-1});provider.pollingInterval=2500;
 const output=path.join(dir,'live-plan-v1');
 try{
  const report=await runLivePlan({provider,wallet,config,deployment,artifacts,dir:output});
  fs.writeFileSync(path.join(output,'plan-public.html'),reportHtml(report),{mode:0o600});
 }finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.code==='CALL_EXCEPTION'?'Contract call reverted; inspect the saved public report.':e.code||e.message);process.exitCode=1;});
