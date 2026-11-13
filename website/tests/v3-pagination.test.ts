import {describe,it,expect} from 'vitest';
import {v3PageRange} from '../src/v3-pagination';

describe('V3 bounded network pages',()=>{
 it('uses bounded pages, preserving every row across page boundaries',()=>{
  expect(v3PageRange(45,0,20)).toEqual({page:0,start:0,length:20,total:45});
  expect(v3PageRange(45,1,20)).toEqual({page:1,start:20,length:20,total:45});
  expect(v3PageRange(45,2,20)).toEqual({page:2,start:40,length:5,total:45});
 });
 it('clamps stale page indexes and rejects invalid or unbounded requests',()=>{
  expect(v3PageRange(0,3,20)).toEqual({page:0,start:0,length:0,total:0});
  expect(v3PageRange(21,9,20).page).toBe(1);
  expect(()=>v3PageRange(20,-1,20)).toThrow();
  expect(()=>v3PageRange(20,0,100)).toThrow();
 });
});
