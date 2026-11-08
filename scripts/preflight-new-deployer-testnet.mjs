// Validate a staged replacement-deployer site release before API/frontend cutover.
// It only writes an exclusive file inside the supplied private staging directory.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {
    NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_RELEASE_ID,NEW_DEPLOYER_STATE_DIR
} from './new-deployer-testnet-profile.mjs';
import {
    assertImmutableV1Archive,readImmutableV1Archive,readNewDeployerPrivateText,
    verifyNewDeployerTestnetCreation
} from './connect-new-deployer-testnet.mjs';

function privateDirectory(directory){
    const stat=fs.lstatSync(directory);
    if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_STAGE_REQUIRED');
}

function writeExclusive(file,value){
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

async function main(){
    const [directoryArg,...extra]=process.argv.slice(2);
    if(!directoryArg||extra.length)throw Error('NEW_DEPLOYER_STAGE_DIRECTORY_REQUIRED');
    if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
    const directory=path.resolve(directoryArg);privateDirectory(directory);
    const stagedEnv=readNewDeployerPrivateText(path.join(directory,'trades.env'));
    const stage=JSON.parse(readNewDeployerPrivateText(path.join(directory,'new-deployer-testnet-connection.json')));
    const settings=parseEnv(stagedEnv),config=readConfig(settings);
    if(config.chainId!==97||config.port!==3115||settings.GLOBAL_MIGRATION_ENABLED!=='false'||settings.TRADES_ZERO_START_PROFILE!==NEW_DEPLOYER_RELEASE_ID||settings.GLOBAL_AUTOMATION_PUBLIC_STATUS!=='/var/www/globaldroptrade/automation-data/new-deployer-activation.json'||!config.rpcUrl||!config.address)throw Error('NEW_DEPLOYER_STAGED_API_CONFIGURATION_REQUIRED');
    const archive=readImmutableV1Archive();
    if(stage?.archiveSessionSha256!==archive.digest||stage?.target!==config.address)throw Error('NEW_DEPLOYER_STAGED_IDENTITY_CHANGED');
    const deploymentReport=JSON.parse(readNewDeployerPrivateText(path.join(NEW_DEPLOYER_STATE_DIR,'deployment-public.json')));
    const artifact=JSON.parse(fs.readFileSync(NEW_DEPLOYER_ARTIFACT_FILE,'utf8'));
    const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
    const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
    try{
        const verified=await verifyNewDeployerTestnetCreation({provider,artifact,deploymentReport,archive,confirmations:Math.max(3,config.confirmations)});
        if(verified.target!==config.address||verified.block!==config.startBlock||verified.runtimeHash!==stage.runtimeHash||verified.queue!==stage.queue)throw Error('NEW_DEPLOYER_STAGED_IDENTITY_CHANGED');
        assertImmutableV1Archive(archive);
        writeExclusive(path.join(directory,'connection-public.json'),JSON.stringify({version:1,chainId:97,vaultAddress:verified.target,target:verified.target,owner:verified.owner,operator:verified.operator,queue:verified.queue,runtimeHash:verified.runtimeHash,releaseId:verified.releaseId,artifact:verified.artifact,verified:true},null,2)+'\n');
        console.log('NEW_DEPLOYER_STAGED_API_PREFLIGHT_OK '+verified.target);
    }finally{provider.destroy();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{
    console.error('NEW_DEPLOYER_STAGED_API_PREFLIGHT_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message||'')?error.message:'RPC_OR_VERIFICATION_FAILED'));
    process.exitCode=1;
});
