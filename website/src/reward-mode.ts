import type {Contract} from 'ethers';
export const deferredAbi=[
 'function REWARD_ACCRUAL_VERSION() view returns(uint256)',
 'function withdrawalQueue() view returns(address)',
 'function claimNetworkRewards(uint256 group,uint8 expectedStage,uint8 count)'
];
export const queueAbi=[
 'function vault() view returns(address)',
 'function pending(address) view returns(uint256)',
 'function hasPending(address,address) view returns(bool)',
 'function requestCount() view returns(uint256)',
 'function userRequestCount(address) view returns(uint256)',
 'function userRequestId(address,uint256) view returns(uint256)',
 'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)',
 'function pay(uint256)', 'function cancel(uint256)',
 'error InvalidRequest()', 'error InsufficientLiquidity()'
];
export async function hasDeferredRewards(vault:Contract,options:Record<string,unknown>={}):Promise<boolean>{
 if(typeof vault.REWARD_ACCRUAL_VERSION!=='function')return false;
 try{const version=await vault.REWARD_ACCRUAL_VERSION(options);if(version!==1n)throw Error('Unsupported reward accounting version.');return true;}
 catch(e){if((e as {code?:string}).code==='CALL_EXCEPTION')return false;throw e;}
}
