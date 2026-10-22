import {isAddress,ZeroAddress} from 'ethers';
import {fetchPublicConfig,type PublicConfig} from './runtime-config';
export let chainId=Number(import.meta.env.VITE_CHAIN_ID||97);
export let vaultAddress=String(import.meta.env.VITE_VAULT_ADDRESS||'').trim();
export let configured=[56,97].includes(chainId)&&isAddress(vaultAddress)&&vaultAddress!==ZeroAddress;
export let chainName=chainId===56?'BNB Smart Chain':'BNB Testnet';
export let explorer=chainId===56?'https://bscscan.com':'https://testnet.bscscan.com';
let loaded=false;
export function acceptPublicConfig(next:PublicConfig){
 if(configured&&(chainId!==next.chainId||vaultAddress.toLowerCase()!==next.vaultAddress.toLowerCase()))throw Error('The website and API point to different contracts. The connection is stopped.');
 if(loaded&&(chainId!==next.chainId||vaultAddress.toLowerCase()!==next.vaultAddress.toLowerCase()))throw Error('The contract changed during this session. Reload the website.');
 chainId=next.chainId;vaultAddress=next.vaultAddress;configured=true;loaded=true;
 chainName=chainId===56?'BNB Smart Chain':'BNB Testnet';explorer=chainId===56?'https://bscscan.com':'https://testnet.bscscan.com';
}
export async function loadRuntimeConfig(){acceptPublicConfig(await fetchPublicConfig());}
export const feeWallets=['0x7037cc199499d7a3431285a01e435454eae51265','0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632','0x74015dedf36677485793f1714ec7bd4893907b26'];
