import type {Eip1193Provider} from 'ethers';
import {chainId,chainName,explorer} from './config';

export type WalletProvider=Eip1193Provider & {
 on?:(event:string,listener:(...args:unknown[])=>void)=>unknown;
 removeListener?:(event:string,listener:(...args:unknown[])=>void)=>unknown;
 disconnect?:()=>Promise<void>;
};
type MobileProvider=WalletProvider & {enable:()=>Promise<string[]>};
export type WalletKind='injected'|'walletconnect';
export const walletConnectProjectId=String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID||'').trim();
export const walletConnectReady=/^[a-f0-9]{32}$/i.test(walletConnectProjectId);

// A single selected EIP-1193 provider is shared by account reads and all signing.
// Connecting only requests account access; it never signs or submits a transaction.
export class WalletConnection {
 private active:WalletProvider|null=null;
 private kind:WalletKind|null=null;
 private listeners=new Set<()=>void>();
 private removeEvents=()=>{};
 private pending:Promise<void>|null=null;
 private attempt=0;
 constructor(private injected:()=>WalletProvider|undefined,private mobile:()=>Promise<MobileProvider>){}
 getProvider(){return this.active;}
 getKind(){return this.kind;}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private emit(){for(const listener of this.listeners)listener();}
 private select(provider:WalletProvider|null,kind:WalletKind|null){
  this.removeEvents();this.active=provider;this.kind=kind;
  if(provider){
   const changed=()=>{if(this.active===provider)this.emit();};
   const disconnected=()=>{if(this.active===provider)this.select(null,null);};
   provider.on?.('accountsChanged',changed);provider.on?.('chainChanged',changed);provider.on?.('disconnect',disconnected);
   this.removeEvents=()=>{provider.removeListener?.('accountsChanged',changed);provider.removeListener?.('chainChanged',changed);provider.removeListener?.('disconnect',disconnected);};
  }else this.removeEvents=()=>{};
  this.emit();
 }
 connect(kind:WalletKind){
  if(this.pending)return this.pending;
  const attempt=++this.attempt;
  const work=(async()=>{
   if(kind==='injected'){
    const provider=this.injected();
    if(!provider)throw Error('No browser wallet found. Use WalletConnect on mobile, or open this site inside your wallet browser.');
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if(!Array.isArray(accounts)||!accounts.length)throw Error('No wallet account was connected.');
    if(attempt===this.attempt)this.select(provider,kind);
   }else{
    const provider=await this.mobile();
    if(attempt!==this.attempt)return;
    const accounts=await provider.enable();
    if(!accounts.length)throw Error('No wallet account was connected.');
    if(attempt===this.attempt)this.select(provider,kind);
    else await provider.disconnect?.();
   }
  })();
  this.pending=work.finally(()=>{this.pending=null;});
  return this.pending;
 }
 async disconnect(){
  this.attempt++;
  const previous=this.active,kind=this.kind;
  this.select(null,null);
  if(kind==='walletconnect')await previous?.disconnect?.();
 }
}

let mobileProvider:Promise<MobileProvider>|undefined;
async function loadMobileProvider():Promise<MobileProvider>{
 if(!walletConnectReady)throw Error('Mobile wallet connections are not available yet. Please use a browser wallet.');
 if(![56,97].includes(chainId))throw Error('Unsupported configured network.');
 if(!mobileProvider)mobileProvider=(async()=>{
  const {EthereumProvider}=await import('@walletconnect/ethereum-provider');
  return EthereumProvider.init({
   projectId:walletConnectProjectId,
   optionalChains:[chainId],
   optionalMethods:['eth_sendTransaction','wallet_switchEthereumChain','wallet_addEthereumChain'],
   showQrModal:true,
   rpcMap:{[chainId]:chainId===97?'https://bsc-testnet-dataseed.bnbchain.org':'https://bsc-dataseed.bnbchain.org'},
   metadata:{name:'Global Drop Trade',description:'Global Drop Trade wallet connection',url:window.location.origin,icons:[new URL('/favicon.svg',window.location.origin).href]},
   qrModalOptions:{themeMode:'dark',themeVariables:{'--wcm-accent-color':'#c9ae70'}},
  }) as Promise<MobileProvider>;
 })().catch(error=>{mobileProvider=undefined;throw error;});
 return mobileProvider;
}
export const wallets=new WalletConnection(()=>typeof window==='undefined'?undefined:window.ethereum,loadMobileProvider);
export const getWalletProvider=()=>wallets.getProvider();
export async function switchWalletNetwork(){
 const provider=getWalletProvider();
 if(!provider)throw Error('Connect your wallet first.');
 if(![56,97].includes(chainId))throw Error('Unsupported configured network.');
 const hex='0x'+chainId.toString(16);
 try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]});}
 catch(error){
  if(Number((error as {code?:number}).code)!==4902)throw error;
  await provider.request({method:'wallet_addEthereumChain',params:[{chainId:hex,chainName,nativeCurrency:{name:chainId===97?'Test BNB':'BNB',symbol:chainId===97?'tBNB':'BNB',decimals:18},rpcUrls:[chainId===97?'https://bsc-testnet-dataseed.bnbchain.org':'https://bsc-dataseed.bnbchain.org'],blockExplorerUrls:[explorer]}]});
  await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]});
 }
}
