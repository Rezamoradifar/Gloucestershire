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
});
