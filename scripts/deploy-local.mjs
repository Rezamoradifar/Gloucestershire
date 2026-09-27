// LOCAL EVM LAB ONLY. Never connects to public BSC or uses real funds.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther,ZeroAddress} from 'ethers';
const config=JSON.parse(fs.readFileSync('config.example.json'));
const server=ganache.server({logging:{quiet:true},chain:{chainId:31337,hardfork:'shanghai'},wallet:{totalAccounts:10,defaultBalance:10000}});
await server.listen(8545,'127.0.0.1');
const provider=new BrowserProvider(server.provider);provider.pollingInterval=10;
const signers=await Promise.all(Array.from({length:10},(_,i)=>provider.getSigner(i)));
const addresses=await Promise.all(signers.map(s=>s.getAddress()));
const deployments={};
async function deploy(name,args){
 const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`));
 const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args);
 const receipt=await c.deploymentTransaction().wait();
 assert.equal(receipt.status,1);
 assert.notEqual(await provider.getCode(c.target),'0x');
 deployments[name]={address:c.target,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString()};
 return c;
}
const token=await deploy('MockToken',[18]);
const bnb=await deploy('MockFeed',[60000000000n]);deployments.BnbFeed=deployments.MockFeed;
const usd=await deploy('MockFeed',[100000000n]);deployments.UsdFeed=deployments.MockFeed;delete deployments.MockFeed;
const vault=await deploy('DropshippingVault',[addresses[0],token.target,bnb.target,usd.target,86400,addresses.slice(0,7),config.dropshippingWallet]);
const tx=async p=>(await p).wait();
await tx(token.mint(addresses[8],parseEther('1000')));
await tx(token.connect(signers[8]).approve(vault.target,parseEther('1000')));
const tokenDeposit=await tx(vault.connect(signers[8]).deposit(token.target,parseEther('1000'),ZeroAddress));
const nativeDeposit=await tx(vault.connect(signers[9]).deposit(ZeroAddress,parseEther('1'),ZeroAddress,{value:parseEther('1')}));
const f1=await vault.FEE_WALLET_1(),f2=await vault.FEE_WALLET_2(),ops=await vault.dropshippingWallet();
assert.equal(ops,config.dropshippingWallet);
for(const [wallet,tokenAmount,bnbAmount] of [[f1,'100','0.1'],[f2,'100','0.1'],[ops,'800','0.8']]){
 assert.equal(await token.balanceOf(wallet),parseEther(tokenAmount));
 assert.equal(await provider.getBalance(wallet),parseEther(bnbAmount));
}
assert.equal(await vault.assetBalance(token.target),0n);
assert.equal(await vault.assetBalance(ZeroAddress),0n);
const report={environment:'LOCAL EVM LAB ONLY — NOT PUBLIC BSC TESTNET',chainId:31337,rpc:'http://127.0.0.1:8545',publicDeployment:false,createdAt:new Date().toISOString(),operationsWallet:ops,owner:addresses[0],partners:addresses.slice(0,7),accountsNote:'Owner and partners are ephemeral local simulation accounts, not production identities.',deployments,checks:{runtimeCodePresent:true,tokenDeposit80_10_10:true,nativeDeposit80_10_10:true,tokenDepositTx:tokenDeposit.hash,nativeDepositTx:nativeDeposit.hash},limitations:['Mock USDT and mock price feeds','No public explorer link','Local in-memory state is lost when process stops; rerun script to redeploy','No real funds or public transactions']};
fs.writeFileSync('deployment-local.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'LOCAL DEPLOYMENT VERIFIED',address:vault.target,chainId:31337,report:'deployment-local.json'},null,2));
async function stop(){await provider.destroy();await server.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
