// Refresh existing mock feeds only. Never changes production feeds or vault rules.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,Wallet,JsonRpcProvider,FetchRequest,getAddress,ZeroAddress,parseEther} from 'ethers';
const PINNED_VAULT='0x7f19354B765920B9b17003d0840EEaA133883DcA';
const PINS=['0xDA264c16Ec8832748a1A5A31b963deD9E48e337a','0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454'];
function check(ok,message){if(!ok)throw Error(message);}
export async function inspectMockFeeds({provider,artifact,vaultAddress=PINNED_VAULT,feedAddresses=PINS}){
 check((await provider.getNetwork()).chainId===97n,'Only BNB Testnet 97 is allowed');
 const vault=new Contract(getAddress(vaultAddress),['function bnbUsdFeed() view returns(address)','function usdtUsdFeed() view returns(address)','function usdt() view returns(address)','function maxOracleAge() view returns(uint256)','function quoteUsd(address,uint256) view returns(uint256)'],provider);
 const actual=await Promise.all([vault.bnbUsdFeed(),vault.usdtUsdFeed()]);
 check(actual.every((a,i)=>getAddress(a)===getAddress(feedAddresses[i])),'Unexpected feeds: stopped');
 const code='0x'+artifact.evm.deployedBytecode.object.replace(/^0x/,'');
 for(const address of actual)check((await provider.getCode(address)).toLowerCase()===code.toLowerCase(),'Feed is not the reviewed MockFeed: stopped');
 const maxAge=await vault.maxOracleAge();
 check(maxAge>=1800n,'Oracle age is too short for this five-minute maintenance schedule');
 return {vault,actual,maxAge};
}
export async function refreshMockFeeds({provider,wallet,artifact,vaultAddress=PINNED_VAULT,feedAddresses=PINS,execute}){
 const {vault,actual,maxAge}=await inspectMockFeeds({provider,artifact,vaultAddress,feedAddresses});
 const signer=wallet.connect(provider),hashes=[],feeds=[];
 // Validate every feed before changing either one. This is only for reviewed test mocks.
 const observations=[];
 for(const address of actual){
  const feed=new Contract(address,artifact.abi,signer),block=await provider.getBlock('latest');
  const [round,answer,,updated,answered]=await feed.latestRoundData();
  check(round>0n&&answer>0n&&answered>=round&&updated<=BigInt(block.timestamp),'Invalid mock price data: stopped');
  observations.push({address,feed,round,answer,updated,block});
 }
 for(const {address,feed,round,answer,updated,block} of observations){
  feeds.push({address,answer:answer.toString(),updatedAt:updated.toString(),ageSeconds:(BigInt(block.timestamp)-updated).toString()});
  if(updated>0n&&BigInt(block.timestamp)-updated<=maxAge/2n)continue;
  const args=[answer,block.timestamp,round+1n,round+1n];
  const gas=(await feed.set.estimateGas(...args))*125n/100n,fees=await provider.getFeeData();
  check(fees.gasPrice>0n&&fees.gasPrice<=parseEther('0.000000003')&&gas*fees.gasPrice<=parseEther('0.001'),'Unexpected test gas price or cost');
  const receipt=execute?await execute(await feed.set.populateTransaction(...args)):await(await feed.set(...args,{gasLimit:gas,gasPrice:fees.gasPrice})).wait(1,45000);
  check(receipt?.status===1,'Mock feed refresh not confirmed');hashes.push(receipt.hash);
 }
 const token=await vault.usdt();
 await vault.quoteUsd(ZeroAddress,parseEther('1'));await vault.quoteUsd(token,parseEther('1'));
 return {status:'TESTNET_ORACLES_VALID',chainId:97,vault:vaultAddress,maxOracleAge:maxAge.toString(),observedFeeds:feeds,transactions:hashes};
}
async function main(){
 const state=path.resolve(process.argv[2]||'/root/global-testnet-v071/.testnet-server'),key=path.join(state,'deployer.key');
 check(fs.existsSync(key)&&(fs.statSync(key).mode&0o077)===0,'Existing test deployer key missing or permissions are not 600');
 const rpc=new FetchRequest(process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org');rpc.timeout=15000;
 const provider=new JsonRpcProvider(rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
 try{const wallet=new Wallet(fs.readFileSync(key,'utf8').trim());check(wallet.address==='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2','Unexpected test deployer');const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockFeed.json',import.meta.url)));console.log(JSON.stringify(await refreshMockFeeds({provider,wallet,artifact}),null,2));}finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
