import {Contract,ZeroAddress} from 'ethers';
import {describe,expect,it,vi} from 'vitest';
import {checkV3Registration} from '../src/v3-actions';

const wallet='0x1000000000000000000000000000000000000001';
const referrer='0x2000000000000000000000000000000000000002';
const options={blockTag:42};
function contract({paused=false,registered=false,referrerRegistered=false}={}){
 const users=vi.fn(async(address:string)=>({registered:address.toLowerCase()===wallet.toLowerCase()?registered:referrerRegistered}));
 const readPaused=vi.fn(async()=>paused);
 return {vault:{users,paused:readPaused} as unknown as Contract,users,readPaused};
}
describe('V3 registration preflight',()=>{
 it('allows a new wallet without a referrer at the confirmed block',async()=>{
  const {vault,users,readPaused}=contract();
  await expect(checkV3Registration(vault,wallet,ZeroAddress,options)).resolves.toBeUndefined();
  expect(users).toHaveBeenCalledTimes(1);
  expect(users).toHaveBeenCalledWith(wallet,options);
  expect(readPaused).toHaveBeenCalledWith(options);
 });
 it('checks that the selected referrer is registered on this contract',async()=>{
  const {vault,users}=contract({referrerRegistered:true});
  await expect(checkV3Registration(vault,wallet,referrer,options)).resolves.toBeUndefined();
  expect(users).toHaveBeenCalledWith(referrer,options);
  await expect(checkV3Registration(contract().vault,wallet,referrer,options)).rejects.toThrow('referrer is not registered');
 });
 it('explains already registered, paused and self-referral states',async()=>{
  await expect(checkV3Registration(contract({registered:true}).vault,wallet,ZeroAddress,options)).rejects.toThrow('already registered');
  await expect(checkV3Registration(contract({paused:true}).vault,wallet,ZeroAddress,options)).rejects.toThrow('paused');
  await expect(checkV3Registration(contract().vault,wallet,wallet,options)).rejects.toThrow('valid V3 referral');
 });
});
