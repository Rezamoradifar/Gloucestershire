import {BrowserProvider,Contract,ZeroAddress,isAddress} from 'ethers';
import abi from './vault-abi.json';
import {chainId,configured,vaultAddress} from './config';
import {getWalletProvider} from './wallet';

/** No signer, approval, wallet signature or transfer. Only reads from the connected account. */
export async function readOnlySession(expectedWallet:string){
 if(!configured||!isAddress(vaultAddress)||vaultAddress===ZeroAddress)throw Error('The contract is not configured.');
 const wallet=getWalletProvider();
 if(!wallet)throw Error('Connect your wallet to view on-chain records.');
 const [network,accounts]=await Promise.all([
  wallet.request({method:'eth_chainId'}),
  wallet.request({method:'eth_accounts'})
 ]);
 if(Number(network)!==chainId)throw Error('Switch to the configured network to view on-chain records.');
 if(!Array.isArray(accounts)||!accounts.some((value:unknown)=>typeof value==='string'&&value.toLowerCase()===expectedWallet.toLowerCase()))
  throw Error('The connected wallet has changed. Reconnect before reading records.');
 const provider=new BrowserProvider(wallet);
 const vault=new Contract(vaultAddress,abi,provider);
 return {provider,vault};
}
