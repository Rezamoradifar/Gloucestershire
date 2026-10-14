import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import OperationBalance from '../src/OperationBalance';
import type {Action,Asset} from '../src/chain';

const base={profit:30_000_000n,withdrawalLimit:15_000_000n,liquidBalance:50_000_000n,nextWithdrawal:0n,blockTime:1000,fee:500n,walletBalance:8_000_000n,decimals:6};
const render=(kind:Action['kind'],data:typeof base|null=base,asset:Asset='USDT')=>renderToStaticMarkup(createElement(OperationBalance,{kind,data,asset}));
describe('operation form balance',()=>{
 it('shows the contract gross withdrawal limit instead of the external wallet balance',()=>{
  expect(render('profit')).toContain('Available to withdraw (before fee): <bdi>15 USDT</bdi>');
  expect(render('deposit')).toContain('Wallet balance: <bdi>8 USDT</bdi>');
 });
 it('honours recorded profit, treasury liquidity and cooldown',()=>{
  expect(render('profit',{...base,profit:2_000_000n})).toContain('<bdi>2 USDT</bdi>');
  expect(render('profit',{...base,liquidBalance:1_000_000n})).toContain('<bdi>1 USDT</bdi>');
  expect(render('profit',{...base,nextWithdrawal:1001n})).toContain('<bdi>0 USDT</bdi>');
  expect(render('profit',{...base,nextWithdrawal:1000n})).toContain('<bdi>15 USDT</bdi>');
 });
 it('shows recorded profit for reinvestment even while withdrawal is cooling',()=>{
  expect(render('reinvest',{...base,nextWithdrawal:1001n,liquidBalance:0n})).toContain('Available to reinvest: <bdi>30 USDT</bdi>');
  expect(render('ownerWithdraw')).toContain('Treasury cash: <bdi>50 USDT</bdi>');
 });
 it('uses the selected asset precision and leaves unloaded balances unknown',()=>{
  expect(render('profit',{...base,profit:2n*10n**18n,withdrawalLimit:10n**18n,liquidBalance:3n*10n**18n,decimals:18},'BNB')).toContain('<bdi>1 BNB</bdi>');
  expect(render('profit',null)).toContain('<bdi>— USDT</bdi>');
 });
});
