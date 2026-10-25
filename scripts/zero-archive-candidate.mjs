// Read one explicitly selected candidate without exposing its URL in reports.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const publicZeroArchiveRpcUrl='https://bsc-testnet-rpc.publicnode.com';
const sha256=value=>createHash('sha256').update(value).digest('hex');

export function validateZeroArchiveCandidateUrl(value){
 if(typeof value!=='string'||!value||Buffer.byteLength(value,'utf8')>16384||/[\s\p{Cc}"'\\]/u.test(value))throw Error('ARCHIVE_RPC_HTTPS_CANDIDATE_REQUIRED');
 let url;
 try{url=new URL(value);}catch{throw Error('ARCHIVE_RPC_HTTPS_CANDIDATE_REQUIRED');}
 if(url.protocol!=='https:'||!/^https:\/\//i.test(value)||!url.hostname||url.username||url.password||url.hash||value.includes('#')||/^https:\/\/[^/?#]*@/i.test(value))throw Error('ARCHIVE_RPC_HTTPS_CANDIDATE_REQUIRED');
 return value;
}

function privateCandidate(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('ARCHIVE_RPC_ABSOLUTE_CANDIDATE_FILE_REQUIRED');
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch{throw Error('ARCHIVE_RPC_PRIVATE_CANDIDATE_FILE_REQUIRED');}
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o777)!==0o600||s.size<1||s.size>16384)throw Error('ARCHIVE_RPC_PRIVATE_CANDIDATE_FILE_REQUIRED');
  const bytes=fs.readFileSync(fd),text=bytes.toString('utf8');
  if(bytes.length<1||bytes.length>16384)throw Error('ARCHIVE_RPC_PRIVATE_CANDIDATE_FILE_REQUIRED');
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('ARCHIVE_RPC_UTF8_CANDIDATE_FILE_REQUIRED');
  const value=text.endsWith('\r\n')?text.slice(0,-2):text.endsWith('\n')?text.slice(0,-1):text;
  const url=validateZeroArchiveCandidateUrl(value);
  return {url,bytes,proof:{kind:'private',sha256:sha256(url),fileSha256:sha256(bytes)}};
 }finally{fs.closeSync(fd);}
}

export function readZeroArchiveCandidate(candidateFile){
 if(candidateFile===undefined)return {url:publicZeroArchiveRpcUrl,proof:{kind:'public',sha256:sha256(publicZeroArchiveRpcUrl),fileSha256:null},assertCurrent:()=>{}};
 const selected=privateCandidate(candidateFile);
 return {url:selected.url,proof:selected.proof,assertCurrent:()=>{
  const current=privateCandidate(candidateFile);
  if(!current.bytes.equals(selected.bytes))throw Error('ARCHIVE_RPC_CANDIDATE_FILE_CHANGED');
 }};
}
