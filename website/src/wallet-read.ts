import type {Eip1193Provider} from 'ethers';

const walletReadTimeoutMs=8_000;
type SelectionMethod='eth_accounts'|'eth_chainId';

// These are non-interactive reads only. Prompts, signatures and transaction
// submissions must not inherit this deadline or be retried automatically.
export async function readWalletValue(provider:Eip1193Provider,method:SelectionMethod):Promise<unknown>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([
  provider.request({method}),
  new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>reject(Error('The wallet did not answer the account or network read. Open your wallet and retry.')),walletReadTimeoutMs);
  })
 ]);}finally{if(timer!==undefined)clearTimeout(timer);}
}

export async function readWalletSelection(provider:Eip1193Provider){
 const [accounts,chainId]=await Promise.all([
  readWalletValue(provider,'eth_accounts'),readWalletValue(provider,'eth_chainId')
 ]);
 return {accounts,chainId};
}
