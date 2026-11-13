#!/usr/bin/env node
// Read-only inquiry into the exact valueless ERC20 deployed on BNB Testnet and
// accepted by Global V2. No mint, approval, transfer, signature or private key.
import fs from 'node:fs';
import {Contract,FetchRequest,JsonRpcProvider,Interface,getAddress,formatUnits,parseUnits,keccak256} from 'ethers';

const VAULT=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const CODE_HASH='0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99';
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FUNDER=getAddress('0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d');
const ADMIN=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const OPERATIONS=getAddress('0x8c4AC9b009808a0B49Ba77b58e3871e7cDba463c');
const FEE_ONE=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const AMOUNT=parseUnits('1000000',18);
const RPC=[
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com',
 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'
];
const ABI=[
 'function name() view returns(string)',
 'function symbol() view returns(string)',
 'function decimals() view returns(uint8)',
 'function totalSupply() view returns(uint256)',
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function owner() view returns(address)',
 'function MINTER_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function mint(address,uint256)'
];
const probe=async(fun)=>{try{return {available:true,value:await fun()}}catch{return {available:false}};};
function providerOf(url){
 const req=new FetchRequest(url);req.timeout=9000;
 return new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--check')
  throw Error('Usage: node scripts/inspect-v2-test-token-issuer.mjs --check');
 let success, provider, errors=[];
 for(const url of RPC){
  const candidate=providerOf(url);
  try{
   const [chain,vaultCode,tokenCode]=await Promise.all([
    candidate.send('eth_chainId',[]),candidate.getCode(VAULT,'latest'),
    candidate.getCode(TOKEN,'latest')
   ]);
   if(Number(BigInt(chain))!==97||vaultCode==='0x'||tokenCode==='0x'||
       keccak256(vaultCode).toLowerCase()!==CODE_HASH)throw Error('PINNED_TESTNET_IDENTITY_MISMATCH');
   provider=candidate;
   success={rpc:url,chainId:97,vault:VAULT,vaultHash:keccak256(vaultCode),token:TOKEN,
    tokenCodeHash:keccak256(tokenCode)};
   break;
  }catch(e){errors.push(url+': '+String(e.message||e).slice(0,140));candidate.destroy();}
 }
 if(!provider){
  console.log('V2_TOKEN_ISSUER_RPC_UNAVAILABLE '+JSON.stringify({checkedAt:new Date().toISOString(),errors}));
  process.exitCode=2;return;
 }
 try{
  const t=new Contract(TOKEN,ABI,provider);
  const [name,symbol,decimals,totalSupply,owner,minterRole]=await Promise.all([
   probe(()=>t.name()),probe(()=>t.symbol()),probe(()=>t.decimals()),
   probe(()=>t.totalSupply()),probe(()=>t.owner()),probe(()=>t.MINTER_ROLE())
  ]);
  if(decimals.available&&Number(decimals.value)!==18)throw Error('PINNED_TOKEN_UNEXPECTED_DECIMALS');
  const addresses=[ADMIN,FUNDER,OPERATIONS,FEE_ONE];
  if(owner.available&&owner.value&&String(owner.value).startsWith('0x')){
   try{addresses.push(getAddress(owner.value));}catch{}
  }
  const unique=[...new Set(addresses)];
  const balances=[];
  for(const wallet of unique){
   const [res,gas,allowance]=await Promise.all([
    probe(()=>t.balanceOf(wallet)),probe(()=>provider.getBalance(wallet)),
    probe(()=>t.allowance(wallet,VAULT))
   ]);
   balances.push({wallet,testTokens:res.available?formatUnits(res.value,18):null,
    gasTestBNB:gas.available?formatUnits(gas.value,18):null,
    tokenAllowanceToV2:allowance.available?formatUnits(allowance.value,18):null,
    meetsExactMillion:res.available&&res.value>=AMOUNT,
    readyToApproveAndFund:res.available&&res.value>=AMOUNT&&gas.available&&gas.value>0n});
  }
  const roles=[];
  if(minterRole.available){
   for(const wallet of unique){
    const result=await probe(()=>t.hasRole(minterRole.value,wallet));
    roles.push({wallet,minterRoleGranted:result.available?Boolean(result.value):null});
   }
  }
  // eth_call never changes state. A no-revert response alone does NOT prove a
  // function exists or its signed transaction can be sent. This is advisory only.
  const iface=new Interface(['function mint(address,uint256)']);
  const selector=iface.getFunction('mint').selector;
  const candidates=[];
  for(const wallet of unique){
   const result=await probe(()=>provider.call({
    from:wallet,to:TOKEN,data:iface.encodeFunctionData('mint',[FUNDER,AMOUNT])
   },'latest'));
   candidates.push({from:wallet,noRevertInReadOnlySimulation:result.available});
  }
  const currentVaultCash=await probe(()=>t.balanceOf(VAULT));
  const output={
   version:1,checkedAt:new Date().toISOString(),mode:'READ_ONLY_BNB_TESTNET',
   ...success,name:name.available?name.value:null,
   symbol:symbol.available?symbol.value:null,
   decimals:decimals.available?Number(decimals.value):null,
   totalSupplyTestUnits:totalSupply.available?formatUnits(totalSupply.value,18):null,
   owner:owner.available?String(owner.value):null,
   requiredMintOrTransfer:'1000000',
   fundingWallet:FUNDER,balances,roles,
   currentVaultTestTokens:currentVaultCash.available?formatUnits(currentVaultCash.value,18):null,
   mintProbe:{selector,readOnlySimulations:candidates,
    warning:'eth_call no-revert does not prove mint authorization, token issuance or a real transfer'},
   fundingTransactionSubmitted:false,
   reason:'No private signing keys or wallet token balance available to this job',
   nextAction:balances.some(b=>b.meetsExactMillion)?
    'An authorized holder may sign an exact test-token transfer to the designated funding wallet':
    'Determine token minter permissions and obtain one million exact test tokens from an authorized issuer',
   realTether:false
  };
  fs.mkdirSync('reports',{recursive:true});
  fs.writeFileSync('reports/v2-test-token-issuer-readonly.json',JSON.stringify(output,null,2)+'\n');
  console.log('V2_TEST_TOKEN_ISSUER_DIAGNOSIS '+JSON.stringify(output));
 }finally{provider.destroy();}
}
main().catch(e=>{console.error('V2_TEST_TOKEN_ISSUER_DIAGNOSIS_FAILED '+String(e.message||e));process.exitCode=1;});
