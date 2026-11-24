import {describe,expect,it} from 'vitest';
import {formatTradeAmount,readAccountFeed,readMarketFeed} from '../src/trading-activity';

const now=Date.parse('2026-11-24T10:00:00Z');
const tick=(id:number,side:string,age=1)=>['85345.12','0.012',now/1000-age,side,'l','',id];
const kraken=(ticks:unknown[])=>({error:[],result:{XXBTZUSD:ticks}});
const row={id:'a'.repeat(24),side:'sell',item:'Paid order',time:new Date(now-1000).toISOString(),amount:'19.99',unit:'USD'};
const sales={source:'ebay',status:'connected',updatedAt:new Date(now).toISOString(),rows:[row]};

describe('the trading desk keeps public market and operator records distinct',()=>{
  it('keeps exact provider quantities at both ends of the supported precision',()=>{
    expect(formatTradeAmount('0.000000000000000001')).toBe('0.000000000000000001');
    expect(formatTradeAmount('99999999999999999.9000')).toBe('99,999,999,999,999,999.9');
  });
  it('sorts and deduplicates exchange trades and preserves buy and sell sides',()=>{
    const feed=readMarketFeed(kraken([tick(1,'s',2),tick(2,'b'),tick(2,'b')]),'BTC/USD',now);
    expect(feed.status).toBe('live');expect(feed.rows.map(v=>[v.id,v.side,v.unit])).toEqual([['2','buy','BTC'],['1','sell','BTC']]);
    expect(readMarketFeed(kraken([tick(1,'b',95)]),'BTC/USD',now).status).toBe('delayed');
    expect(readMarketFeed(kraken([]),'BTC/USD',now).status).toBe('delayed');
    expect(()=>readMarketFeed(kraken([tick(1,'x')]),'BTC/USD',now)).toThrow();
    expect(()=>readMarketFeed(kraken([tick(1,'b')]),'ETH/USD',now)).toThrow();
  });
  it('accepts an empty connected account and prevents misattribution, stale status and rows after revocation',()=>{
    expect(readAccountFeed(sales,'ebay',now).rows).toEqual([row]);
    expect(readAccountFeed({...sales,rows:[]},'ebay',now).status).toBe('connected');
    expect(()=>readAccountFeed(sales,'kraken',now)).toThrow();
    expect(()=>readAccountFeed({...sales,rows:[{...row,side:'buy'}]},'ebay',now)).toThrow();
    expect(()=>readAccountFeed({...sales,status:'not_configured',updatedAt:null},'ebay',now)).toThrow();
    expect(()=>readAccountFeed(sales,'ebay',now+180000)).toThrow();
    expect(()=>readAccountFeed(readMarketFeed(kraken([tick(1,'b')]),'BTC/USD',now),'kraken',now)).toThrow();
  });
});
