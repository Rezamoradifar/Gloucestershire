// Read-only active-target verification. Never reads a signing key or changes a contract.
import fs from 'node:fs';
import {Contract,FetchRequest,JsonRpcProvider,keccak256,ZeroAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
const out=process.argv[2];if(!out)throw Error('OUTPUT_DIRECTORY_REQUIRED');
const config=readConfig();if(!config.address||!config.rpcUrl||config.port!==3115)throw Error('ACTIVE_API_CONFIGURATION_REQUIRED');
const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{
 if(Number((await provider.getNetwork()).chainId)!==config.chainId)throw Error('ACTIVE_CHAIN_MISMATCH');
 const code=await provider.getCode(config.address);if(code==='0x')throw Error('ACTIVE_CONTRACT_MISSING');
 const v=new Contract(config.address,['function owner() view returns(address)','function FEE_WALLET_1() view returns(address)','function FEE_WALLET_2() view returns(address)','function WITHDRAWAL_FEE_WALLET() view returns(address)','function withdrawalQueue() view returns(address)'],provider);
 const [owner,first,second,fee]=await Promise.all([v.owner(),v.FEE_WALLET_1(),v.FEE_WALLET_2(),v.WITHDRAWAL_FEE_WALLET()]);
 const expected=['0x7037cc199499d7a3431285a01e435454eae51265','0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632','0x74015dedf36677485793f1714ec7bd4893907b26'];
 if([first,second,fee].some((a,i)=>a.toLowerCase()!==expected[i])||owner===ZeroAddress)throw Error('ACTIVE_CONTRACT_IDENTITY_MISMATCH');
 let approvalRequired=false;
 try{const queue=new Contract(await v.withdrawalQueue(),['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)'],provider);if((await queue.vault()).toLowerCase()!==config.address.toLowerCase())throw Error('UNEXPECTED_QUEUE');approvalRequired=await queue.APPROVAL_VERSION()===1n;}catch(e){if(e.code!=='CALL_EXCEPTION')throw e;}
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 fs.writeFileSync(out+'/connection-public.json',JSON.stringify({version:1,chainId:config.chainId,vaultAddress:config.address,owner,runtimeHash:keccak256(code),approvalRequired},null,2),{mode:0o600});
 console.log('ACTIVE_TARGET_VERIFIED chain='+config.chainId+' approval='+(approvalRequired?'enforced':'requires-new-deployment'));
}catch(e){console.error('ACTIVE_TARGET_CHECK_FAILED '+(/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:'RPC_OR_VALIDATION_FAILED'));process.exitCode=1;}finally{provider.destroy();}
