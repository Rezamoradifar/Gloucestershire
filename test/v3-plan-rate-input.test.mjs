import assert from 'node:assert/strict';
import test from 'node:test';
import {parsePlanRates} from '../scripts/prepare-v3-plan-rates.mjs';

const input = {VIP:'100.00', Pro:12.5, Growth:'0.05', Basic:10, Starter:0};

test('plan inputs map named percentages to contract-tier basis points exactly', () => {
  assert.deepEqual(parsePlanRates(input), [0, 1000, 5, 1250, 10000]);
});

test('an incomplete, unknown, out-of-range or over-precise schedule is rejected', () => {
  const {Basic, ...missing} = input;
  for (const invalid of [missing, {...missing, Silver:Basic}, {...input, Extra:1},
    {...input, VIP:'100.01'}, {...input, Starter:'0.001'}, {...input, Growth:null}, {...input, Pro:-1}]) {
    assert.throws(() => parsePlanRates(invalid));
  }
});
