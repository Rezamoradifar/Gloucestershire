import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ImmersiveHero from '../src/ImmersiveHero';

beforeEach(()=>vi.stubGlobal('window',{matchMedia:()=>({matches:false})}));
afterEach(()=>vi.unstubAllGlobals());

describe('Global immersive V3 landing hero',()=>{
 it('is visibly different from the old landing with a new headline and prominent Earth artwork',()=>{
  const html=renderToStaticMarkup(<ImmersiveHero/>);
  expect(html).toContain('global-immersive-v3');
  expect(html).toContain('The world is');
  expect(html).toContain('possibility.');
  expect(html).not.toContain('A world of');
  expect(html).toContain('intelligence-earth-1280.webp');
  expect(html).toContain('v3-floating-intelligence');
  expect(html).toContain('v3-world-ring');
  expect(html).toContain('SCROLL TO EXPLORE');
 });
 it('has three meaningful destination cards and truthful data disclosures',()=>{
  const html=renderToStaticMarkup(<ImmersiveHero/>);
  expect((html.match(/v3-capability-card v3-card-/g)||[]).toHaveLength(3);
  for(const target of ['#our-ai','#how-it-works','#dashboard'])expect(html).toContain('href="'+target+'"');
  expect(html).toContain('Commerce integrations are illustrative');
  expect(html).toContain('Wallet connection required');
  expect(html).not.toContain('Guaranteed returns');
 });
});
