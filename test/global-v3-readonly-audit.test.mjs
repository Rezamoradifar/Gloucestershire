import test from 'node:test';
import assert from 'node:assert/strict';
import {auditV3Values} from '../scripts/audit-global-v3-readonly.mjs';

const record=(override={})=>({
 cash:1000n,principal:900n,profit:100n,escrow:10n,
 principalEscrow:5n,shortfall:0n,...override
});
test('read-only V3 financial audit detects reconciled funded and unfunded accounting',()=>{
 assert.equal(auditV3Values(record()).fullyCovered,true);
 const short=auditV3Values(record({cash:950n,shortfall:50n}));
 assert.equal(short.fullyCovered,false);
 assert.equal(short.shortfallTestUnits,'50');
 assert.equal(short.totalLiabilityTestUnits,'1000');
});
test('refuses broken escrow invariants or fabricated cash/liability reconciliation',()=>{
 assert.throws(()=>auditV3Values(record({cash:950n,shortfall:0n})));
 assert.throws(()=>auditV3Values(record({cash:5n,shortfall:995n})));
 assert.throws(()=>auditV3Values(record({escrow:11n,principalEscrow:12n})));
 assert.throws(()=>auditV3Values(record({escrow:-1n})));
 assert.throws(()=>auditV3Values(record({principal:0n,principalEscrow:1n})));
});
