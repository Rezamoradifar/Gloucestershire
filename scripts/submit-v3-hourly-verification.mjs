// Submit only the pinned BNB Testnet hourly source to Etherscan V2. This
// publishes source; it does not use a wallet, sign or submit chain transactions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FetchRequest,JsonRpcProvider,getAddress,keccak256} from 'ethers';
import {prepareHourlyVerification,contractAddress,contractName,compilerVersion,
 constructorArguments,expectedCreationHash} from './prepare-v3-hourly-verification.mjs';
import {checkHourlyProof,verifiedHourlyDeployment} from './verify-v3-hourly-testnet.mjs';

const origin='https://api.etherscan.io/v2/api';
const proofPath='/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json';
const journalPath='/var/lib/globaldroptrade/v3-hourly-testnet/explorer-verification.json';
const txhash=/^0x[0-9a-fA-F]{64}$/;
const guidPattern=/^[A-Za-z0-9]{20,128}$/;
const keyPattern=/^[A-Za-z0-9_-]{8,128}$/;
const states=new Set(['SUBMITTING','PENDING','UNKNOWN','FAILED','VERIFIED']);

function explorerUrl(key,action,extra={}){
 if(!keyPattern.test(key))throw Error('INVALID_EXPLORER_API_KEY_FORMAT');
 if(!['getsourcecode','checkverifystatus','verifysourcecode'].includes(action)||
  Object.keys(extra).some(k=>!['address','guid'].includes(k)))throw Error('INVALID_EXPLORER_REQUEST');
 const u=new URL(origin);
 for(const [k,v] of Object.entries({...extra,chainid:'97',module:'contract',action,apikey:key}))u.searchParams.set(k,v);
 return u;
}

// Injectable transport enables tests without any actual network access. Never
// print URLs or raw errors: explorer keys are passed as a query parameter.
export async function explorerRequest(key,action,body=null,extra={},transport=fetch){
 let response,payload;
 const url=explorerUrl(key,action,extra);
 try{
  response=await transport(url,{
   method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),
   ...(body?{headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)}:{})
  });
  if(!response.ok)throw Error('HTTP_FAILURE');
  const text=await response.text();
  if(text.length>4000000)throw Error('RESPONSE_TOO_LARGE');
  payload=JSON.parse(text);
 }catch{throw Error(action==='verifysourcecode'?'EXPLORER_SUBMISSION_OUTCOME_UNKNOWN':'EXPLORER_REQUEST_FAILED');}
 if(!payload||typeof payload!=='object')throw Error(action==='verifysourcecode'?'EXPLORER_SUBMISSION_OUTCOME_UNKNOWN':'EXPLORER_RESPONSE_INVALID');
 return payload;
}

export function explorerSourceStatus(response){
 if(response?.status!=='1'||!Array.isArray(response.result)||response.result.length!==1)
  throw Error('EXPLORER_SOURCE_STATUS_UNAVAILABLE');
 const row=response.result[0];
 if(!row||typeof row.SourceCode!=='string')throw Error('EXPLORER_SOURCE_STATUS_UNAVAILABLE');
 if(!row.SourceCode.trim())return 'UNVERIFIED';
 if(row.ContractName!=='GlobalV3HourlyTestnet'||typeof row.CompilerVersion!=='string'||
   !row.CompilerVersion.startsWith(compilerVersion))throw Error('EXPLORER_SOURCE_IDENTITY_MISMATCH');
 return 'VERIFIED';
}

export function submissionForm(input){
 return {contractaddress:contractAddress,sourceCode:JSON.stringify(input),
  contractname:contractName,compilerversion:compilerVersion,
  codeformat:'solidity-standard-json-input',optimizationUsed:'1',runs:'1',
  constructorArguments,evmVersion:'shanghai',licenseType:'3'};
}

