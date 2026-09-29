import {isAddress,ZeroAddress} from 'ethers';
export const chainId=Number(import.meta.env.VITE_CHAIN_ID||97);
export const vaultAddress=String(import.meta.env.VITE_VAULT_ADDRESS||'').trim();
export const configured=[56,97].includes(chainId)&&isAddress(vaultAddress)&&vaultAddress!==ZeroAddress;
export const chainName=chainId===56?'BNB Smart Chain':'BNB Testnet';
export const explorer=chainId===56?'https://bscscan.com':'https://testnet.bscscan.com';
export const feeWallets=['0x7037cc199499d7a3431285a01e435454eae51265','0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632','0x74015dedf36677485793f1714ec7bd4893907b26'];
