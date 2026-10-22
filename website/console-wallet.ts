import {EthereumProvider} from '@walletconnect/ethereum-provider';
import type {Eip1193Provider} from 'ethers';
type Provider=Eip1193Provider&{on?:(event:string,listener:()=>void)=>unknown;removeListener?:(event:string,listener:()=>void)=>unknown;disconnect?:()=>Promise<void>};
let mobile:Promise<Awaited<ReturnType<typeof EthereumProvider.init>>>|undefined;
export async function connectMigrationWallet(kind:'injected'|'walletconnect'):Promise<Provider>{
 if(kind==='injected'){
  const w=window as typeof window&{safepalProvider?:Provider;ethereum?:Provider&{providers?:Array<Provider&{isSafePal?:boolean}>}};
  const provider=[w.safepalProvider,...(w.ethereum?.providers||[]).filter(p=>p.isSafePal),w.ethereum].find(p=>typeof p?.request==='function');
  if(!provider)throw Error('No browser wallet detected. Choose WalletConnect or open this page in your wallet browser.');
  await provider.request({method:'eth_requestAccounts'});return provider;
 }
 mobile??=EthereumProvider.init({projectId:'41040f658e4d4120399041c145b5e8b0',optionalChains:[97],showQrModal:true,rpcMap:{97:'https://bsc-testnet-rpc.publicnode.com'},metadata:{name:'Global testnet migration',description:'Owner-approved testnet state copy and server reporter authorization',url:location.origin,icons:[new URL('/favicon.svg',location.origin).href]}}).catch(e=>{mobile=undefined;throw e;});
 const provider=await mobile;await provider.enable();return provider;
}
