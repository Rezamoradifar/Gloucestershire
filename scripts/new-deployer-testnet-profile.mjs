import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ZeroAddress,getAddress} from 'ethers';

export const NEW_DEPLOYER_RELEASE_ID='global-new-deployer-testnet-v1';
export const NEW_DEPLOYER_ARTIFACT='FastNewDeployerTestnetVault';
export const NEW_DEPLOYER_ADDRESS='0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d';
export const NEW_DEPLOYER_ARTIFACT_HASH='0x2767ba61eec410785c6d861e09318e6992dd971517945c2c4d666f34ec644362';
export const NEW_DEPLOYER_STATE_DIR='/var/lib/globaldroptrade/new-deployer-testnet-v1';
export const NEW_DEPLOYER_KEY_FILE='/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key';
export const LEGACY_ARCHIVE_SESSION='/var/lib/globaldroptrade/fresh-fast-reset-20261107/session.json';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const NEW_DEPLOYER_CONFIG_FILE=path.join(root,'config/new-deployer-testnet.json');
export const NEW_DEPLOYER_ARTIFACT_FILE=path.join(root,'artifacts/FastNewDeployerTestnetVault.json');
const ORIGINAL_RELEASE_FILE=path.join(root,'config/fresh-fast-testnet.json');

const address=(value,code)=>{
    try {
        const result=getAddress(value);
        if(result===ZeroAddress) throw Error();
        return result;
    } catch {
        throw Error(code);
    }
};

export function validateNewDeployerRelease(value) {
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||
        value.releaseId!==NEW_DEPLOYER_RELEASE_ID||value.chainId!==97||
        value.artifact!==NEW_DEPLOYER_ARTIFACT||String(value.artifactHash||'').toLowerCase()!==NEW_DEPLOYER_ARTIFACT_HASH||
        !/^[1-9][0-9]*$/.test(String(value.age))||BigInt(value.age)>604800n||
        value.testMode!==true||value.initialServerReporter!==true||value.fastTestnetVersion!==1||
        value.newDeployerTestnetVersion!==1||value.fastNewDeployerTestnetVersion!==1) {
        throw Error('NEW_DEPLOYER_RELEASE_REQUIRED');
    }
    const owner=address(value.owner,'NEW_DEPLOYER_OWNER_REQUIRED');
    const deployer=address(value.deployer,'NEW_DEPLOYER_ADDRESS_REQUIRED');
    const token=address(value.token,'NEW_DEPLOYER_TOKEN_REQUIRED');
    const bnbFeed=address(value.bnbFeed,'NEW_DEPLOYER_BNB_FEED_REQUIRED');
    const tokenFeed=address(value.tokenFeed,'NEW_DEPLOYER_TOKEN_FEED_REQUIRED');
    const operations=address(value.operations,'NEW_DEPLOYER_OPERATIONS_REQUIRED');
    if(deployer!==NEW_DEPLOYER_ADDRESS||owner===deployer||[owner,deployer,token,bnbFeed,tokenFeed,operations].filter((entry,index,all)=>all.indexOf(entry)!==index).length) {
        throw Error('NEW_DEPLOYER_ROLE_COLLISION');
    }
    if(!Array.isArray(value.partners)||value.partners.length!==7) throw Error('NEW_DEPLOYER_PARTNERS_REQUIRED');
    let partners;
    try { partners=value.partners.map(getAddress); } catch { throw Error('NEW_DEPLOYER_PARTNERS_REQUIRED'); }
    if(new Set(partners).size!==7||partners.includes(ZeroAddress)||partners.some(partner=>[owner,deployer,token,bnbFeed,tokenFeed,operations].includes(partner))) {
        throw Error('NEW_DEPLOYER_PARTNERS_REQUIRED');
    }
    let original;
    try { original=JSON.parse(fs.readFileSync(ORIGINAL_RELEASE_FILE,'utf8')); } catch { throw Error('NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED'); }
    const originalOwner=address(original.owner,'NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED');
    const originalToken=address(original.token,'NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED');
    const originalBnbFeed=address(original.bnbFeed,'NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED');
    const originalTokenFeed=address(original.tokenFeed,'NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED');
    const originalOperations=address(original.operations,'NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED');
    let originalPartners;
    try { originalPartners=original.partners.map(getAddress); } catch { throw Error('NEW_DEPLOYER_ORIGINAL_RELEASE_REQUIRED'); }
    if(owner!==originalOwner||token!==originalToken||bnbFeed!==originalBnbFeed||tokenFeed!==originalTokenFeed||
        operations!==originalOperations||String(value.age)!==String(original.age)||!samePartners(partners,originalPartners)) {
        throw Error('NEW_DEPLOYER_ORIGINAL_SETTINGS_REQUIRED');
    }
    return {
        version:1,releaseId:NEW_DEPLOYER_RELEASE_ID,chainId:97,artifact:NEW_DEPLOYER_ARTIFACT,
        artifactHash:value.artifactHash.toLowerCase(),owner,deployer,token,bnbFeed,tokenFeed,
        age:String(value.age),partners,operations,testMode:true,initialServerReporter:true,fastTestnetVersion:1,
        newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1
    };
}

function samePartners(left,right) {
    return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>value===right[index]);
}

export function loadNewDeployerRelease(file=NEW_DEPLOYER_CONFIG_FILE) {
    let value;
    try { value=JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw Error('NEW_DEPLOYER_RELEASE_FILE_REQUIRED'); }
    return validateNewDeployerRelease(value);
}
