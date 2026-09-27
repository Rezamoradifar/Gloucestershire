import {ContractFactory,Contract,getAddress} from './ethers.js';
export const names=['MockToken','MockFeed','MockFeed','DropshippingVault'];
export function argsFor(i,c,done){
 if(i===0)return [18]; if(i===1)return [60000000000n]; if(i===2)return [100000000n];
 if(!done.slice(0,3).every(x=>x?.address))throw Error('ابتدا سه مرحله قبلی را تکمیل کنید.');
 return [c.initialOwner,done[0].address,done[1].address,done[2].address,c.maxOracleAge,c.partners,c.dropshippingWallet];
}
export async function guard(raw,owner){
 if(BigInt(await raw.request({method:'eth_chainId'}))!==97n)throw Error('فقط BNB Testnet با شناسه 97 مجاز است.');
 const accounts=await raw.request({method:'eth_accounts'});
 if(!accounts[0]||getAddress(accounts[0])!==getAddress(owner))throw Error('کیف پول متصل باید همان آدرس مالک باشد.');
}
export async function requestFor(i,c,done,artifacts){
 const a=artifacts[names[i]];return new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...argsFor(i,c,done));
}
export async function verify(i,hash,provider,c,done,artifacts){
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt)return null;
 if(receipt.status!==1)throw Error('تراکنش ناموفق است؛ هش '+hash);
 const tx=await provider.getTransaction(hash),expected=await requestFor(i,c,done,artifacts);
 if(!tx||tx.chainId!==97n||tx.to!==null||tx.value!==0n||getAddress(tx.from)!==getAddress(c.initialOwner)||tx.data.toLowerCase()!==expected.data.toLowerCase())throw Error('رسید با مشخصات این استقرار مطابقت ندارد.');
 if(!receipt.contractAddress||await provider.getCode(receipt.contractAddress)==='0x')throw Error('کد قرارداد در شبکه پیدا نشد.');
 if(i===3){const v=new Contract(receipt.contractAddress,artifacts.DropshippingVault.abi,provider);
  if(getAddress(await v.owner())!==getAddress(c.initialOwner)||getAddress(await v.dropshippingWallet())!==getAddress(c.dropshippingWallet))throw Error('مالک یا مقصد عملیاتی مطابقت ندارد.');
  for(let j=0;j<7;j++)if(getAddress(await v.partnerWallets(j))!==getAddress(c.partners[j]))throw Error('آدرس شریک مطابقت ندارد.');
 }
 return {hash,address:receipt.contractAddress,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString()};
}
