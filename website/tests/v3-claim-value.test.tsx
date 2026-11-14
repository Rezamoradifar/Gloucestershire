import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseEther} from 'ethers';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import V3ClaimValue,{v3ClaimDirection,v3NextClaimSnapshot} from '../src/V3ClaimValue';

const snap=(value:string,block:number)=>({value:parseEther(value),block});

describe('confirmed claim movement indicators',()=>{
 it('does not signal on first observation, identical values, or old blocks',()=>{
  const initial=snap('10',100);
  expect(v3ClaimDirection(null,initial)).toBeNull();
  expect(v3ClaimDirection(initial,snap('10',101))).toBeNull();
  expect(v3ClaimDirection(initial,snap('20',100))).toBeNull();
  expect(v3ClaimDirection(initial,snap('20',99))).toBeNull();
 });
 it('uses confirmed increases and decreases, including amounts beyond JavaScript safe integers',()=>{
  expect(v3ClaimDirection(snap('10',100),snap('10.25',101))).toBe('up');
  expect(v3ClaimDirection(snap('10',100),snap('9.75',101))).toBe('down');
  expect(v3ClaimDirection(snap('9007199254740993',100),snap('9007199254740994',101))).toBe('up');
  expect(v3ClaimDirection(snap('9007199254740994',100),snap('9007199254740993',101))).toBe('down');
 });
 it('signals only changes visible at the displayed precision',()=>{
  expect(v3ClaimDirection(snap('1.0000001',100),snap('1.0000002',101))).toBeNull();
  expect(v3ClaimDirection(snap('1.0000001',100),snap('1.000001',101))).toBe('up');
  expect(v3ClaimDirection(snap('0',100),snap('0.000000000000000001',101))).toBe('up');
 });
 it('resets its baseline on older snapshots before signalling a later valid change',()=>{
  const anchor=snap('10',100),older=snap('20',99),next=snap('11',101),later=snap('12',102);
  let baseline=v3NextClaimSnapshot(null,anchor);
  expect(v3ClaimDirection(baseline,older)).toBeNull();
  baseline=v3NextClaimSnapshot(baseline,older);
  expect(baseline).toBeNull();
  expect(v3ClaimDirection(baseline,next)).toBeNull();
  baseline=v3NextClaimSnapshot(baseline,next);
  expect(v3ClaimDirection(baseline,later)).toBe('up');
 });
 it('resets on conflicting amounts for one block, but keeps an identical observation',()=>{
  const anchor=snap('10',100),identical=snap('10',100),conflict=snap('30',100),next=snap('11',101);
  let baseline=v3NextClaimSnapshot(anchor,identical);
  expect(baseline).toEqual(anchor);
  expect(v3ClaimDirection(baseline,conflict)).toBeNull();
  baseline=v3NextClaimSnapshot(baseline,conflict);
  expect(baseline).toBeNull();
  expect(v3ClaimDirection(baseline,next)).toBeNull();
 });
 it('initially displays the exact formatted amount with no movement signal',()=>{
  const html=renderToStaticMarkup(<V3ClaimValue value={parseEther('1000.25')} block={100}/>);
  expect(html).toContain('aria-label="1,000.25 TEST USDT"');
  expect(html).not.toContain('gv3-claim-value--up');
  expect(html).not.toContain('gv3-claim-value--down');
 });
 it('disables claim flashing when reduced motion is requested',()=>{
  const css=postcss.parse(readFileSync(new URL('../src/v3-claims-readout.css',import.meta.url),'utf8'));
  let disabled=false;
  css.walkAtRules('media',media=>{
   if(!/prefers-reduced-motion\s*:\s*reduce/.test(media.params))return;
   media.walkRules(rule=>{
    if(!rule.selector.includes('gv3-claim-value-pulse'))return;
    rule.walkDecls('animation',decl=>{if(decl.value==='none')disabled=true;});
   });
  });
  expect(disabled).toBe(true);
 });
});
