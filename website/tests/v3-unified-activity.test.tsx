import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3UnifiedActivity from '../src/V3UnifiedActivity';
import type {V3Snapshot} from '../src/v3-chain';

const active={registered:true,suspended:false,paused:false,lastCheckIn:1000,asOf:4600} as V3Snapshot;
const render=(view:V3Snapshot,readOnly:boolean,busy=false)=>renderToStaticMarkup(
 <V3UnifiedActivity view={view} busy={busy} readOnly={readOnly} onCheckIn={()=>{}}/>
);

describe('unified test account activity',()=>{
 it('keeps the preview action disabled and does not claim profit was credited',()=>{
  const html=render(active,true);
  expect(html).toContain('read-only');
  expect(html).toMatch(/<button[^>]*disabled/);
  expect(html).toContain('Check-in records activity only');
  expect(html).toContain('Eligible claims need a verified keeper');
 });
 it('blocks actions for cooldown, missing registration, suspension, pause, and busy state',()=>{
  expect(render({...active,asOf:4599},false)).toContain('cooldown');
  for(const view of [{...active,asOf:4599},{...active,registered:false},
   {...active,suspended:true},{...active,paused:true}])expect(render(view,false)).toMatch(/<button[^>]*disabled/);
  expect(render(active,false,true)).toMatch(/<button[^>]*disabled/);
  expect(render(active,false)).not.toMatch(/<button[^>]*disabled/);
 });
 it('shows pending keeper gas without disabling the user check-in',()=>{
  const keeper={operator:'0x4444444444444444444444444444444444444444',gasWei:0n};
  const waiting=render({...active,keeper},false);
  expect(waiting).toContain('Automatic profit waiting for tBNB');
  expect(waiting).toContain(keeper.operator);
  expect(waiting).toContain('Deposits and account registration are enabled');
  expect(waiting).not.toMatch(/<button[^>]*disabled/);
  expect(render({...active,keeper:{...keeper,gasWei:1000000000000000n}},false)).toContain('Keeper gas available');
  expect(render({...active,keeper:{...keeper,gasWei:null}},false)).toContain('Keeper gas status unavailable');
 });
});
