import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {DropshippingRecords} from '../src/V3DropshippingTape';
import V3TradingDesk from '../src/V3TradingDesk';
import V3LiveTrades from '../src/V3LiveTrades';
import {readAccountFeed, type Feed} from '../src/trading-activity';

const now=Date.parse('2026-11-25T10:00:00Z');
const row={id:'a'.repeat(24),time:'2026-11-25T09:52:00Z',amount:'89.95',unit:'EUR',item:'Paid order',side:'sell'};
const product={name:'Portable radio',model:'DR-03',type:'Audio',quantity:2};
const detail={products:[product,{name:'USB cable',model:null,type:'Cable',quantity:1}],productCount:2};
const profit={net:'-5.05',netSales:'89.95',costs:'95'};
const feed=(changes={},extra={})=>readAccountFeed({source:'ebay',status:'connected',updatedAt:new Date(now).toISOString(),
 rows:[{...row,...changes}],...extra},'ebay',now);
const purchase=readAccountFeed({source:'amazon',status:'connected',updatedAt:new Date(now).toISOString(),rows:[
 {...row,id:'b'.repeat(24),side:'buy',item:'Purchase charge',unit:'USD',time:'2026-11-25T09:55:00Z',amount:'20.08',
  products:[{...product,name:'Radio purchase'}],productCount:1}
]},'amazon',now);
const render=(amazon:Feed|null,ebay:Feed|null)=>renderToStaticMarkup(<DropshippingRecords amazon={amazon} ebay={ebay} pending={false} onRefresh={()=>{}}/>);

describe('live dropshipping trades',()=>{
 it('opens the public landing and member trading desks on dropshipping with crypto immediately available',()=>{
  for(const element of [<V3LiveTrades/>,<V3TradingDesk/>]) {
   const html=renderToStaticMarkup(element);
   expect(html).toMatch(/aria-pressed="true"[^>]*>Dropshipping/);
   expect(html).toContain('Public market');expect(html).toContain('Global exchange');
   expect(html).toContain('Refresh dropshipping trades');
  }
 });
 it('accepts legacy rows with no details and only complete consistent same-sale profit',()=>{
  expect(feed().rows[0]).toEqual(row);
  expect(feed({...detail,profit}).rows[0].profit).toEqual(profit);
  expect(()=>feed({products:[{...product,quantity:-1}],productCount:1})).toThrow();
  expect(()=>feed({products:[{...product,name:'buyer@example.com'}],productCount:1})).toThrow();
  expect(()=>feed({products:[product],productCount:0})).toThrow();
  expect(()=>feed({profit:{...profit,net:'12'}})).toThrow();
  expect(()=>feed({profit:{net:'1',costs:'90',netSales:'91'}})).toThrow();
  expect(()=>feed({profit:null})).toThrow();
  expect(()=>feed({refundStatus:'pending'})).toThrow();
  expect(()=>readAccountFeed({...purchase,rows:purchase.rows.map(r=>({...r,refundStatus:'partial'}))},'amazon',now)).toThrow();
 });
 it('merges buy and sell in timestamp order, displays multiple lines under one sale, and reconciles signed margins per currency',()=>{
  const html=render(purchase,feed({...detail,profit}));
  expect(html.indexOf('Radio purchase')).toBeLessThan(html.indexOf('Portable radio'));
  expect(html.match(/class="gv3-store-row"/g)).toHaveLength(2);
  for(const text of ['Amazon Business','eBay','Charged','Ordered','DR-03','Audio','USB cable','2 product lines','EUR','USD','−5.61%','Matched costs 95','data-result="loss"'])expect(html).toContain(text);
  expect(html).toContain('Reported on sale');
  expect(html).not.toContain('DEMO');
  expect(html).toContain('up to 20 per store');
  expect(html).toContain('Volume and profit for the latest records');
  expect(html).toContain('all 2 loaded records');
 });
 it('labels refunded sales, keeps original gross volume and displays reconciled profit after refunds',()=>{
  const partial=render(null,feed({refundStatus:'partial',profit:{net:'-5',netSales:'60',costs:'65'}}));
  for(const label of ['Partially refunded','Original order total','Gross sales 89.95','Net sales 60 EUR','Matched costs 65 EUR','Margin −8.33%'])expect(partial).toContain(label);
  const full=render(null,feed({refundStatus:'full',profit:{net:'-5',netSales:'0',costs:'5'}}));
  for(const label of ['Fully refunded','Original order total','Net sales 0 EUR','Gross sales 89.95','Reconciled profit -5 EUR','Margin —','Margin is undefined on zero net sales.'])expect(full).toContain(label);
  expect(full).not.toContain('Margin 0%');
  const undisclosed=render(null,feed({refundStatus:'full'}));
  expect(undisclosed).toContain('Fully refunded');expect(undisclosed).toContain('Unverified');
  expect(()=>feed({profit,refundStatus:'full'})).toThrow();
  expect(()=>feed({profit,refundStatus:'partial'})).toThrow();
 });
 it('distinguishes a withheld profit from a verified break-even and undefined margin',()=>{
  const withheld=render(null,feed()),even=render(null,feed({profit:{net:'0',netSales:'10',costs:'10'}}));
  expect(withheld).toContain('Unverified');expect(withheld).not.toContain('Margin 0%');
  expect(even).toContain('Margin 0%');
  expect(render(null,feed({profit:{net:'-1',netSales:'0',costs:'1'}}))).toContain('Margin —');
 });
 it('keeps available records and exposes per-provider coverage without inventing rows',()=>{
  const notConfigured:Feed={source:'amazon',status:'not_configured',updatedAt:null,rows:[]};
  const partial=render(notConfigured,feed(detail,{status:'partial'}));
  expect(partial).toContain('Not connected');expect(partial).toContain('Partial history');expect(partial).toContain('Portable radio');
  const blank=render(notConfigured,{...notConfigured,source:'ebay'});
  expect(blank).toContain('No connected store feed');expect(blank).not.toContain('class="gv3-store-row"');
  expect(blank).not.toContain('0%');
 });
});
