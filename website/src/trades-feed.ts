import {getAddress,isAddress,ZeroAddress} from 'ethers';
import type {PublicConfig} from './runtime-config';

export type Trade={id:string;asset:string;grossProfit:string;salesUsd:string;transactionHash:string;timestamp:string;confirmations:number;explorerUrl:string};
export type TradeFeed={status:'live'|'stale'|'unavailable'|'not_configured';testnet:boolean;chainId:number|null;contract:string|null;updatedAt:string|null;trades:Trade[]};
type Target=PublicConfig;

export class TradeTargetMismatchError extends Error {
 constructor(){super('The transaction feed does not match the configured contract and network.');}
}

export function matchesTradeTarget(value:unknown,target:Target|null):boolean{
 const feed=value as Partial<TradeFeed>|null;
 return !!target&&[56,97].includes(target.chainId)&&isAddress(target.vaultAddress)&&target.vaultAddress.toLowerCase()!==ZeroAddress&&!!feed&&feed.chainId===target.chainId&&typeof feed.contract==='string'&&isAddress(feed.contract)&&feed.contract.toLowerCase()===target.vaultAddress.toLowerCase();
}

function validTrade(value:unknown):value is Trade{
 const trade=value as Partial<Trade>|null;
 return !!trade&&typeof trade.id==='string'&&typeof trade.asset==='string'&&typeof trade.grossProfit==='string'&&/^\d+(\.\d+)?$/.test(trade.grossProfit)&&typeof trade.salesUsd==='string'&&/^\d+(\.\d+)?$/.test(trade.salesUsd)&&typeof trade.transactionHash==='string'&&/^0x[\da-fA-F]{64}$/.test(trade.transactionHash)&&typeof trade.explorerUrl==='string'&&typeof trade.timestamp==='string'&&Number.isFinite(Date.parse(trade.timestamp));
}

export function parseTradeFeed(value:unknown,target:Target):TradeFeed{
 if(!matchesTradeTarget(value,target))throw new TradeTargetMismatchError();
 const feed=value as TradeFeed;
 if(!['live','stale','unavailable','not_configured'].includes(feed.status)||!Array.isArray(feed.trades)||feed.trades.length>100||!feed.trades.every(validTrade)||(feed.updatedAt!==null&&(typeof feed.updatedAt!=='string'||!Number.isFinite(Date.parse(feed.updatedAt)))))throw Error('Invalid transaction feed.');
 return {status:feed.status,testnet:target.chainId===97,chainId:target.chainId,contract:getAddress(target.vaultAddress),updatedAt:feed.updatedAt,trades:feed.trades};
}

export function failedTradeFeed(previous:TradeFeed|null,target:Target|null,allowStale=true):TradeFeed{
 if(allowStale&&previous?.updatedAt&&matchesTradeTarget(previous,target))return {...previous,status:'stale'};
 return {status:'unavailable',testnet:target?.chainId===97,chainId:target?.chainId??null,contract:target?.vaultAddress??null,updatedAt:null,trades:[]};
}
