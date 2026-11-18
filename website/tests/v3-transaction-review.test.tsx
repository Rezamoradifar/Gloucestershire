import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {useV3TransactionReview,V3TransactionReview} from '../src/V3TransactionReview';

const details={title:'Review test deposit',description:'Deposit exactly 10 MOCK TUSDT.',
 wallet:'0x'+'1'.repeat(40),contract:'0x'+'2'.repeat(40)};

function reviewFlow(){
 let flow!:ReturnType<typeof useV3TransactionReview>;
 function Harness(){flow=useV3TransactionReview();return null;}
 renderToStaticMarkup(<Harness/>);
 return flow;
}

describe('testnet wallet transaction review',()=>{
 it('shows the exact action, wallet and contract before continuing',()=>{
  const html=renderToStaticMarkup(<V3TransactionReview review={details} onFinish={()=>{}}/>);
  for(const text of [...Object.values(details),'BNB Smart Chain Testnet','Cancel','Continue to wallet'])expect(html).toContain(text);
 });
 it('ignores a second request and resolves each review only once',async()=>{
  const flow=reviewFlow();
  const first=flow.request(details);
  expect(await flow.request({...details,description:'Deposit a different amount.'})).toBe(false);
  flow.finish(false);
  flow.finish(true);
  expect(await first).toBe(false);
  const next=flow.request(details);
  flow.finish(true);
  flow.finish(false);
  expect(await next).toBe(true);
 });
});
