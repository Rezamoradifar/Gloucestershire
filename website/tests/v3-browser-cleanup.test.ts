import {describe,expect,it} from 'vitest';
import {removeRetiredProfileData} from '../src/v3-browser-cleanup';

function makeStorage(initial:Record<string,string>):Storage{
 const values=new Map(Object.entries(initial));
 return {
  get length(){return values.size;},
  clear(){values.clear();},
  getItem(key){return values.get(key)??null;},
  key(index){return Array.from(values.keys())[index]??null;},
  removeItem(key){values.delete(key);},
  setItem(key,value){values.set(key,value);}
 };
}
describe('retiring browser data for the previous site',()=>{
 it('removes only known previous profile and notification keys',()=>{
  const storage=makeStorage({
   'global-member-profile-v2:97:0xabc':'old avatar',
   'global-v2-only-profile:97:0xabc':'old profile',
   'global-notification-view-v2:97:0xabc':'old notifications',
   'global-theme':'dark',
   'wc@2:client:0.3//session':'wallet session',
   'global-v3-profile:97:0xabc':'current profile'
  });
  expect(removeRetiredProfileData(storage)).toBe(3);
  expect(storage.length).toBe(3);
  expect(storage.getItem('global-theme')).toBe('dark');
  expect(storage.getItem('wc@2:client:0.3//session')).toBe('wallet session');
  expect(storage.getItem('global-v3-profile:97:0xabc')).toBe('current profile');
 });
});