export function submissionGuid(response){
 if(response?.status==='1'&&typeof response.result==='string'&&guidPattern.test(response.result))return response.result;
 // A non-success answer must be reconciled manually; no blind resubmission.
 throw Error('EXPLORER_SUBMISSION_REJECTED_OR_UNKNOWN');
}

function privateFile(file){
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)!==0||s.size>30000)
  throw Error('VERIFICATION_PRIVATE_FILE_UNSAFE');
 return s;
}
function privateJournalDirectory(){
 const s=fs.lstatSync(path.dirname(journalPath));
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)!==0)
  throw Error('VERIFICATION_JOURNAL_DIRECTORY_UNSAFE');
}
function readProof(){
 privateFile(proofPath);
 const proof=checkHourlyProof(JSON.parse(fs.readFileSync(proofPath,'utf8')));
 if(proof.contract!==contractAddress||proof.creationBytecodeHash!==expectedCreationHash)
  throw Error('VERIFICATION_DEPLOYMENT_PROOF_MISMATCH');
 return proof;
}
function readJournal(){
 privateJournalDirectory();
 if(!fs.existsSync(journalPath))return null;
 privateFile(journalPath);
 const data=JSON.parse(fs.readFileSync(journalPath,'utf8'));
 if(data?.chainId!==97||data?.contract!==contractAddress||!states.has(data?.status)||
  (data.guid!==undefined&&(typeof data.guid!=='string'||!guidPattern.test(data.guid))))
  throw Error('VERIFICATION_JOURNAL_INVALID');
 return data;
}
function writeJournal(data,create=false){
 privateJournalDirectory();
 const body=JSON.stringify(data,null,2)+'\n';
 if(create){fs.writeFileSync(journalPath,body,{flag:'wx',mode:0o600});return;}
 privateFile(journalPath);
 const tmp=journalPath+'.new-'+process.pid;
 try{fs.writeFileSync(tmp,body,{flag:'wx',mode:0o600});fs.renameSync(tmp,journalPath);}
 finally{try{fs.unlinkSync(tmp);}catch{}}
}

// Record intent before contacting the explorer. Once an attempt exists,
// neither an ambiguous response nor a timeout can trigger an automatic retry.
export async function submitOnce({key,input,read,write,request=explorerRequest}){
 if(read())throw Error('VERIFICATION_SUBMISSION_EXISTS_REVIEW_BEFORE_RETRY');
 const record={chainId:97,contract:contractAddress,status:'SUBMITTING',createdAt:new Date().toISOString()};
 write(record,true);
 try{
  const result=await request(key,'verifysourcecode',submissionForm(input));
  record.guid=submissionGuid(result);record.status='PENDING';write(record);
  return record.guid;
 }catch{
  record.status='UNKNOWN';write(record);
  throw Error('VERIFICATION_SUBMISSION_OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY');
 }
}

// The deployment receipt/runtime are verified by the existing pinned guard.
// Check exact constructor bytes and creation bytecode from the chain as well.
export async function verifyCreation(proof,provider){
 const [chain,tx,receipt]=await Promise.all([
  provider.send('eth_chainId',[]),provider.getTransaction(proof.txHash),provider.getTransactionReceipt(proof.txHash)
 ]);
 if(BigInt(chain)!==97n||!tx||!receipt||receipt.status!==1||tx.to!==null||
   receipt.contractAddress===null||getAddress(receipt.contractAddress)!==contractAddress||
   tx.hash.toLowerCase()!==proof.txHash.toLowerCase()||receipt.hash.toLowerCase()!==proof.txHash.toLowerCase()||
   typeof tx.data!=='string'||!tx.data.toLowerCase().endsWith(constructorArguments.toLowerCase()))
  throw Error('VERIFICATION_CREATION_TRANSACTION_MISMATCH');
 const creation='0x'+tx.data.slice(2,-constructorArguments.length);
 if(keccak256(creation)!==expectedCreationHash)throw Error('VERIFICATION_CREATION_BYTECODE_MISMATCH');
}

