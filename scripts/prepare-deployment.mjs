// Builds an UNSIGNED deployment request. Never reads private keys or broadcasts.
import fs from 'node:fs';
import {JsonRpcProvider,Contract,ContractFactory,getAddress} from 'ethers';
const config=JSON.parse(fs.readFileSync(process.argv[2]||'config.json','utf8'));
if(![56,97].includes(config.chainId))throw Error('Expected BSC chainId 56 or 97');
for(const k of ['initialOwner','usdt','bnbUsdFeed','usdtUsdFeed','dropshippingWallet']){
 if(!config[k])throw Error('Missing '+k);config[k]=getAddress(config[k]);
 if(/^0x0{40}$/i.test(config[k]))throw Error('Zero '+k);
}
if(!Array.isArray(config.partners)||config.partners.length!==7)throw Error('Provide exactly 7 distinct nonzero partner addresses');
config.partners=config.partners.map(getAddress);
if(new Set(config.partners).size!==config.partners.length||config.partners.some(x=>/^0x0{40}$/i.test(x)))throw Error('Invalid partners');
if(!Number.isInteger(config.maxOracleAge)||config.maxOracleAge<1||config.maxOracleAge>604800)throw Error('Invalid oracle maximum age');
if(!process.env.BSC_RPC_URL)throw Error('Set BSC_RPC_URL');
const provider=new JsonRpcProvider(process.env.BSC_RPC_URL);
try {
 if(Number((await provider.getNetwork()).chainId)!==config.chainId)throw Error('RPC chain mismatch');
 for(const k of ['usdt','bnbUsdFeed','usdtUsdFeed'])if(await provider.getCode(config[k])==='0x')throw Error('No code at '+k);
 const latest=await provider.getBlock('latest');
 for(const k of ['bnbUsdFeed','usdtUsdFeed']) {
  const f=new Contract(config[k],['function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'],provider);
  const d=await f.decimals(),[r,a,,t,ar]=await f.latestRoundData();
  if(d>18n||r===0n||a<=0n||t===0n||t>BigInt(latest.timestamp)||BigInt(latest.timestamp)-t>BigInt(config.maxOracleAge)||ar<r)throw Error('Invalid/stale price feed '+k);
 }
 const decimals=await new Contract(config.usdt,['function decimals() view returns(uint8)'],provider).decimals();if(decimals>18n)throw Error('Unsupported token decimals');
 const artifact=JSON.parse(fs.readFileSync('artifacts/DropshippingVault.json','utf8'));
 const args=[config.initialOwner,config.usdt,config.bnbUsdFeed,config.usdtUsdFeed,config.maxOracleAge,config.partners,config.dropshippingWallet];
 const request=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(...args);
 fs.writeFileSync('deployment-unsigned.json',JSON.stringify({chainId:config.chainId,transaction:{data:request.data,value:'0x0'},constructorArguments:args,feeWallet1:'0x7037cc199499d7a3431285a01e435454eae51265',feeWallet2:'0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632',withdrawalFeeWallet:'0x74015dedf36677485793f1714ec7bd4893907b26',treasuryModel:'Owner may withdraw all liquid funds, including cash assigned to user claims; no partner approval or delay'},null,2));
 console.log('Prepared deployment-unsigned.json. Nothing signed or broadcast.');
} finally {provider.destroy();}
