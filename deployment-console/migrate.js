import {selectWalletProvider} from './wallet-provider.js?v=3';
import {BrowserProvider,Contract,ContractFactory,formatEther,getAddress} from './ethers.js';
const SOURCE='0x4f65014A86Af841bF7a72F49E9AEB4432a72Db8F';
const OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const key='global-testnet-migration-v1-'+SOURCE;
const $=id=>document.getElementById(id),out=x=>{$('status').textContent=x;};
let provider,signer,source,artifact,inventory,report,request,gasLimit;
let busy=false;
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
function save(){localStorage.setItem(key,json({inventory,report}));}
async function guard(){if(Number((await provider.getNetwork()).chainId)!==97)throw Error('فقط شبکه ۹۷ مجاز است.');const accounts=await provider.send('eth_accounts',[]);if(!accounts.length||getAddress(accounts[0])!==OWNER||getAddress(await signer.getAddress())!==OWNER)throw Error('کیف پول مالک تغییر کرده است؛ دوباره متصل شوید.');if(await source.owner()!==OWNER)throw Error('مالک مبدأ تغییر کرده است.');}
function controls(){const connected=!!source;for(const id of ['connect','pause','scan','estimate','deploy','verify','activate','download'])$(id).disabled=busy;
 if(!busy){$('pause').disabled=!connected;$('scan').disabled=!connected;$('estimate').disabled=!inventory||!connected||!!report?.hash;$('deploy').disabled=!request||!$('accept').checked||!!report?.hash;$('verify').disabled=!connected||!report?.hash;$('activate').disabled=!connected||!report?.verified||!!report?.activated;$('download').disabled=!report?.verified;}}