async function checkChain(proof){
 await verifiedHourlyDeployment(proof);
 for(const url of ['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']){
  const req=new FetchRequest(url);req.timeout=9000;
  const p=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{await verifyCreation(proof,p);return;}catch{}finally{p.destroy();}
 }
 throw Error('VERIFICATION_CREATION_UNAVAILABLE');
}

// Raw TTY mode suppresses echo; no API key is accepted via argv or env.
async function promptKey(){
 if(!process.stdin.isTTY||!process.stdout.isTTY||typeof process.stdin.setRawMode!=='function')
  throw Error('VERIFICATION_INTERACTIVE_TERMINAL_REQUIRED');
 const stdin=process.stdin,wasRaw=Boolean(stdin.isRaw);
 process.stdout.write('Etherscan API key (hidden; not a wallet key): ');
 try{
  stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
  return await new Promise((resolve,reject)=>{
   let value='';
   const cleanup=()=>{stdin.off('data',onData);process.off('SIGTERM',onTerm);};
   const onTerm=()=>{cleanup();reject(Error('VERIFICATION_CANCELLED'));};
   const onData=chunk=>{
    for(const char of chunk){
     if(char==='\u0003'||char==='\u0004'){cleanup();reject(Error('VERIFICATION_CANCELLED'));return;}
     if(char==='\r'||char==='\n'){cleanup();if(!keyPattern.test(value))reject(Error('INVALID_EXPLORER_API_KEY_FORMAT'));else resolve(value);return;}
     if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue;}
     if(!/[A-Za-z0-9_-]/.test(char)||value.length>=128){cleanup();reject(Error('INVALID_EXPLORER_API_KEY_FORMAT'));return;}
     value+=char;
    }
   };
   stdin.on('data',onData);process.once('SIGTERM',onTerm);
  });
 }finally{stdin.setRawMode(wasRaw);stdin.pause();process.stdout.write('\n');}
}

async function sourceStatus(key){
 return explorerSourceStatus(await explorerRequest(key,'getsourcecode',null,{address:contractAddress}));
}
async function main(){
 const mode=process.argv[2];
 if(process.getuid?.()!==0||process.argv.length!==3||!['--check','--submit'].includes(mode))
  throw Error('VERIFICATION_ROOT_AND_MODE_REQUIRED');
 const journal=readJournal();
 const key=await promptKey();
 const status=await sourceStatus(key);
 if(status==='VERIFIED'){
  if(journal&&journal.status!=='VERIFIED')writeJournal({...journal,status:'VERIFIED'});
  console.log('V3_HOURLY_EXPLORER_SOURCE_VERIFIED');return;
 }
 if(mode==='--check'){
  if(journal?.guid){
   const response=await explorerRequest(key,'checkverifystatus',null,{guid:journal.guid});
   const text=typeof response?.result==='string'?response.result.toLowerCase():'';
   if(text.includes('pending')||text.includes('queue')||text.includes('verified'))console.log('V3_HOURLY_EXPLORER_STATUS_PENDING_CHECK_LATER');
   else console.log('V3_HOURLY_EXPLORER_STATUS_REVIEW_REQUIRED');
  }else console.log(journal?'V3_HOURLY_EXPLORER_PREVIOUS_SUBMISSION_REVIEW_REQUIRED':'V3_HOURLY_EXPLORER_SOURCE_NOT_VERIFIED');
  return;
 }
 if(journal)throw Error('VERIFICATION_SUBMISSION_EXISTS_REVIEW_BEFORE_RETRY');
 const proof=readProof();
 await checkChain(proof);
 const input=prepareHourlyVerification();
 const guid=await submitOnce({key,input,read:readJournal,write:writeJournal});
 console.log('V3_HOURLY_EXPLORER_SUBMITTED '+JSON.stringify({guid,verified:false}));
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
 main().catch(error=>{console.error('V3_HOURLY_EXPLORER_ERROR '+String(error?.message||'unknown'));process.exitCode=1;});
