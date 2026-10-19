import fs from 'node:fs';
import {Wallet} from 'ethers';

export function readPrivateKey(file) {
 if(!fs.existsSync(file))return null;
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('KEY_FILE_MUST_BE_ROOT_ONLY_MODE_600');
 const value=fs.readFileSync(file,'utf8').trim();
 if(!/^(0x)?[0-9a-fA-F]{64}$/.test(value))throw Error('INVALID_KEY_FILE');
 return value.startsWith('0x')?value:'0x'+value;
}

export function loadMigrationSigners({provider,owner,ownerFile,deployerFile,read=readPrivateKey}) {
 const key=read(deployerFile)||read('/root/global-testnet-v071/.testnet-server/deployer.key');
 if(!key)throw Error('DEPLOYER_KEY_NOT_FOUND');
 const deployer=new Wallet(key,provider);
 const ownerKey=read(ownerFile);
 const candidate=ownerKey?new Wallet(ownerKey,provider):null;
 // A previously supplied wrong owner key conveys no authority. It is not used for deployment either.
 const ownerWallet=candidate?.address===owner?candidate:deployer.address===owner?deployer:null;
 return {deployer,ownerWallet};
}
