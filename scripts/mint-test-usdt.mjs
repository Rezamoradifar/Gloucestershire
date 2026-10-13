// Issue mock TEST USDT only; repeats reuse the same signed transaction.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,Wallet,JsonRpcProvider,ZeroAddress,getAddress,parseEther,formatUnits} from 'ethers';
import {check,save,createJournalSender} from './testnet-journal.mjs';
const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const VAULT='0x7f19354B765920B9b17003d0840EEaA133883DcA';
const RECEIVER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const abi=['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function mint(address,uint256)','event Transfer(address indexed from,address indexed to,uint256 value)'];
export async function mintTestUsdt({provider,wallet,tokenAddress=TOKEN,destination=RECEIVER,dir}){
 check(Number((await provider.getNetwork()).chainId)===97,'Only BNB Testnet chain 97 is allowed');
 const to=getAddress(destination),token=new Contract(getAddress(tokenAddress),abi,provider);
 check(await provider.getCode(token.target)!=='0x','TEST token contract missing');
 const [name,symbol,decimals]=await Promise.all([token.name(),token.symbol(),token.decimals()]);
 check(name==='Test USDT'&&symbol==='TUSDT'&&decimals===18n,'Unexpected token: stopped');
 const amount=parseEther('1000000'),signer=wallet.connect(provider);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'mint-private.json');
 const config={chainId:97,token:token.target,to,amount:amount.toString(),signer:signer.address};
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 if(state)check(JSON.stringify(state.config)===JSON.stringify(config),'Existing mint journal differs: stopped');
 else{state={config,steps:[]};save(file,state);}
 const send=createJournalSender({provider,state,journal:file,record:()=>{},maxCost:parseEther('0.003')});
 const receipt=await send('Mint 1000000 TEST USDT',signer,{to:token.target,data:token.interface.encodeFunctionData('mint',[to,amount])});
 const minted=receipt.logs.filter(log=>log.address.toLowerCase()===token.target.toLowerCase()).some(log=>{try{const event=token.interface.parseLog(log);return event?.name==='Transfer'&&event.args.from===ZeroAddress&&event.args.to===to&&event.args.value===amount;}catch{return false;}});
 check(minted,'Exact mint event missing: do not send a new transaction');
 const report={chainId:97,token:token.target,recipient:to,testUsdt:'1000000',hash:receipt.hash,balance:formatUnits(await token.balanceOf(to),18),url:'https://testnet.bscscan.com/tx/'+receipt.hash};
 save(path.join(dir,'mint-public.json'),report);return report;
}
async function main(){
 const stateDir=path.resolve(process.argv[2]||'/root/global-testnet-v071/.testnet-server');
 const keyFile=path.join(stateDir,'deployer.key');
 check(fs.existsSync(keyFile),'Existing TEST deployer key not found');
 check((fs.statSync(keyFile).mode&0o077)===0,'deployer.key must have mode 600');
 const provider=new JsonRpcProvider(process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org');provider.pollingInterval=2500;
 try{
  check(Number((await provider.getNetwork()).chainId)===97,'Only BNB Testnet is allowed');
  const vault=new Contract(VAULT,['function usdt() view returns(address)'],provider);
  check(getAddress(await vault.usdt())===TOKEN,'Global token differs: stopped');
  const wallet=new Wallet(fs.readFileSync(keyFile,'utf8').trim());
  check(wallet.address==='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2','Unexpected TEST deployer: stopped');
  const report=await mintTestUsdt({provider,wallet,dir:path.join(stateDir,'mint-5bc282a45a8a1d7d9b915f04fc1d4031156d7632-1m-v1')});
  console.log('TEST_USDT_MINT_CONFIRMED '+report.testUsdt+' to '+report.recipient);console.log(report.url);console.log('Current TEST balance: '+report.balance);
 }finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('Mint not confirmed. Check TEST deployer tBNB, RPC and existing journal; rerun the same command. No real USDT was used.');process.exitCode=1;});
