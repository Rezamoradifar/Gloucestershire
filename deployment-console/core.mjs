import {ContractFactory,Contract,getAddress,keccak256,toUtf8Bytes} from './ethers.js';
export const names=['MockToken','MockFeed','MockFeed','DropshippingVault'];
export function deploymentKey(c,artifacts){
 if(c.chainId!==97)throw Error('Configuration must use BNB Testnet, chain ID 97.');
 const identity=[c.chainId,getAddress(c.initialOwner),getAddress(c.dropshippingWallet),c.partners.map(getAddress),c.maxOracleAge,names.map(n=>artifacts[n].bytecode.toLowerCase())];
 return 'global-testnet-deployment-'+keccak256(toUtf8Bytes(JSON.stringify(identity)));
}
export function argsFor(i,c,done){
 if(i===0)return [18]; if(i===1)return [60000000000n]; if(i===2)return [100000000n];
 if(!done.slice(0,3).every(x=>x?.address))throw Error('Complete the first three steps before continuing.');
 return [c.initialOwner,done[0].address,done[1].address,done[2].address,c.maxOracleAge,c.partners,c.dropshippingWallet];
}
export async function guard(raw,owner){
 if(BigInt(await raw.request({method:'eth_chainId'}))!==97n)throw Error('Only BNB Testnet, chain ID 97, is allowed.');
 const accounts=await raw.request({method:'eth_accounts'});
 if(!accounts[0]||getAddress(accounts[0])!==getAddress(owner))throw Error('The connected wallet must match the owner address.');
}
export async function requestFor(i,c,done,artifacts){
 const a=artifacts[names[i]];return new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...argsFor(i,c,done));
}
export async function verify(i,hash,provider,c,done,artifacts){
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt)return null;
 if(receipt.status!==1)throw Error('Transaction failed; hash: '+hash);
 const tx=await provider.getTransaction(hash),expected=await requestFor(i,c,done,artifacts);
 if(!tx||tx.chainId!==97n||tx.to!==null||tx.value!==0n||getAddress(tx.from)!==getAddress(c.initialOwner)||tx.data.toLowerCase()!==expected.data.toLowerCase())throw Error('The receipt does not match this deployment configuration.');
 if(!receipt.contractAddress||await provider.getCode(receipt.contractAddress)==='0x')throw Error('Contract code was not found on this network.');
 if(i===3){const v=new Contract(receipt.contractAddress,artifacts.DropshippingVault.abi,provider);
  if(await v.NETWORK_PLAN_VERSION()!==2n)throw Error('The contract plan version does not match.');
  if(getAddress(await v.owner())!==getAddress(c.initialOwner)||getAddress(await v.dropshippingWallet())!==getAddress(c.dropshippingWallet))throw Error('The owner or operations address does not match.');
  for(let j=0;j<7;j++)if(getAddress(await v.partnerWallets(j))!==getAddress(c.partners[j]))throw Error('The partner address does not match.');
 }
 return {hash,address:receipt.contractAddress,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString()};
}
