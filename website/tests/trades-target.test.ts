import {describe,it,expect} from 'vitest';
import {failedTradeFeed,matchesTradeTarget,parseTradeFeed,TradeTargetMismatchError} from '../src/trades-feed';

const target={chainId:97,vaultAddress:'0x1111111111111111111111111111111111111111'};
const other={chainId:97,vaultAddress:'0x2222222222222222222222222222222222222222'};
const trade={id:'settlement',asset:'USDT',grossProfit:'10.0',salesUsd:'100.0',transactionHash:'0x'+'1'.repeat(64),timestamp:'2026-10-23T00:00:00.000Z',confirmations:5,explorerUrl:'https://testnet.bscscan.com/tx/0x'+'1'.repeat(64)};
const response={status:'live',chainId:target.chainId,contract:target.vaultAddress,testnet:false,updatedAt:'2026-10-23T00:01:00.000Z',trades:[trade]};

describe('transaction feed target isolation',()=>{
 it('accepts matching contract and network and derives the network label from the verified target',()=>{
  const parsed=parseTradeFeed(response,target);
  expect(parsed.trades).toEqual([trade]);expect(parsed.testnet).toBe(true);
  const address='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  expect(matchesTradeTarget({...response,contract:address.toLowerCase()},{...target,vaultAddress:address})).toBe(true);
 });
 it('rejects another vault or chain and responses without a verifiable target',()=>{
  for(const change of [{contract:other.vaultAddress},{chainId:56},{chainId:'97'},{contract:null},{contract:undefined},{chainId:undefined},{contract:'0x'+'0'.repeat(40)}]){
   expect(()=>parseTradeFeed({...response,...change},target)).toThrow(TradeTargetMismatchError);
  }
 });
 it('clears old trades after a target mismatch instead of turning them into a stale snapshot',()=>{
  const previous=parseTradeFeed(response,target);
  const cleared=failedTradeFeed(previous,target,false);
  expect(cleared.status).toBe('unavailable');expect(cleared.trades).toEqual([]);expect(cleared.updatedAt).toBeNull();
 });
 it('retains a confirmed snapshot on transport failure only for the same target',()=>{
  const previous=parseTradeFeed(response,target);
  expect(failedTradeFeed(previous,target)).toEqual({...previous,status:'stale'});
  for(const next of [other,{...target,chainId:56},null]){
   const cleared=failedTradeFeed(previous,next);
   expect(cleared.status).toBe('unavailable');expect(cleared.trades).toEqual([]);expect(cleared.updatedAt).toBeNull();
  }
 });
 it('replaces prior records with the fresh target empty feed and accepts stale only with matching identity',()=>{
  expect(parseTradeFeed({...response,contract:other.vaultAddress,trades:[]},other).trades).toEqual([]);
  expect(parseTradeFeed({...response,status:'stale'},target).status).toBe('stale');
  expect(()=>parseTradeFeed({...response,status:'stale',contract:other.vaultAddress},target)).toThrow(TradeTargetMismatchError);
 });
 it('rejects malformed content and never preserves an unconfirmed or unidentified snapshot',()=>{
  for(const change of [{status:'unknown'},{updatedAt:'invalid'},{trades:[{...trade,timestamp:'invalid'}]},{trades:[{...trade,grossProfit:'-1'}]}]){
   expect(()=>parseTradeFeed({...response,...change},target)).toThrow();
  }
  const previous=parseTradeFeed({...response,updatedAt:null},target);
  expect(failedTradeFeed(previous,target).trades).toEqual([]);
  expect(failedTradeFeed(null,target).trades).toEqual([]);
 });
});
