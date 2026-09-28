import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface} from 'ethers';
import {prepareMainnet} from '../scripts/server-mainnet.mjs';
test('mainnet preparation pins network, assets, feeds and gas cap without signing',async()=>{
 const c=JSON.parse(fs.readFileSync('config.mainnet.json')),artifact=JSON.parse(fs.readFileSync('artifacts/DropshippingVault.json'));
 const iface=new Interface(['function description() view returns(string)','function decimals() view returns(uint8)','function symbol() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
 const p={getNetwork:async()=>({chainId:56n}),getCode:async()=> '0x1234',getBlock:async()=>({timestamp:1000}),estimateGas:async()=>4000000n,getFeeData:async()=>({gasPrice:1000000000n}),call:async({to,data})=>{
  const name=iface.parseTransaction({data}).name;let result;
  if(name==='description')result=[to.toLowerCase()===c.bnbUsdFeed.toLowerCase()?'BNB / USD':'USDT / USD'];
  if(name==='decimals')result=[to.toLowerCase()===c.usdt.toLowerCase()?18:8];
  if(name==='symbol')result=['USDT'];if(name==='latestRoundData')result=[1,100000000,990,990,1];
  return iface.encodeFunctionResult(name,result);
 }};
 const r=await prepareMainnet(p,c,artifact,c.initialOwner);assert.equal(r.args[0],c.initialOwner);assert.equal(r.request.to,undefined);assert.equal(r.cost,4800000000000000n);
 await assert.rejects(prepareMainnet({...p,getNetwork:async()=>({chainId:97n})},c,artifact,c.initialOwner),/56/);
 await assert.rejects(prepareMainnet(p,{...c,usdt:c.initialOwner},artifact,c.initialOwner),/Wrong mainnet/);
 await assert.rejects(prepareMainnet({...p,getBlock:async()=>({timestamp:5000})},c,artifact,c.initialOwner),/stale/);
 await assert.rejects(prepareMainnet({...p,getFeeData:async()=>({gasPrice:100000000000n})},c,artifact,c.initialOwner),/safety limit/);
});
