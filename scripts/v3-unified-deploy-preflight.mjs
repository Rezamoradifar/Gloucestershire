// Read-only deployment estimate for the unfinished BNB Testnet prototype.
// It cannot sign, broadcast, deploy, migrate accounts or update a website.
// A successful estimate is not a release approval or an operational keeper.
import {ContractFactory,Interface,getAddress,getCreateAddress,isAddress,keccak256,parseEther,toQuantity,ZeroAddress} from 'ethers';
import {compileUnifiedTestnet,compileSingleCapitalTestnet} from './compile-global-v3-unified-testnet.mjs';

import {UNIFIED_TOKEN,UNIFIED_TOKEN_RUNTIME_HASH,UNIFIED_MANAGER,UNIFIED_FEE_RECEIVER,UNIFIED_PROFILE,SINGLE_CAPITAL_PROFILE} from './v3-unified-release-pins.mjs';

const TOKEN=getAddress(UNIFIED_TOKEN);
const MANAGER=getAddress(UNIFIED_MANAGER);
const FEE_RECEIVER=getAddress(UNIFIED_FEE_RECEIVER);
const MAX_GAS=12_000_000n,MAX_GAS_PRICE=100_000_000_000n,MAX_FEE=parseEther('0.08');
const TOKEN_ABI=new Interface(['function decimals() view returns(uint8)']);
const HASH=/^0x[0-9a-fA-F]{64}$/;

export async function planUnifiedDeployment({provider,from,profile=UNIFIED_PROFILE,
 compile=profile===SINGLE_CAPITAL_PROFILE?compileSingleCapitalTestnet:compileUnifiedTestnet}){
 if(!isAddress(from))throw Error('UNIFIED_DEPLOYER_ADDRESS_REQUIRED');
 const sender=getAddress(from);
 if(sender===ZeroAddress||sender===MANAGER||sender===FEE_RECEIVER)
  throw Error('UNIFIED_DEDICATED_GAS_ACCOUNT_REQUIRED');
 if(BigInt(await provider.send('eth_chainId',[]))!==97n)throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
 const height=Number(BigInt(await provider.send('eth_blockNumber',[])));
 if(!Number.isSafeInteger(height)||height<3)throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
 const number=height-2;
 const anchor=await provider.send('eth_getBlockByNumber',[toQuantity(number),false]);
 if(!anchor||BigInt(anchor.number)!==BigInt(number)||!HASH.test(String(anchor.hash)))
  throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
 const code=await provider.getCode(TOKEN,number);
 if(typeof code!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(code))throw Error('UNIFIED_TEST_TOKEN_MISSING');
 const decimals=await provider.call({to:TOKEN,data:TOKEN_ABI.encodeFunctionData('decimals'),blockTag:number});
 if(TOKEN_ABI.decodeFunctionResult('decimals',decimals)[0]!==18n)throw Error('UNIFIED_TEST_TOKEN_DECIMALS_MISMATCH');
 const artifact=compile()?.[profile===SINGLE_CAPITAL_PROFILE?'GlobalV3SingleCapitalTestnet':'GlobalV3UnifiedTestnet'];
 if(!artifact?.abi||typeof artifact.evm?.bytecode?.object!=='string'||
    !/^(?:[0-9a-fA-F]{2})+$/.test(artifact.evm.bytecode.object))throw Error('UNIFIED_ARTIFACT_INVALID');
 const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object);
 const request=await factory.getDeployTransaction(MANAGER,TOKEN,FEE_RECEIVER);
 if(typeof request.data!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(request.data))throw Error('UNIFIED_INITCODE_INVALID');
 const [estimate,fee,balance,latestNonce,pendingNonce,latestBlock]=await Promise.all([
  provider.estimateGas({from:sender,data:request.data}),provider.getFeeData(),provider.getBalance(sender),
  provider.getTransactionCount(sender,'latest'),provider.getTransactionCount(sender,'pending'),provider.getBlock('latest')
 ]);
 const gas=BigInt(estimate),gasLimit=(gas*125n+99n)/100n,gasPrice=fee.gasPrice===null?0n:BigInt(fee.gasPrice);
 if(gas<=0n||gasLimit>MAX_GAS||!latestBlock||typeof latestBlock.gasLimit!=='bigint'||gasLimit>latestBlock.gasLimit||
    gasPrice<=0n||gasPrice>MAX_GAS_PRICE||gasLimit*gasPrice>MAX_FEE)
  throw Error('UNIFIED_DEPLOY_ESTIMATE_OUTSIDE_LIMITS');
 if(typeof balance!=='bigint'||!Number.isSafeInteger(latestNonce)||latestNonce<0||
    !Number.isSafeInteger(pendingNonce)||pendingNonce<0)throw Error('UNIFIED_DEPLOY_ACCOUNT_READ_FAILED');
 const [again,chain]=await Promise.all([
  provider.send('eth_getBlockByNumber',[toQuantity(number),false]),provider.send('eth_chainId',[])
 ]);
 if(!again||BigInt(again.number)!==BigInt(number)||String(again.hash).toLowerCase()!==anchor.hash.toLowerCase()||BigInt(chain)!==97n)
  throw Error('UNIFIED_CONFIRMED_BLOCK_CHANGED');
 return {status:'ESTIMATE_ONLY_NOT_RELEASE_READY',chainId:97,block:number,blockHash:anchor.hash,
  sender,manager:MANAGER,token:TOKEN,feeReceiver:FEE_RECEIVER,
  initcodeHash:keccak256(request.data),candidateAddress:latestNonce===pendingNonce?
   getCreateAddress({from:sender,nonce:latestNonce}):null,
  gasEstimate:gas.toString(),gasLimit:gasLimit.toString(),gasPriceWei:gasPrice.toString(),
  maximumFeeWei:(gasLimit*gasPrice).toString(),balanceWei:balance.toString(),
  enoughTestBNB:balance>=gasLimit*gasPrice,hasPendingTransactions:latestNonce!==pendingNonce,
  tokenRuntimeIndependentlyVerified:keccak256(code)===UNIFIED_TOKEN_RUNTIME_HASH,
  releaseReady:false,transactionSent:false,siteUpdated:false,migrationPerformed:false};
}
