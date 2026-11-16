import {describe,expect,it} from 'vitest';
import {parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import V3PositionsList from '../src/V3PositionsList';
import type {V3WalletPosition} from '../src/v3-chain';

const amount=(value:string)=>parseEther(value);
function position(id:number,fromReinvestment:boolean,principal:string,daily:string,compound:string,reserved:string){
 return {id,fromReinvestment,principal:amount(principal),availableDaily:amount(daily),
  availableCompound:amount(compound),availableProfit:amount(daily)+amount(compound),
  reservedProfit:amount(reserved),openedAt:1000+id*3600,lastAccruedAt:2000+id*3600} as V3WalletPosition;
}

describe('V3 reinvestment group display',()=>{
 it('sums only reinvestment positions and preserves each underlying contract entry and lock',()=>{
  const positions=[position(0,false,'1000','7','0.5','0'),position(1,true,'10','1','0.1','0.5'),
   position(2,true,'20','2','0.2','1')];
  const html=renderToStaticMarkup(<V3PositionsList positions={positions}/>);
  expect(html).toContain('Combined reinvestments');
  expect(html).toContain('2 separate on-chain positions shown together');
  for(const label of ['30.00 TEST','3.00 TEST','0.3 TEST','1.5 TEST','1,000.00 TEST'])
   expect(html).toContain(`aria-label="${label}"`);
  expect(html).toContain('The existing contract still keeps a separate position, accrual time and principal lock for each reinvestment');
  expect(html).toContain('Position #1');expect(html).toContain('Position #2');expect(html).toContain('Position #3');
  expect((html.match(/Principal unlock after/g)||[]).length).toBe(3);
  expect(positions.map(p=>p.principal)).toEqual([amount('1000'),amount('10'),amount('20')]);
 });
 it('does not invent a reinvestment group for an account without reinvestments',()=>{
  const html=renderToStaticMarkup(<V3PositionsList positions={[position(0,false,'100','0','0','0')]}/>);
  expect(html).not.toContain('Combined reinvestments');
  expect(html).toContain('Position #1');
 });
 it('retains a zero-principal reinvestment when it still has recorded claims',()=>{
  const html=renderToStaticMarkup(<V3PositionsList positions={[position(1,true,'0','1','0','0')]}/>);
  expect(html).toContain('1 separate on-chain position shown together');
  expect(html).toContain('aria-label="1.00 TEST"');
  expect(html).toContain('Position #2');
 });
});
