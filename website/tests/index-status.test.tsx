import {expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import IndexStatus from '../src/IndexStatus';
import type {AllocationStatus} from '../src/daily-activity-client';

const allocation:AllocationStatus={version:1,status:'running',chainId:97,vaultAddress:'0x1111111111111111111111111111111111111111',fresh:true,checkedAt:'2026-11-11T14:00:00Z',lastCredit:{epoch:1,batches:[{transactionHash:'0x'+'a'.repeat(64),block:140,blockHash:'0x'+'b'.repeat(64)}]},indexProgress:{memberThrough:100,positionThrough:90,target:110,memberCount:2,positionCount:3}};
it('describes recorded index snapshot and system credit without promising payment',()=>{
 const html=renderToStaticMarkup(<IndexStatus allocation={allocation}/>);
 expect(html).toContain('Members indexed through block');expect(html).toContain('110');expect(html).toContain('current chain head');expect(html).toContain('does not confirm a reward payment');expect(html).toContain('block 140');
 expect(html).toContain('Blocks remaining to recorded target');expect(html).toContain('10 / 20');
 expect(renderToStaticMarkup(<IndexStatus allocation={{...allocation,fresh:false}}/>)).toContain('Previous worker report; update pending');
 expect(renderToStaticMarkup(<IndexStatus allocation={{...allocation,dailyStatus:'indexing'}}/>)).toContain('Indexing');
 expect(renderToStaticMarkup(<IndexStatus allocation={{...allocation,indexProgress:null}}/>)).toBe('');
});
