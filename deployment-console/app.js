import {BrowserProvider,formatEther,getAddress} from './ethers.js';
import {guard,requestFor,verify} from './core.mjs';
const $=id=>document.getElementById(id);
let config,artifacts,raw,provider,busy=false,records=[],done=[],estimate=null;
const labels=['توکن آزمایشی TUSDT','منبع قیمت آزمایشی BNB','منبع قیمت آزمایشی TUSDT','قرارداد GLOBAL'];
const KEY='global-testnet-deployment-v040-owner-ebfb';
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function save(){localStorage.setItem(KEY,JSON.stringify(records));}
function render(){
 $('steps').replaceChildren();
 for(let i=0;i<4;i++){
  const box=document.createElement('article');box.className='step';
  const title=document.createElement('h3');title.textContent=`${i+1}. ${labels[i]}`;box.append(title);
  const info=document.createElement('p');info.textContent=done[i]?'تأیید و بررسی شد':records[i]?.hash?'ارسال شده؛ برای ادامه وضعیت را بررسی کنید.':'در انتظار استقرار';if(done[i])info.className='complete';box.append(info);
  if(records[i]?.hash){const a=document.createElement('a');a.href='https://testnet.bscscan.com/tx/'+records[i].hash;a.target='_blank';a.rel='noopener noreferrer';a.textContent=records[i].hash;box.append(a);}
  if(done[i]){const code=document.createElement('code');code.textContent=done[i].address;box.append(code);}
  const actions=document.createElement('div');actions.className='actions';
  const ready=!!provider&&!busy&&$('agree').checked&&(i===0||done.slice(0,i).every(Boolean))&&!records[i]?.hash;
  const prepare=document.createElement('button');prepare.className='secondary';prepare.textContent='برآورد کارمزد';prepare.disabled=!ready;prepare.onclick=()=>run(()=>prepareStep(i));actions.append(prepare);
  if(estimate?.i===i){const fee=document.createElement('p');fee.textContent=`حداکثر هزینه برآوردی با حاشیه گس: ${estimate.fee} tBNB · مبلغ ارسالی: صفر`;box.append(fee);const send=document.createElement('button');send.textContent='تأیید در کیف پول و استقرار';send.disabled=!ready;send.onclick=()=>run(()=>sendStep(i));actions.append(send);}
  box.append(actions);$('steps').append(box);
 }
 $('connect').disabled=busy;$('switch').disabled=busy;$('refresh').disabled=busy||!provider;
 $('result').hidden=!done[3];
 if(done[3]){$('contract').textContent=done[3].address;$('explorer').href='https://testnet.bscscan.com/address/'+done[3].address;}
}
async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){status(e.code===4001||e.code==='ACTION_REJECTED'?'درخواست در کیف پول لغو شد.':e.shortMessage||e.message||'خطا در ارتباط با کیف پول.',true);}finally{busy=false;render();}}
function selectWallet(){const p=window.safepalProvider||window.ethereum;if(!p?.request)throw Error('این لینک را در مرورگر داخلی SafePal باز کنید؛ در این مرورگر کیف پول شناسایی نشد.');return p;}
function invalidate(){estimate=null;done=[];provider=null;$('connection').textContent='اتصال نیاز به بررسی دارد';status('حساب یا شبکه تغییر کرد؛ دوباره اتصال را بررسی کنید.');render();}
async function connect(){
 raw=selectWallet();await raw.request({method:'eth_requestAccounts'});await guard(raw,config.initialOwner);
 provider=new BrowserProvider(raw);provider.pollingInterval=2500;
 raw.removeListener?.('accountsChanged',invalidate);raw.removeListener?.('chainChanged',invalidate);raw.on?.('accountsChanged',invalidate);raw.on?.('chainChanged',invalidate);
 $('connection').textContent='مالک متصل · شبکه 97';$('wallet').textContent='موجودی: '+formatEther(await provider.getBalance(config.initialOwner))+' tBNB';
 await recover();status(done[3]?'استقرار قرارداد تأیید شد.':'اتصال برقرار است. تنظیمات را بررسی و مرحله بعد را برآورد کنید.');
}
async function recover(){await guard(raw,config.initialOwner);done=[];for(let i=0;i<4;i++){if(!records[i]?.hash)break;const receipt=await provider.getTransactionReceipt(records[i].hash);if(receipt?.status===0){records=records.slice(0,i);save();status('تراکنش قبلی ناموفق بود؛ می‌توانید مرحله را دوباره برآورد کنید.',true);break;}const r=await verify(i,records[i].hash,provider,config,done,artifacts);if(!r)break;done[i]=r;}render();}
async function prepareStep(i){
 await guard(raw,config.initialOwner);const signer=await provider.getSigner(config.initialOwner);
 const request=await requestFor(i,config,done,artifacts),gas=await signer.estimateGas(request),gasLimit=gas*120n/100n;
 const fees=await provider.getFeeData(),unit=fees.maxFeePerGas||fees.gasPrice;if(!unit)throw Error('برآورد کارمزد در دسترس نیست.');
 const cost=gasLimit*unit;if(await provider.getBalance(config.initialOwner)<cost)throw Error('موجودی tBNB برای این مرحله کافی نیست. از لینک رسمی فاست استفاده کنید.');
 estimate={i,request,gasLimit,fee:formatEther(cost)};status('برآورد آماده است؛ جزئیات نهایی کارمزد را در کیف پول بررسی کنید.');
}
async function sendStep(i){
 if(!estimate||estimate.i!==i||!$('agree').checked)throw Error('ابتدا تنظیمات و برآورد را بررسی کنید.');
 await guard(raw,config.initialOwner);const signer=await provider.getSigner(config.initialOwner);
 const request=await requestFor(i,config,done,artifacts);if(request.data!==estimate.request.data)throw Error('تنظیمات تغییر کرده؛ دوباره برآورد کنید.');
 status('درخواست امضا در کیف پول؛ پس از تأیید، منتظر رسید شبکه بمانید.');
 const tx=await signer.sendTransaction({...request,value:0n,chainId:97,gasLimit:estimate.gasLimit});
 records[i]={hash:tx.hash};save();estimate=null;render();status('تراکنش ارسال شد. در حال انتظار برای تأیید شبکه…');
 try{await provider.waitForTransaction(tx.hash,1,120000);}catch{status('تأیید هنوز دریافت نشده؛ دکمه بررسی وضعیت را بزنید.');return;}
 await recover();status(done[3]?'قرارداد اصلی مستقر و مالک، مقصد عملیاتی و هفت شریک بررسی شدند.':'مرحله تأیید شد؛ مرحله بعد را برآورد کنید.');
}
$('connect').onclick=()=>run(connect);
$('switch').onclick=()=>run(async()=>{raw=selectWallet();try{await raw.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x61'}]});}catch(e){if(e.code!==4902)throw e;await raw.request({method:'wallet_addEthereumChain',params:[{chainId:'0x61',chainName:'BNB Smart Chain Testnet',nativeCurrency:{name:'Test BNB',symbol:'tBNB',decimals:18},rpcUrls:['https://bsc-testnet-dataseed.bnbchain.org'],blockExplorerUrls:['https://testnet.bscscan.com']}]});}await connect();});
$('agree').onchange=()=>{estimate=null;render();};$('refresh').onclick=()=>run(async()=>{await recover();status(done[3]?'قرارداد تأیید شد.':'وضعیت بررسی شد؛ مراحل باقی‌مانده را ادامه دهید.');});
$('download').onclick=()=>{const blob=new Blob([JSON.stringify({chainId:97,config,deployments:done,mode:'TEST ONLY — mock token and mock feeds'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='GLOBAL-testnet-deployment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
try{
 [config,...artifacts]=await Promise.all(['config','MockToken','MockFeed','DropshippingVault'].map(n=>fetch(n+'.json').then(r=>{if(!r.ok)throw Error('بارگذاری فایل قرارداد ناموفق بود.');return r.json();})));
 artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map((n,i)=>[n,artifacts[i]]));
 config.initialOwner=getAddress(config.initialOwner);config.partners=config.partners.map(getAddress);if(config.partners.length!==7||new Set(config.partners).size!==7)throw Error('تنظیمات شرکا نامعتبر است.');
 try{const stored=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(stored)&&stored.length<=4&&stored.every(x=>x&&/^0x[0-9a-f]{64}$/i.test(x.hash)))records=stored;}catch{}
 $('owner').textContent=config.initialOwner;
 const rows=[['ولت عملیاتی ۸۰٪',config.dropshippingWallet],['سهم ثابت اول ۱۰٪','0x7037Cc199499D7A3431285a01E435454EaE51265'],['سهم ثابت دوم ۱۰٪','0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632'],['کارمزد برداشت سود','0x74015deDF36677485793f1714Ec7bD4893907b26']];
 for(const [label,address]of rows){const p=document.createElement('p');p.className='address-label';p.textContent=label;const code=document.createElement('code');code.textContent=address;$('addresses').append(p,code);}
 config.partners.forEach(a=>{const li=document.createElement('li'),code=document.createElement('code');code.textContent=a;li.append(code);$('partners').append(li);});
 status('برای شروع، کیف پول مالک را روی BNB Testnet متصل کنید.');render();
 document.modelContext?.registerTool({name:'read_deployment_status',description:'Read testnet deployment progress. Does not connect, sign or send transactions.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async input=>{if(input&&Object.keys(input).length)throw Error('No parameters accepted');return {chainId:97,connected:!!provider,verifiedDeployments:done,transactionRecords:records};}});
}catch(e){status(e.message,true);$('connect').disabled=true;$('switch').disabled=true;}
