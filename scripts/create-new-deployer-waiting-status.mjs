// Create a target-bound waiting status only if no status exists; preserve evidence.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {getAddress,ZeroAddress} from 'ethers';

export function ensureNewDeployerWaitingStatus({file,target,expectedUid=0,now=()=>new Date()}){
 target=getAddress(target);
 if(target===ZeroAddress)throw Error('NEW_DEPLOYER_STATUS_TARGET_REQUIRED');
 const directory=path.dirname(file),parent=fs.lstatSync(directory);
 if(!parent.isDirectory()||parent.uid!==expectedUid||(parent.mode&0o022)!==0)throw Error('NEW_DEPLOYER_STATUS_DIRECTORY_REQUIRED');
 const temporary=path.join(directory,'.new-deployer-status-'+randomBytes(16).toString('hex'));
 let created=false;
 try{
  const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o644);created=true;
  try{
   const value={version:1,kind:'new-deployer-testnet-waiting',chainId:97,target,checkedAt:now().toISOString(),ready:false,timerActive:false,dailyAutomationActive:false,automationStatus:'waiting',dailyStatus:'waiting',blockers:['FIRST_NEW_DEPLOYER_WORKER_CYCLE_REQUIRED']};
   fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fchmodSync(fd,0o644);fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  try{fs.linkSync(temporary,file);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{
    const s=fs.fstatSync(existing);
    if(!s.isFile()||s.uid!==expectedUid||(s.mode&0o022)!==0||s.size>2097152)throw Error('NEW_DEPLOYER_EXISTING_STATUS_REVIEW_REQUIRED');
    const value=JSON.parse(fs.readFileSync(existing,'utf8'));
    if(Number(value.chainId)!==97||getAddress(value.target??value.automation?.target)!==target)throw Error('NEW_DEPLOYER_EXISTING_STATUS_REVIEW_REQUIRED');
   }finally{fs.closeSync(existing);}
  }
  const dir=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{if(created)fs.unlinkSync(temporary);}
}

let invoked;try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked){
 try{
  if(process.getuid?.()!==0||process.argv.length!==3)throw Error('NEW_DEPLOYER_STATUS_PREPARE_REQUIRED');
  const info=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  if(info.version!==1||info.chainId!==97)throw Error('NEW_DEPLOYER_STATUS_PREPARE_REQUIRED');
  ensureNewDeployerWaitingStatus({file:'/var/www/globaldroptrade/automation-data/new-deployer-activation.json',target:info.target});
 }catch(error){console.error('NEW_DEPLOYER_STATUS_PREPARE_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(error.message||'')?error.message:'CHECK_REQUIRED'));process.exitCode=1;}
}