function action(id,fn){$(id).onclick=async()=>{if(busy)return;busy=true;controls();try{await fn();}catch(e){out(e.shortMessage||e.message);}finally{busy=false;controls();}};}
$('source').textContent=SOURCE;$('accept').onchange=controls;
action('connect',async()=>{
 source=undefined;request=undefined;
 const injected=selectWalletProvider(window);
 if(!injected)throw Error('کیف پول شناسایی نشد؛ لینک را داخل بخش DApp سیف‌پل باز کنید.');
 out('در انتظار اجازه اتصال در سیف‌پل؛ پنجره کیف پول را تأیید کنید.');
 await injected.request({method:'eth_requestAccounts'});
 if(Number(await injected.request({method:'eth_chainId'}))!==97){
  out('تغییر شبکه به BNB Testnet را در کیف پول تأیید کنید.');
  try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x61'}]});}
  catch{throw Error('شبکه کیف پول را روی BNB Testnet (97) بگذارید و دوباره اتصال را بزنید.');}
 }
 provider=new BrowserProvider(injected);signer=await provider.getSigner();
 out('در حال بررسی مالک و بارگیری اطلاعات قرارداد…');
 const [old,next]=await Promise.all(['DropshippingVault','TestnetMigratedRewardsVault'].map(async name=>{const r=await fetch(name+'.json');if(!r.ok)throw Error('Artifact missing');return r.json();}));artifact=next;source=new Contract(SOURCE,old.abi,signer);try{await guard();}catch(e){source=undefined;throw e;}
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}');inventory=saved.inventory;report=saved.report;}catch{}
 $('wallet').textContent=OWNER;out('مالک و شبکه تأیید شدند.'+(report?.hash?' تراکنش قبلی پیدا شد؛ تطبیق حساب‌ها را بزنید.':''));
});
action('pause',async()=>{await guard();if(!await source.paused()){await source.setPaused.staticCall(true);await guard();const tx=await source.setPaused(true);out('در انتظار توقف: '+tx.hash);await tx.wait();}out('مبدأ متوقف است. برداشت‌های قبلی همچنان ممکن‌اند.');});
action('scan',async()=>{
 await guard();if(report?.hash)throw Error('دیپلوی قبلی ثبت شده؛ ابتدا آن را بررسی کنید.');if(!await source.paused())throw Error('ابتدا مبدأ را متوقف کنید.');
 request=undefined;inventory=undefined;save();
 const end=await provider.getBlockNumber(),block=await provider.getBlock(end);let low=0,high=end;
 if(await provider.getCode(SOURCE,end)==='0x')throw Error('مبدأ پیدا نشد.');
 while(low<high){const mid=Math.floor((low+high)/2);if(await provider.getCode(SOURCE,mid)==='0x')low=mid+1;else high=mid;out('یافتن بلوک ایجاد قرارداد… '+low+' / '+high);}
 const members=new Set(),settlements=new Set(),ids=new Set();let start=low,span=2000;
 const topics=['Registered','SaleSettled','ProfitCredited'].map(x=>source.interface.getEvent(x).topicHash);
 while(start<=end){const stop=Math.min(end,start+span-1);let logs;
  try{logs=await provider.getLogs({address:SOURCE,fromBlock:start,toBlock:stop,topics:[topics]});}
  catch(e){if(span<=20)throw Error('اسکن کامل نشد. RPC باید دسترسی به تاریخچه رویدادها داشته باشد. دوباره تلاش کنید.');span=Math.max(20,Math.floor(span/2));continue;}
  for(const log of logs){if(log.removed)throw Error('زنجیره تغییر کرد؛ اسکن را تکرار کنید.');const e=source.interface.parseLog(log);if(e.name==='Registered')members.add(getAddress(e.args.user));if(e.name==='SaleSettled')settlements.add(e.args.id);if(e.name==='ProfitCredited')ids.add(e.args.id);}
  start=stop+1;out(`اسکن ${stop} / ${end} — ${members.size} کاربر`);
 }
 const batches=[];for(const id of ids)if(await source.usedRewardBatch(id,{blockTag:end}))batches.push(id);
 if((await provider.getBlock(end))?.hash!==block.hash)throw Error('بلوک اسکن تغییر کرد؛ دوباره تلاش کنید.');
 inventory={members:[...members].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),settlements:[...settlements].sort(),batches:batches.sort(),fromBlock:low,block:end,blockHash:block.hash};save();
 $('inventory').textContent=`${members.size} کاربر، ${settlements.size} فروش، ${batches.length} پاداش گروهی`;out('اسکن کامل شد. در صورت خطای تطبیق یا تغییر حساب‌ها، دیپلوی رد می‌شود.');
});
action('estimate',async()=>{
 request=undefined;gasLimit=undefined;
 await guard();if(!$('accept').checked)throw Error('محدودیت انتقال آزمایشی را مطالعه و تأیید کنید.');
 const factory=new ContractFactory(artifact.abi,artifact.bytecode,signer);
 const candidate=await factory.getDeployTransaction(SOURCE,inventory.members,inventory.settlements,inventory.batches);
 if((candidate.data.length-2)/2>49152){request=undefined;throw Error('داده انتقال از حد مجاز یک تراکنش بیشتر است؛ دیپلوی انجام نشد.');}
 const gas=await provider.estimateGas({...candidate,from:OWNER});gasLimit=gas*120n/100n;
 const block=await provider.getBlock('latest');if(gasLimit>block.gasLimit){request=undefined;throw Error('انتقال از ظرفیت گس بلوک بیشتر است؛ نیاز به مسیر دسته‌ای دارد.');}
 const fees=await provider.getFeeData();if(fees.maxFeePerGas===null&&fees.gasPrice===null)throw Error('Gas price unavailable');request=candidate;$('estimateText').textContent=`گس با حاشیه: ${gasLimit} — هزینه تخمینی: ${formatEther(gasLimit*(fees.maxFeePerGas||fees.gasPrice))} tBNB`;
 out('برآورد موفق. در دیپلوی، اطلاعات دوباره مستقیماً از مبدأ خوانده می‌شوند.');
});
action('deploy',async()=>{
 await guard();if(!$('accept').checked||!request)throw Error('ابتدا برآورد هزینه و تأیید محدودیت‌ها لازم است.');
 // Re-estimation catches state changes since review; never use an unbounded gas override.
 await provider.estimateGas({...request,from:OWNER});await guard();
 const tx=await signer.sendTransaction({...request,gasLimit});report={chainId:97,source:SOURCE,owner:OWNER,hash:tx.hash,inventory,verified:false,activated:false,legacyClaimsExtinguished:false};save();out('تراکنش ذخیره شد: '+tx.hash+' — پس از تأیید، تطبیق حساب‌ها را بزنید.');
 const receipt=await tx.wait();if(receipt.status!==1)throw Error('دیپلوی ناموفق؛ تراکنش ذخیره شده را بررسی کنید.');report.target=receipt.contractAddress;report.block=receipt.blockNumber;save();$('target').textContent=report.target;out('قرارداد جدید ساخته شد؛ هنوز سایت به آن متصل نشده است. اکنون تطبیق حساب‌ها را بزنید.');
});
action('verify',async()=>{
 report.verified=false;report.activated=false;save();
 await guard();const receipt=await provider.getTransactionReceipt(report.hash);if(!receipt)throw Error('تراکنش هنوز تأیید نشده است.');if(receipt.status!==1||!receipt.contractAddress)throw Error('دیپلوی موفق نیست.');
 const transaction=await provider.getTransaction(report.hash);const expected=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(SOURCE,report.inventory.members,report.inventory.settlements,report.inventory.batches);
 if(transaction.from!==OWNER||transaction.to!==null||transaction.data!==expected.data)throw Error('تراکنش با انتقال بررسی‌شده مطابقت ندارد.');
 const n=new Contract(receipt.contractAddress,artifact.abi,provider),o={blockTag:receipt.blockNumber},token=await source.usdt(o);
 const compare=async(name,args=[])=>{if(json(await n[name](...args,o))!==json(await source[name](...args,o)))throw Error('عدم تطبیق: '+name+' '+args.join(' '));};
 for(const name of ['owner','usdt','bnbUsdFeed','usdtUsdFeed','maxOracleAge','dropshippingWallet','minDepositUsd','profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','partnerVotesRequired'])await compare(name);
 for(let i=0;i<7;i++)await compare('partnerWallets',[i]);for(let i=0;i<5;i++)await compare('tierConfig',[i]);
 for(const who of report.inventory.members){
  for(const name of ['users','qualifiedDirects','positionCount','networkBranchCount','rewardGroupCount'])await compare(name,[who]);
  for(const asset of ['0x0000000000000000000000000000000000000000',token]){await compare('accounts',[who,asset]);await compare('cumulativeReinvested',[who,asset]);}
  for(let j=0n;j<await source.positionCount(who,o);j++)await compare('positionOf',[who,j]);
  for(let j=0n;j<await source.networkBranchCount(who,o);j++){await compare('networkBranch',[who,j]);const b=await source.networkBranch(who,j,o);await compare('branchVolumeUsd',[who,b]);await compare('groupedBranch',[who,b]);}
  for(let j=0n;j<await source.rewardGroupCount(who,o);j++){await compare('rewardGroup',[who,j]);const g=await source.rewardGroup(who,j,o);for(let k=0;k<g.branches.length;k++)await compare('rewardBranch',[who,j,k]);}
  out('تطبیق کاربر '+who);
 }
 await compare('volumeJobCount');for(let j=0n;j<await source.volumeJobCount(o);j++)await compare('volumeJobs',[j]);
 for(const asset of ['0x0000000000000000000000000000000000000000',token])for(const name of ['ledgers','ownerCapitalOutstanding','retainedPrincipalPenalties'])await compare(name,[asset]);
 for(const id of report.inventory.settlements)await compare('usedSettlement',[id]);for(const id of report.inventory.batches)await compare('usedRewardBatch',[id]);
 if(await n.REWARD_ACCRUAL_VERSION()!==1n)throw Error('نسخه ریوارد نادرست است.');
 report={...report,target:receipt.contractAddress,block:receipt.blockNumber,blockHash:receipt.blockHash,queue:await n.withdrawalQueue(),verified:true};save();$('target').textContent=report.target;out('حساب‌ها در بلوک دیپلوی تطبیق دارند. برداشت‌های قرارداد قبلی همچنان مستقل‌اند؛ گزارش را دانلود کنید.');
});
action('activate',async()=>{
 await guard();if(!$('accept').checked||!report.verified)throw Error('تطبیق و تأیید محدودیت‌ها لازم است.');if(!await source.paused())throw Error('مبدأ دوباره فعال شده؛ ادامه متوقف شد.');
 const n=new Contract(report.target,artifact.abi,signer);if(await n.owner()!==OWNER)throw Error('مالک مقصد متفاوت است.');
 const tx=await n.setPaused(false);out('در انتظار فعال‌سازی: '+tx.hash);await tx.wait();report.activated=true;report.activationHash=tx.hash;save();out('ریوارد جدید فعال شد. گزارش را دانلود و آدرس جدید را برای اتصال سایت ارسال کنید.');
});
action('download',async()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='global-testnet-migration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
controls();

out('صفحه آماده است؛ اتصال کیف پول مالک را بزنید.');
