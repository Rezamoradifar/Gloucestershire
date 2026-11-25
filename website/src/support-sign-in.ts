import {BrowserProvider,isAddress} from 'ethers';
import {getWalletProvider} from './wallet';
import {readWalletSelection} from './wallet-read';

type AuthRequest = <T>(route:string, method:string, body:unknown)=>Promise<T>;

export async function signInSupport(who:string,contract:string,chainId:number,valid:()=>boolean,request:AuthRequest):Promise<string>{
 if(!isAddress(who))throw Error('Connect a valid wallet.');
 const wallet=getWalletProvider();if(!wallet)throw Error('Connect a wallet before signing in.');
 const check=async()=>{
  if(!valid()||wallet!==getWalletProvider())throw Error('Wallet context changed.');
  const {chainId:chain,accounts}=await readWalletSelection(wallet);
  if(!valid()||Number(chain)!==chainId||!Array.isArray(accounts)||
    accounts[0]?.toLowerCase()!==who.toLowerCase())
   throw Error('Connect the same wallet on BNB Testnet (97).');
 };
 await check();
 const challenge=await request<{nonce:string;message:string}>('challenge','POST',{wallet:who});
 const origin=window.location.origin;
 const allowed=[origin];
 if(origin==='https://www.globaldroptrade.com')allowed.push('https://globaldroptrade.com');
 if(origin==='https://globaldroptrade.com')allowed.push('https://www.globaldroptrade.com');
 const lines=challenge.message?.split('\n');
 if(!/^[a-f0-9]{48}$/.test(challenge.nonce)||lines?.length!==8||
  lines[0]!=='GlobalDropTrade support sign-in'||!lines[1]?.startsWith('Origin: ')||
  !allowed.includes(lines[1].slice(8))||lines[2]!=='Chain: '+chainId||
  lines[3]?.toLowerCase()!=='Contract: '.concat(contract).toLowerCase()||
  lines[4]?.toLowerCase()!=='Wallet: '.concat(who).toLowerCase()||
  lines[5]!=='Nonce: '+challenge.nonce||!lines[6]?.startsWith('Expires: ')||
  !Number.isFinite(Date.parse(lines[6].slice(9)))||Date.parse(lines[6].slice(9))<=Date.now()||
  lines[7]!=='This signature authenticates support access only. It does not authorize a transaction.')
  throw Error('Support challenge does not match this wallet and workspace.');
 const provider=new BrowserProvider(wallet);
 try{
  await check();
  const signature=await (await provider.getSigner(who)).signMessage(challenge.message);
  await check();
  const result=await request<{token:string;wallet:string}>('session','POST',{nonce:challenge.nonce,signature});
  if(!/^[a-f0-9]{64}$/.test(result.token)||result.wallet?.toLowerCase()!==who.toLowerCase())throw Error('Invalid support session.');
  await check();return result.token;
 }finally{provider.destroy();}
}
